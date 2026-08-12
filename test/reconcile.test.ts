import assert from "node:assert";
import { it } from "node:test";
import pg from "pg";
import { compileQuery } from "../src/api.js";
import { PostgresBackend } from "../src/pg-backend.js";
import {
  dbNameGenerator,
  dbUrl,
  loadEnv,
  rootDbUrl,
  rootPassword,
  rootUser,
  rulesFile,
  userNameGenerator,
} from "./utils.js";

it("reconciles only changed direct privileges", async () => {
  const db = dbNameGenerator();
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const inheritedRole = userNameGenerator();
  const vars = { user1, user2 };
  const [setup] = await loadEnv("basic", vars);
  const rootClient = new pg.Client(rootDbUrl);
  const databaseClient = new pg.Client(dbUrl(rootUser, rootPassword, db));

  await rootClient.connect();
  try {
    await rootClient.query(`CREATE DATABASE ${db}`);
    await databaseClient.connect();
    try {
      await databaseClient.query(setup);
      await databaseClient.query(`CREATE ROLE ${inheritedRole}`);
      await databaseClient.query(`GRANT ${inheritedRole} TO ${user1}`);
      const backend = new PostgresBackend(databaseClient);
      const compile = (rules = "basic-2") =>
        compileQuery({
          backend,
          paths: [rulesFile(rules)],
          vars,
          reconcile: true,
        });

      const first = await compile();
      assert.equal(first.type, "success");
      assert.match(first.query, /GRANT USAGE ON SCHEMA/);
      assert.match(
        first.query,
        new RegExp(`REVOKE "${inheritedRole}" FROM "${user1}"`),
      );
      await databaseClient.query(first.query);

      const unchanged = await compile();
      assert.deepEqual(unchanged, {
        type: "success",
        query: "BEGIN;\nCOMMIT;",
      });

      await databaseClient.query(
        `GRANT SELECT ON TABLE test.articles TO ${user1}`,
      );
      const drifted = await compile();
      assert.equal(drifted.type, "success");
      assert.match(drifted.query, /REVOKE SELECT ON TABLE/);
      assert.doesNotMatch(drifted.query, /GRANT USAGE ON SCHEMA/);
      await databaseClient.query(drifted.query);

      const converged = await compile();
      assert.deepEqual(converged, {
        type: "success",
        query: "BEGIN;\nCOMMIT;",
      });

      await databaseClient.query(
        `GRANT USAGE ON SCHEMA test TO ${user1} WITH GRANT OPTION`,
      );
      const removeGrantOption = await compile();
      assert.equal(removeGrantOption.type, "success");
      assert.match(removeGrantOption.query, /REVOKE USAGE ON SCHEMA/);
      assert.match(removeGrantOption.query, /CASCADE/);
      assert.match(removeGrantOption.query, /GRANT USAGE ON SCHEMA/);
      await databaseClient.query(removeGrantOption.query);

      const grantOptionConverged = await compile();
      assert.deepEqual(grantOptionConverged, {
        type: "success",
        query: "BEGIN;\nCOMMIT;",
      });

      const addColumns = await compile("basic-8");
      assert.equal(addColumns.type, "success");
      assert.match(addColumns.query, /GRANT SELECT \("id"\) ON TABLE/);
      assert.doesNotMatch(addColumns.query, /GRANT USAGE ON SCHEMA/);
      await databaseClient.query(addColumns.query);

      const columnsUnchanged = await compile("basic-8");
      assert.deepEqual(columnsUnchanged, {
        type: "success",
        query: "BEGIN;\nCOMMIT;",
      });

      const removeColumns = await compile();
      assert.equal(removeColumns.type, "success");
      assert.match(removeColumns.query, /REVOKE SELECT \("id"\) ON TABLE/);
      await databaseClient.query(removeColumns.query);

      await databaseClient.query(`
        CREATE MATERIALIZED VIEW test.article_counts AS
        SELECT author, COUNT(*) AS count FROM test.articles GROUP BY author
      `);
      const addMaterializedView = await compile("reconcile-materialized-view");
      assert.equal(addMaterializedView.type, "success");
      assert.match(
        addMaterializedView.query,
        /GRANT SELECT ON TABLE "test"\."article_counts"/,
      );
      await databaseClient.query(addMaterializedView.query);

      const materializedViewUnchanged = await compile(
        "reconcile-materialized-view",
      );
      assert.deepEqual(materializedViewUnchanged, {
        type: "success",
        query: "BEGIN;\nCOMMIT;",
      });
    } finally {
      await databaseClient.end();
    }
  } finally {
    await rootClient.query(`DROP DATABASE IF EXISTS ${db}`);
    await rootClient.query(`DROP ROLE IF EXISTS ${user1}`);
    await rootClient.query(`DROP ROLE IF EXISTS ${user2}`);
    await rootClient.query(`DROP ROLE IF EXISTS ${inheritedRole}`);
    await rootClient.end();
  }
});
