import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import pg from "pg";
import { CompileQueryArgs, compileQuery } from "../src/api.js";
import { SQLEntities } from "../src/backend.js";
import { CreateOsoArgs } from "../src/oso.js";
import { PostgresBackend } from "../src/pg-backend.js";

const TestDir = url.fileURLToPath(new URL(".", import.meta.url));

const EnvsDir = path.join(TestDir, "envs");

const RulesDir = path.join(TestDir, "rules");

export async function loadEnv(
  name: string,
  vars: Record<string, string>,
): Promise<[string, string]> {
  const interpolate = (value: string) => {
    let currentValue = value;
    for (const [key, keyVal] of Object.entries(vars)) {
      currentValue = currentValue.replaceAll(`{{${key}}}`, keyVal);
    }
    return currentValue;
  };

  const envDir = path.join(EnvsDir, name);
  const setupScript = path.join(envDir, "setup.sql");
  const teardownScript = path.join(envDir, "teardown.sql");
  const setup = await fs.promises.readFile(setupScript, { encoding: "utf8" });
  const teardown = await fs.promises.readFile(teardownScript, {
    encoding: "utf8",
  });
  return [interpolate(setup), interpolate(teardown)];
}

export const rootDbUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:password@localhost:5432/db";

export function rulesFile(name: string): string {
  return path.join(RulesDir, `${name}.polar`);
}

export function dbUrl(username: string, password: string, db: string): string {
  const newUrl = new URL(rootDbUrl);
  newUrl.username = username;
  newUrl.password = password;
  newUrl.pathname = `/${db}`;
  return newUrl.href;
}

const rootDbUrlObj = new URL(rootDbUrl);

export const rootUser = rootDbUrlObj.username;

export const rootPassword = rootDbUrlObj.password;

export const rootDb = rootDbUrlObj.pathname.slice(1);

function nameGenerator(prefix: string): () => string {
  let i = 0;
  return () => {
    i++;
    return [prefix, process.pid, i].join("_");
  };
}

export const userNameGenerator = nameGenerator("user");

export const dbNameGenerator = nameGenerator("db");

export function dbClientGenerator(url: string) {
  return async <T>(func: (client: pg.Client) => Promise<T>): Promise<T> => {
    const client = new pg.Client(url);
    await client.connect();
    try {
      return await func(client);
    } finally {
      await client.end();
    }
  };
}

export async function setupEnv(
  env: string,
  rules: string,
  db: string,
  vars: Record<string, string>,
  opts?: Omit<CompileQueryArgs, keyof CreateOsoArgs | "backend">,
): Promise<() => Promise<void>> {
  const [setup, teardown] = await loadEnv(env, vars);

  const client = new pg.Client(rootDbUrl);
  const backendClient = new pg.Client(dbUrl(rootUser, rootPassword, db));

  const teardowns: [string, () => Promise<void>][] = [];
  const teardownFunc = async () => {
    let errors = 0;
    for (const [name, func] of teardowns) {
      try {
        await func();
      } catch (error) {
        errors++;
        console.error(`Error in teardown: ${name}`, error);
      }
    }
    if (errors > 0) {
      throw new Error("Teardowns failed");
    }
  };

  let entities: SQLEntities;
  try {
    await client.connect();
    teardowns.push(["Close root client", () => client.end()]);
    await client.query(`CREATE DATABASE ${db}`);

    await backendClient.connect();
    await backendClient.query(setup);

    teardowns.push([
      "Tear down test objects",
      async () => {
        await client.query(teardown);
      },
    ]);
    teardowns.push([
      "Drop test db",
      async () => {
        await client.query(`DROP DATABASE ${db}`);
      },
    ]);
    teardowns.push(["Close backend client", () => backendClient.end()]);

    teardowns.reverse();

    const backend = new PostgresBackend(backendClient);
    const result = await compileQuery({
      backend,
      paths: [rulesFile(rules)],
      vars,
      ...opts,
    });

    if (result.type === "error") {
      throw new Error(`Parse error: ${JSON.stringify(result.errors, null, 2)}`);
    }

    await backendClient.query(result.query);

    return teardownFunc;
  } catch (error) {
    await teardownFunc();
    throw error;
  }
}
