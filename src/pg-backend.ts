import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import pg from "pg";
import { SQLBackend, SQLBackendContext, SQLEntities } from "./backend.js";
import {
  Clause,
  ValidationError,
  evaluateClause,
  isTrueClause,
  simpleEvaluator,
} from "./clause.js";
import {
  Permission,
  SQLActor,
  SQLSchema,
  SQLTable,
  SQLTableMetadata,
  SchemaPermission,
  TablePermission,
} from "./sql.js";

const ProjectDir = url.fileURLToPath(new URL(".", import.meta.url));

const SqlDir = path.join(ProjectDir, "sql/pg");

export class PostgresBackend implements SQLBackend {
  constructor(private readonly client: pg.Client) {}

  async fetchEntities(): Promise<SQLEntities> {
    const users = await this.client.query<{ name: string }>(
      `
        SELECT
          usename as "name"
        FROM
          pg_catalog.pg_user
        WHERE NOT usesuper
      `,
    );
    const groups = await this.client.query<{ name: string }>(
      `
        SELECT
          groname as "name"
        FROM
          pg_catalog.pg_group
      `,
    );
    const tables = await this.client.query<{
      schema: string;
      name: string;
      rlsEnabled: boolean;
    }>(
      `
        SELECT
          schemaname as "schema",
          tablename as "name",
          rowsecurity as "rlsEnabled"
        FROM
          pg_tables
        WHERE
          schemaname != 'information_schema'
          AND schemaname != 'pg_catalog'
          AND schemaname != 'pg_toast'
      `,
    );
    const tableColumns = await this.client.query<{
      schema: string;
      table: string;
      name: string;
    }>(
      `
        SELECT
          table_schema as "schema",
          table_name as "table",
          column_name as "name"
        FROM
          information_schema.columns
        WHERE
          table_schema != 'information_schema'
          AND table_schema != 'pg_catalog'
          AND table_schema != 'pg_toast'
      `,
    );
    const schemas = await this.client.query<{ name: string }>(
      `
        SELECT
          schema_name as "name"
        FROM
          information_schema.schemata
        WHERE
          schema_name != 'information_schema'
          AND schema_name != 'pg_catalog'
          AND schema_name != 'pg_toast'
      `,
    );
    const policies = await this.client.query<{
      schema: string;
      table: string;
      name: string;
      users: string;
    }>(
      `
        SELECT
          schemaname as "schema",
          tablename as "table",
          policyname as "name",
          roles as "users"
        FROM
          pg_policies
        WHERE
          schemaname != 'information_schema'
          AND schemaname != 'pg_catalog'
          AND schemaname != 'pg_toast'
      `,
    );
    const functions = await this.client.query<{
      schema: string;
      name: string;
      builtin: boolean;
    }>(
      `
        SELECT
          n.nspname as "schema",
          p.proname as "name",
          n.nspname = 'pg_catalog' as "builtin"
        FROM
          pg_catalog.pg_proc p
          LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE
          pg_catalog.pg_function_is_visible(p.oid);
      `,
    );

    const tableItems: Record<string, SQLTableMetadata> = {};
    for (const table of tables.rows) {
      const fullName = `${table.schema}.${table.name}`;
      tableItems[fullName] = {
        type: "table-metadata",
        table: { type: "table", name: table.name, schema: table.schema },
        rlsEnabled: table.rlsEnabled,
        columns: [],
      };
    }

    for (const row of tableColumns.rows) {
      const fullName = `${row.schema}.${row.table}`;
      tableItems[fullName]!.columns.push(row.name);
    }

    const parseArray = (value: string): string[] => {
      return value.slice(1, -1).split(",");
    };

    return {
      users: users.rows.map((row) => ({ type: "user", name: row.name })),
      groups: groups.rows.map((row) => ({ type: "group", name: row.name })),
      schemas: schemas.rows.map((row) => ({ type: "schema", name: row.name })),
      tables: Object.values(tableItems),
      rlsPolicies: policies.rows.map((row) => ({
        type: "rls-policy",
        name: row.name,
        table: { type: "table", schema: row.schema, name: row.table },
        users: parseArray(row.users).map((user) => ({
          type: "user",
          name: user,
        })),
      })),
      functions: functions.rows.map((row) => ({ type: "function", ...row })),
    };
  }

  private quoteIdentifier(identifier: string): string {
    return JSON.stringify(identifier);
  }

  private quoteSchemaName(schema: SQLSchema): string {
    return this.quoteIdentifier(schema.name);
  }

  private quoteTableName(table: SQLTable): string {
    return [
      this.quoteIdentifier(table.schema),
      this.quoteIdentifier(table.name),
    ].join(".");
  }

  private quoteUserName(user: SQLActor): string {
    return this.quoteIdentifier(user.name);
  }

  private async loadSqlFile(
    name: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const filePath = path.join(SqlDir, name);
    let content = await fs.promises.readFile(filePath, { encoding: "utf8" });
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
    return content;
  }

