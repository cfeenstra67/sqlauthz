#!/usr/bin/env node
import { Oso } from "oso";
import pg from "pg";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { createOso } from "./oso.js";
import { compileQuery } from "./parser.js";
import { PostgresBackend } from "./pg-backend.js";
import { UserRevokePolicy } from "./sql.js";

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
      description: "Polar rule file(s) defining permissions",
      default: ["sqlauthz.polar"],
      array: true,
      demandOption: true,
    })
    .option("database-url", {
      alias: "d",
      type: "string",
      description: "Database URL to connect to",
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
    .option("dry-run", {
      type: "boolean",
      description:
        "Print full SQL query that would be executed; --dry-run-short only " +
        "includes grants.",
      default: false,
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

  let oso: Oso;
  try {
    oso = await createOso({
      paths: args.rules,
    });
  } catch (error) {
    console.error(`${error}`);
    process.exit(1);
  }

  const client = new pg.Client(args.databaseUrl);
  try {
    await client.connect();
  } catch (error) {
    console.error(`Could not connect to database: ${error}`);
    process.exit(1);
  }

  try {
    const backend = new PostgresBackend(client);
    const query = await compileQuery({
      backend,
      oso,
      userRevokePolicy,
      allowAnyActor: args.allowAnyActor,
      includeSetupAndTeardown: !args.dryRunShort,
      includeTransaction: !args.dryRunShort,
      debug: args.debug,
    });
    if (query.type !== "success") {
      console.error("Unable to compile permission queries. Errors:");
      for (const error of query.errors) {
        console.error(error);
      }
      return;
    }

    if (args.dryRun || args.dryRunShort) {
      console.log(query.query);
      return;
    }

    await client.query(query.query);
    console.log("Permissions updated successfully");
  } finally {
    await client.end();
  }
}

main();
