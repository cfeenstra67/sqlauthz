#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { compileQuery } from "./api.js";
import { OsoError } from "./oso.js";
import { UserRevokePolicy } from "./parser.js";
import { PostgresBackend } from "./pg-backend.js";
import { PathNotFound, strictGlob } from "./utils.js";

function parseVar(value: string): [string, unknown] {
  const parts = value.split("=", 2);
  if (parts.length !== 2) {
    throw new Error(
      `Invalid variable value: ${value}. Must use name=value syntax`,
    );
  }
  const key = parts[0]!;
  let outValue = parts[1]!;
  try {
    outValue = JSON.parse(outValue);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return [key, outValue];
}

async function main() {
  if (!process.env.NO_DOTENV) {
    await import("dotenv/config");
  }

  const args = await yargs(hideBin(process.argv))
    .scriptName("sqlauthz")
    .usage("$0 [args]", "Declaratively manage PostgreSQL permissions")
    .option("rules", {
      alias: "r",
      type: "string",
      description:
        "Polar rule file(s) defining permissions. " +
        "Globs (e.g. `sqlauthz/*.polar`) are supported.",
      default: ["sqlauthz.polar"],
      array: true,
      demandOption: true,
    })
    .option("database-url", {
      alias: "d",
      type: "string",
      description:
        "Database URL to connect to. Note that you can " +
        "specify a value with the format with env:<name> to " +
        "read this from a specified environment variable.",
      demandOption: true,
    })
    .option("revoke-referenced", {
      type: "boolean",
      description:
        "Revoke existing permissions from any user who matches " +
        "one of the rules in your .polar file(s) before applying " +
        "new permissions. This is the default. Note that only one  " +
        '"revoke" strategy may be specified.',
      conflicts: ["revoke-all", "revoke-users"],
    })
    .option("revoke-all", {
      type: "boolean",
      description:
        "Revoke permissions from all users in the database other " +
        "than superusers before applying new permissions. Note that " +
        'only one "revoke" strategy may be specified.',
      conflicts: ["revoke-users", "revoke-referenced"],
    })
    .option("revoke-users", {
      type: "string",
      array: true,
      description:
        "Revoke permissions from an explicit list of users before " +
        'applying new permissions. Note that only one "revoke" strategy ' +
        "may be specified.",
      conflicts: ["revoke-all", "revoke-referenced"],
    })
    .option("allow-any-actor", {
      type: "boolean",
      description:
        "Allow rules that do not limit the `actor` in any way. This is " +
        "potentially dangerous, so it will fail by default. However " +
        "providing this argument can disable that so that empty actor " +
        "queries will be allowed",
      default: false,
    })
    .option("var", {
      type: "string",
      array: true,
      description:
        "Define variable(s) that can be referenced in your rules files " +
        "by specifying a value of `varname=varvalue`. The variables " +
        "will be attempted to be parsed as JSON, otherwise they will " +
        "be treated as strings. Variables can be access in rules files " +
        "via `var.<name>`. For more flexibility, also see --var-file",
    })
    .option("var-file", {
      type: "string",
      array: true,
      description:
        "File paths to .js scripts or JSON files that will be loaded, " +
        "and the exports will be available in your rules files as " +
        "var.<name>.",
    })
    .option("dry-run", {
      type: "boolean",
      description:
        "Print full SQL query that would be executed; --dry-run-short only " +
        "includes grants.",
      conflicts: ["dry-run-short"],
    })
    .option("dry-run-short", {
      type: "boolean",
      description:
        "Print GRANT statements that would be generated without running them.",
      conflicts: ["dry-run"],
    })
    .option("debug", {
      type: "boolean",
      description: "Print more detailed error information for debugging issues",
      default: false,
    })
    .pkgConf("sqlauthz")
    .env("SQLAUTHZ")
    .strict()
    .parseAsync();

  let userRevokePolicy: UserRevokePolicy;
  if (args.revokeAll) {
    userRevokePolicy = { type: "all" };
  } else if (args.revokeUsers) {
    userRevokePolicy = { type: "users", users: args.revokeUsers };
  } else {
    userRevokePolicy = { type: "referenced" };
  }

  let rulesPaths: string[];
  try {
    rulesPaths = await strictGlob(...args.rules);
  } catch (error) {
    if (error instanceof PathNotFound) {
      console.error("Path not found:", error.path);
      process.exit(1);
    }
    console.error("Unexpected error finding rules files:", error);
    process.exit(1);
  }

  if (rulesPaths.length === 0) {
    console.error(`No rules files matched glob(s): ${args.rules.join(", ")}`);
    process.exit(1);
  }

  const vars: Record<string, unknown> = {};
  let varFiles: string[];
  try {
    varFiles = args.varFile ? await strictGlob(...args.varFile) : [];
  } catch (error) {
    if (error instanceof PathNotFound) {
      console.error("Path not found:", error.path);
      process.exit(1);
    }
    console.error("Unexpected error finding variable files:", error);
    process.exit(1);
  }

  for (const varFile of varFiles) {
    if (varFile.endsWith(".json")) {
      const content = await fs.promises.readFile(varFile, { encoding: "utf8" });
      let obj: unknown;
      try {
        obj = JSON.parse(content);
      } catch (_) {
        console.error(`Unable to parse JSON in ${varFile}`);
        process.exit(1);
      }
      Object.assign(vars, obj);
    } else if (varFile.endsWith(".js")) {
      const fullPath = path.resolve(varFile);
      const mod = await import(fullPath);
      Object.assign(vars, mod);
    } else {
      console.error(
        `Invalid var file: ${varFile}. Extension must be .js or .json`,
      );
      process.exit(1);
    }
  }

  try {
    for (const varString of args.var ?? []) {
      const [key, value] = parseVar(varString);
      vars[key] = value;
    }
  } catch (error) {
    console.error("Error parsing variables:", error);
    process.exit(1);
  }

  const envVariablePrefix = "env:";
  let databaseUrl: string;
  if (args.databaseUrl.startsWith(envVariablePrefix)) {
    const envVariableName = args.databaseUrl.slice(envVariablePrefix.length);
    const envVariable = process.env[envVariableName];
    if (!envVariable) {
      console.error(
        `Invalid environment variable specified for databaseUrl: ${envVariableName}`,
      );
      process.exit(1);
    }
    databaseUrl = envVariable;
  } else {
    databaseUrl = args.databaseUrl;
  }

  const client = new pg.Client(databaseUrl);
  try {
    await client.connect();
  } catch (error) {
    console.error(`Could not connect to database at '${databaseUrl}':`, error);
    process.exit(1);
  }

  const backend = new PostgresBackend(client);

  try {
    const query = await compileQuery({
      backend,
      paths: rulesPaths,
      userRevokePolicy,
      allowAnyActor: args.allowAnyActor,
      includeSetupAndTeardown: !args.dryRunShort,
      includeTransaction: !args.dryRunShort,
      debug: args.debug,
      vars: { var: vars },
    });
    if (query.type !== "success") {
      console.error("Unable to compile permission queries. Errors:");
      for (const error of query.errors) {
        console.error(error);
      }
      process.exit(1);
    }

    if (args.dryRun || args.dryRunShort) {
      if (query.query) {
        console.log(query.query);
      } else {
        console.log("No permissions granted to any users");
      }
      return;
    }

    await client.query(query.query);
    console.log("Permissions updated successfully");
  } catch (error) {
    if (error instanceof OsoError) {
      console.error("Error loading rules:", error);
    } else {
      console.error("Unexpected error:", error);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