  async getContext(entities: SQLEntities): Promise<SQLBackendContext> {
    let tmpSchema = "";
    const tries = 0;

    const schemaNames = new Set(entities.schemas.map((schema) => schema.name));
    while (tries < 100 && !tmpSchema) {
      const newName = `tmp_${crypto.randomInt(10000)}`;
      if (!schemaNames.has(newName)) {
        tmpSchema = newName;
      }
    }

    if (!tmpSchema) {
      throw new Error("Unable to choose a temporary schema name");
    }

    const setupQuery = [
      `CREATE SCHEMA ${this.quoteIdentifier(tmpSchema)};`,
      await this.loadSqlFile("revoke_all_from_role.sql", { tmpSchema }),
    ].join("\n");

    const teardownQuery = `DROP SCHEMA ${this.quoteIdentifier(
      tmpSchema,
    )} CASCADE;`;

    return {
      setupQuery,
      teardownQuery,
      transactionStartQuery: "BEGIN;",
      transactionCommitQuery: "COMMIT;",
      removeAllPermissionsFromUsersQueries: (users, entities) => {
        const revokeQueries = users.map(
          (user) => `SELECT ${tmpSchema}.revoke_all_from_role('${user.name}');`,
        );

        const userNames = new Set(users.map((user) => user.name));

        const policiesToDrop = entities.rlsPolicies.filter((policy) =>
          policy.users.some((user) => userNames.has(user.name)),
        );
        const dropQueries = policiesToDrop.map(
          (policy) =>
            `DROP POLICY ${this.quoteIdentifier(policy.name)} ` +
            `ON ${this.quoteTableName(policy.table)};`,
        );

        return revokeQueries.concat(dropQueries);
      },
      compileGrantQueries: (permissions, entities) => {
        const metaByTable = Object.fromEntries(
          entities.tables.map((table) => [
            this.quoteTableName(table.table),
            table,
          ]),
        );

        const tablesToAddRlsTo = new Set<string>();
        for (const perm of permissions) {
          if (perm.type === "schema") {
            continue;
          }
          if (isTrueClause(perm.rowClause)) {
            continue;
          }
          const tableName = this.quoteTableName(perm.table);
          const table = metaByTable[tableName];
          if (!table) {
            continue;
          }
          if (table.rlsEnabled) {
            continue;
          }
          tablesToAddRlsTo.add(tableName);
        }

        const rlsQueries = Array.from(tablesToAddRlsTo).flatMap((tableName) => [
          `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`,
          // biome-ignore lint: best way to do this
          `CREATE POLICY "default_access" ON ${tableName} AS PERMISSIVE FOR ` +
            "ALL TO PUBLIC USING (true);",
        ]);

        const individualGrantQueries = permissions.flatMap((perm) =>
          this.compileGrantQuery(perm, entities),
        );

        return rlsQueries.concat(individualGrantQueries);
      },
    };
  }

  private evalColumnQuery(clause: Clause, column: string): boolean {
    const evaluate = simpleEvaluator({
      variableName: "col",
      errorVariableName: "col",
      getValue: (value) => {
        if (value.type === "function-call") {
          throw new ValidationError("col: invalid function call");
        }
        if (value.type === "value") {
          return value.value;
        }
        if (value.value === "col") {
          return column;
        }
        throw new ValidationError(`col: invalid clause value: ${value.value}`);
      },
    });

    const result = evaluateClause({ clause, evaluate });
    return result.type === "success" && result.result;
  }

  private valueToSql(value: unknown): string {
    if (typeof value === "string") {
      // TODO: need to do proper quoting here, probably
      // need to actually use parameters ultimately
      return `'${value.replaceAll("'", "\\'")}'`;
    }
    return JSON.stringify(value);
  }

  private clauseToSql(clause: Clause): string {
    if (clause.type === "and" || clause.type === "or") {
      const subClauses = clause.clauses.map((subClause) =>
        this.clauseToSql(subClause),
      );
      return `(${subClauses.join(` ${clause.type} `)})`;
    }
    if (clause.type === "not") {
      const subClause = this.clauseToSql(clause.clause);
      return `not ${subClause}`;
    }
    if (clause.type === "expression") {
      const values = clause.values.map((value) => this.clauseToSql(value));
      let operator: string;
      switch (clause.operator) {
        case "Eq":
          operator = "=";
          break;
        case "Gt":
          operator = ">";
          break;
        case "Lt":
          operator = "<";
          break;
        case "Geq":
          operator = ">=";
          break;
        case "Leq":
          operator = "<=";
          break;
        case "Neq":
          operator = "!=";
          break;
        default:
          throw new Error(`Unhandled operator: ${clause.operator}`);
      }
      return values.join(` ${operator} `);
    }
    if (clause.type === "column") {
      return this.quoteIdentifier(clause.value);
    }
    if (clause.type === "function-call") {
      const name = `${this.quoteIdentifier(
        clause.schema,
      )}.${this.quoteIdentifier(clause.name)}`;
      const args = clause.args.map((arg) => this.clauseToSql(arg));
      return `${name}(${args.join(", ")})`;
    }
    if (typeof clause.value === "string") {
      return `'${clause.value}'`;
    }
    return this.valueToSql(clause.value);
  }

