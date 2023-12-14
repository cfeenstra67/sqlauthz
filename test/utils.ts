import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import pg from "pg";
import { createOso } from "../src/oso.js";
import { compileQuery } from "../src/parser.js";
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

export function rulesFile(name: string): string {
  return path.join(RulesDir, `${name}.polar`);
}

export function dbUrl(username: string, password: string, db: string): string {
  return `postgresql://${username}:${password}@localhost:5432/${db}`;
}

export const rootUser = "postgres";

export const rootPassword = "password";

export const rootDb = "db";

export function rootDbUrl(): string {
  return dbUrl(rootUser, rootPassword, rootDb);
}

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
) {
  const oso = await createOso({
    paths: [rulesFile(rules)],
    vars,
  });

  const [setup, teardown] = await loadEnv(env, vars);

  const rootUrl = rootDbUrl();
  const client = new pg.Client(rootUrl);
  const backendClient = new pg.Client(dbUrl(rootUser, rootPassword, db));

  const teardowns: (() => Promise<void>)[] = [];
  const teardownFunc = async () => {
    await Promise.allSettled(teardowns.toReversed().map((func) => func()));
  };

  try {
    await client.connect();
    teardowns.push(() => client.end());
    await client.query(`CREATE DATABASE ${db}`);
    teardowns.push(async () => {
      await client.query(`DROP DATABASE ${db}`);
    });

    await backendClient.connect();
    teardowns.push(() => backendClient.end());
    await backendClient.query(setup);
    teardowns.push(async () => {
      await backendClient.query(teardown);
    });

    const backend = new PostgresBackend(backendClient);
    const result = await compileQuery({
      backend,
      oso,
    });

    if (result.type === "error") {
      throw new Error(`Parse error: ${JSON.stringify(result, null, 2)}`);
    }

    await backend.execute(result.query);

    return teardownFunc;
  } catch (error) {
    await teardownFunc();
    throw error;
  }
}
