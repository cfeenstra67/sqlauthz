#!/usr/bin/env node
import "dotenv/config";
import { Oso } from "oso";
import pg from "pg";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { createOso } from "./oso.js";
import { compileQuery } from "./parser.js";
import { PostgresBackend } from "./pg-backend.js";

async function main() {
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
    .option("dry-run", {
      type: "boolean",
      description:
        "Print full SQL query that would be executed; --dry-run-short only " +
        "includes grants.",
      default: false,
    })
    .option("dry-run-short", {
      type: "boolean",
      description:
        "Print GRANT statements that would be generated without running them.",
    })
    .pkgConf("sqlauthz")
    .check((argv) => !(argv["dry-run"] && argv["dry-run-full"]))
    .strict()
    .env("SQLAUTHZ")
    .parseAsync();

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
      includeSetupAndTeardown: !args.dryRunShort,
      includeTransaction: !args.dryRunShort,
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

    await backend.execute(query.query);
    console.log("Permissions updated successfully");
  } finally {
    await client.end();
  }
}

main();
