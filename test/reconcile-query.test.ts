import assert from "node:assert";
import { it } from "node:test";
import type pg from "pg";
import type { SQLBackendContext, SQLEntities } from "../src/backend.js";
import { PostgresBackend } from "../src/pg-backend.js";
import { constructFullQuery } from "../src/sql.js";

const entities: SQLEntities = {
  users: [],
  groups: [],
  schemas: [],
  tables: [],
  views: [],
  rlsPolicies: [],
  functions: [],
  procedures: [],
  sequences: [],
};

it("fetches reconciliation metadata only when requested", async () => {
  const queries: string[] = [];
  const client = {
    query: async (query: string) => {
      queries.push(query);
      return { rows: [] };
    },
  } as unknown as pg.Client;
  const backend = new PostgresBackend(client);

  const replacementEntities = await backend.fetchEntities();
  assert.equal(replacementEntities.directPrivileges, undefined);
  assert.equal(replacementEntities.roleMemberships, undefined);
  assert.equal(queries.some((query) => query.includes("aclexplode")), false);
  assert.equal(queries.some((query) => query.includes("pg_auth_members")), false);

  queries.length = 0;
  const reconciliationEntities = await backend.fetchEntities({
    reconcile: true,
  });
  assert.deepEqual(reconciliationEntities.directPrivileges, []);
  assert.deepEqual(reconciliationEntities.roleMemberships, []);
  assert.equal(queries.some((query) => query.includes("aclexplode")), true);
  assert.equal(queries.some((query) => query.includes("pg_auth_members")), true);
});

it("keeps the reconciliation plan in short output", () => {
  const context: SQLBackendContext = {
    removeAllPermissionsFromActorsQueries: () => [],
    reconcilePermissionsQueries: () => [
      'REVOKE SELECT ON TABLE "test"."articles" FROM "user" CASCADE;',
      'GRANT SELECT ON TABLE "test"."articles" TO "user";',
    ],
    compileRlsQueries: () => [
      'ALTER TABLE "test"."articles" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "select_user" ON "test"."articles";',
    ],
    compilePrivilegeGrantQueries: () => [],
  };

  const query = constructFullQuery({
    context,
    entities,
    revokeUsers: [],
    permissions: [],
    includeSetupAndTeardown: false,
    includeTransaction: false,
    reconcile: true,
  });

  assert.equal(
    query,
    [
      'REVOKE SELECT ON TABLE "test"."articles" FROM "user" CASCADE;',
      'GRANT SELECT ON TABLE "test"."articles" TO "user";',
      'ALTER TABLE "test"."articles" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "select_user" ON "test"."articles";',
    ].join("\n"),
  );
});

it("omits only replacement setup and teardown from short output", () => {
  const context: SQLBackendContext = {
    removeAllPermissionsFromActorsQueries: () => [
      "SELECT revoke_all_from_role('user');",
    ],
    compileRlsQueries: () => [
      'ALTER TABLE "test"."articles" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "select_user" ON "test"."articles";',
    ],
    compilePrivilegeGrantQueries: () => [
      'GRANT SELECT ON TABLE "test"."articles" TO "user";',
    ],
  };

  const query = constructFullQuery({
    context,
    entities,
    revokeUsers: [],
    permissions: [],
    includeSetupAndTeardown: false,
    includeTransaction: false,
  });

  assert.equal(
    query,
    [
      'ALTER TABLE "test"."articles" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "select_user" ON "test"."articles";',
      'GRANT SELECT ON TABLE "test"."articles" TO "user";',
    ].join("\n"),
  );
});

it("drops restrictive policies targeting managed groups", async () => {
  const group = { type: "group", name: "editors", users: [] } as const;
  const groupEntities: SQLEntities = {
    ...entities,
    groups: [group],
    rlsPolicies: [
      {
        type: "rls-policy",
        name: "select_editors",
        table: { type: "table", schema: "test", name: "articles" },
        permissive: "RESTRICTIVE",
        privileges: new Set(["SELECT"]),
        isDefault: false,
        users: [],
        groups: [group],
        usingExpression: null,
        checkExpression: null,
      },
    ],
  };
  const backend = new PostgresBackend({} as pg.Client);
  const context = await backend.getContext(groupEntities);

  const queries = context.compileRlsQueries([group], [], groupEntities, true);

  assert.deepEqual(queries, [
    'DROP POLICY "select_editors" ON "test"."articles";',
  ]);
});