  private compileGrantQuery(
    permission: Permission,
    entities: SQLEntities,
  ): string[] {
    switch (permission.type) {
      case "schema":
        switch (permission.privilege) {
          case "USAGE":
            return [
              `GRANT USAGE ON SCHEMA ${this.quoteSchemaName(
                permission.schema,
              )} TO ${this.quoteUserName(permission.user)};`,
            ];
          case "CREATE":
            return [
              `GRANT CREATE ON SCHEMA ${this.quoteSchemaName(
                permission.schema,
              )} TO ${this.quoteUserName(permission.user)};`,
            ];
          default: {
            const _: never = permission;
            throw new Error(
              `Invalid schema privilege: ${
                (permission as SchemaPermission).privilege
              };`,
            );
          }
        }
      case "table": {
        let columnPart = "";
        if (!isTrueClause(permission.columnClause)) {
          const table = entities.tables.filter(
            (table) =>
              table.table.schema === permission.table.schema &&
              table.table.name === permission.table.name,
          )[0]!;
          const columnNames = table.columns.filter((column) =>
            this.evalColumnQuery(permission.columnClause, column),
          );
          const colNameList = columnNames.map((col) =>
            this.quoteIdentifier(col),
          );
          columnPart = ` (${colNameList.join(", ")})`;
        }

        switch (permission.privilege) {
          case "SELECT": {
            const out = [
              `GRANT SELECT${columnPart} ON ${this.quoteTableName(
                permission.table,
              )} TO ${this.quoteUserName(permission.user)};`,
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name,
              ]
                .join("_")
                .toLowerCase();

              out.push(
                `CREATE POLICY ${this.quoteIdentifier(
                  policyName,
                )} ON ${this.quoteTableName(
                  permission.table,
                )} AS RESTRICTIVE FOR SELECT TO ${this.quoteUserName(
                  permission.user,
                )} USING (${this.clauseToSql(permission.rowClause)});`,
              );
            }
            return out;
          }
          case "INSERT": {
            const out = [
              `GRANT INSERT${columnPart} ON ${this.quoteTableName(
                permission.table,
              )} TO ${this.quoteUserName(permission.user)};`,
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name,
              ]
                .join("_")
                .toLowerCase();

              out.push(
                `CREATE POLICY ${this.quoteIdentifier(
                  policyName,
                )} ON ${this.quoteTableName(
                  permission.table,
                )} AS RESTRICTIVE FOR INSERT TO ${this.quoteUserName(
                  permission.user,
                )} WITH CHECK (${this.clauseToSql(permission.rowClause)});`,
              );
            }
            return out;
          }
          case "UPDATE": {
            const out = [
              `GRANT UPDATE${columnPart} ON ${this.quoteTableName(
                permission.table,
              )} TO ${this.quoteUserName(permission.user)};`,
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name,
              ]
                .join("_")
                .toLowerCase();

              out.push(
                `CREATE POLICY ${this.quoteIdentifier(
                  policyName,
                )} ON ${this.quoteTableName(
                  permission.table,
                )} AS RESTRICTIVE FOR UPDATE TO ${this.quoteUserName(
                  permission.user,
                )} USING (${this.clauseToSql(permission.rowClause)});`,
              );
            }
            return out;
          }
          case "DELETE": {
            const out = [
              `GRANT DELETE ON ${this.quoteTableName(permission.table)} ` +
                `TO ${this.quoteUserName(permission.user)};`,
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name,
              ]
                .join("_")
                .toLowerCase();

              out.push(
                `CREATE POLICY ${this.quoteIdentifier(
                  policyName,
                )} ON ${this.quoteTableName(
                  permission.table,
                )} AS RESTRICTIVE FOR DELETE TO ${this.quoteUserName(
                  permission.user,
                )} USING (${this.clauseToSql(permission.rowClause)});`,
              );
            }
            return out;
          }
          case "TRUNCATE":
            return [
              `GRANT TRUNCATE ON ${this.quoteTableName(permission.table)} ` +
                `TO ${this.quoteUserName(permission.user)};`,
            ];
          case "TRIGGER":
            return [
              `GRANT TRIGGER ON ${this.quoteTableName(permission.table)} ` +
                `TO ${this.quoteUserName(permission.user)};`,
            ];
          case "REFERENCES":
            return [
              `GRANT REFERENCES ON ${this.quoteTableName(permission.table)} ` +
                `TO ${this.quoteUserName(permission.user)};`,
            ];
          default: {
            const _: never = permission;
            throw new Error(
              `Invalid table privilege: ${
                (permission as TablePermission).privilege
              }`,
            );
          }
        }
      }
      default: {
        const _: never = permission;
        throw new Error(
          `Invalid permission: ${(permission as Permission).type}`,
        );
      }
    }
  }
}
