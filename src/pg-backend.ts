import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import pg from 'pg';
import { SQLBackend, SQLBackendContext, SQLEntities } from "./backend.js";
import { Permission, SQLSchema, SQLTable, SQLTableMetadata, SQLUser } from './sql.js';
import { Clause, ValidationError, evaluateClause, isTrueClause, simpleEvaluator } from './clause.js';

const ProjectDir = url.fileURLToPath(new URL('.', import.meta.url));

const SqlDir = path.join(ProjectDir, 'sql/pg');

export class PostgresBackend implements SQLBackend {

  private readonly client: pg.Client;

  constructor(config?: string | pg.ClientConfig) {
    this.client = new pg.Client(config)
  }

  async setup(): Promise<void> {
    await this.client.connect();
  }

  async teardown(): Promise<void> {
    await this.client.end();
  }

  async fetchEntities(): Promise<SQLEntities> {
    const users = await this.client.query<{ name: string; }>(
      `
        SELECT
          usename as "name"
        FROM
          pg_catalog.pg_user
      `
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
      `
    );
    const columns = await this.client.query<{ schema: string; table: string; name: string; }>(
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
      `
    );
    const schemas = await this.client.query<{ name: string; }>(
      `
        SELECT
          schema_name as "name"
        FROM
          information_schema.schemata
        WHERE
          schema_name != 'information_schema'
          AND schema_name != 'pg_catalog'
          AND schema_name != 'pg_toast'
      `
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
      `
    );

    const tableItems: Record<string, SQLTableMetadata> = {};
    for (const table of tables.rows) {
      const fullName = `${table.schema}.${table.name}`;
      tableItems[fullName] = {
        type: 'table',
        name: table.name,
        schema: table.schema,
        rlsEnabled: table.rlsEnabled,
        columns: []
      };
    }

    for (const row of columns.rows) {
      const fullName = `${row.schema}.${row.table}`;
      tableItems[fullName]!.columns.push(row.name);
    }

    const parseArray = (value: string): string[] => {
      return value.slice(1, -1).split(',');
    };

    return {
      users: users.rows.map((row) => ({ type: 'user', name: row.name })),
      schemas: schemas.rows.map((row) => ({ type: 'schema', name: row.name })),
      tables: Object.values(tableItems),
      rlsPolicies: policies.rows.map((row) => ({
        type: 'rls-policy',
        name: row.name,
        table: { type: 'table', schema: row.schema, name: row.table },
        users: parseArray(row.users).map((user) => ({ type: 'user', name: user }))
      }))
    };
  }

  async execute(query: string): Promise<void> {
    await this.client.query(query);
  }

  private quoteIdentifier(identifier: string): string {
    return JSON.stringify(identifier);
  }

  private quoteSchemaName(schema: SQLSchema): string {
    return this.quoteIdentifier(schema.name);
  }

  private quoteTableName(table: SQLTable): string {
    return [this.quoteIdentifier(table.schema), this.quoteIdentifier(table.name)].join('.');
  }

  private quoteUserName(user: SQLUser): string {
    return this.quoteIdentifier(user.name);
  }

  private async loadSqlFile(name: string, variables: Record<string, string>): Promise<string> {
    const filePath = path.join(SqlDir, name);
    let content = await fs.promises.readFile(filePath, { encoding: 'utf8' });
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
    return content;
  }

  async getContext(entities: SQLEntities): Promise<SQLBackendContext> {
    let tmpSchema: string = '';
    let tries = 0;

    const schemaNames = new Set(entities.schemas.map((schema) => schema.name));
    while (tries < 100 && !tmpSchema) {
      const newName = `tmp_${crypto.randomInt(10000)}`;
      if (!schemaNames.has(newName)) {
        tmpSchema = newName;
      }
    }

    if (!tmpSchema) {
      throw new Error('Unable to choose a temporary schema name');
    }

    const setupQuery = [
      `CREATE SCHEMA ${this.quoteIdentifier(tmpSchema)};`,
      await this.loadSqlFile('revoke_all_from_role.sql', { tmpSchema }),
    ].join('\n');

    const teardownQuery = `DROP SCHEMA ${this.quoteIdentifier(tmpSchema)} CASCADE;`;

    return {
      setupQuery,
      teardownQuery,
      transactionStartQuery: 'BEGIN;',
      transactionCommitQuery: 'COMMIT;',
      removeAllPermissionsFromUsersQueries: (users, entities) => {
        const revokeQueries = users.map((user) =>
          `SELECT ${tmpSchema}.revoke_all_from_role('${user.name}');`,
        );

        const userNames = new Set(users.map((user) => user.name));

        const policiesToDrop = entities.rlsPolicies.filter((policy) =>
          policy.users.some((user) => userNames.has(user.name))
        );
        const dropQueries = policiesToDrop.map((policy) =>
          `DROP POLICY ${this.quoteIdentifier(policy.name)} ` +
          `ON ${this.quoteTableName(policy.table)};`
        );

        return revokeQueries.concat(dropQueries);
      },
      compileGrantQueries: (permissions, entities) => {
        const metaByTable = Object.fromEntries(
          entities.tables.map((table) =>
            [this.quoteTableName(table), table]
          )
        );

        const tablesToAddRlsTo = new Set<string>();
        for (const perm of permissions) {
          if (perm.type === 'schema') {
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
          `CREATE POLICY default_access ON ${tableName} AS PERMISSIVE FOR ` +
          `ALL TO PUBLIC USING (true);`
        ]);

        const individualGrantQueries = permissions.flatMap((perm) => this.compileGrantQuery(perm, entities))

        return rlsQueries.concat(individualGrantQueries);
      }
    };
  }

  private evalColumnQuery(clause: Clause, column: string): boolean {
    const evaluate = simpleEvaluator({
      variableName: 'col',
      getValue: (value) => {
        if (value.type === 'value') {
          return value.value;
        }
        if (value.value === 'col') {
          return column;
        }
        throw new ValidationError(`Invalid clause value: ${value.value}`);
      }
    });

    const result = evaluateClause({ clause, evaluate });
    return result.type === 'success' && result.result;
  }

  private clauseToSql(clause: Clause): string {
    if (clause.type === 'and' || clause.type === 'or') {
      const subClauses = clause.clauses.map((subClause) =>
        this.clauseToSql(subClause)
      );
      return `(${subClauses.join(` ${clause.type} `)})`;
    }
    if (clause.type === 'not') {
      const subClause = this.clauseToSql(clause.clause);
      return `not ${subClause}`;
    }
    if (clause.type === 'expression') {
      const values = clause.values.map((value) => this.clauseToSql(value));
      let operator: string;
      switch (clause.operator) {
        case 'Eq':
          operator = '=';
          break;
        case 'Gt':
          operator = '>';
          break;
        case 'Lt':
          operator = '<';
          break;
        case 'Geq':
          operator = '>=';
          break;
        case 'Leq':
          operator = '<=';
          break;
        case 'Neq':
          operator = '!=';
          break;
        default:
          throw new Error(`Unhandled operator: ${clause.operator}`);
      }
      return values.join(` ${operator} `);
    }
    if (clause.type === 'column') {
      return this.quoteIdentifier(clause.value);
    }
    if (typeof clause.value === 'string') {
      return `'${clause.value}'`;
    }
    return JSON.stringify(clause.value);
  }

  private compileGrantQuery(permission: Permission, entities: SQLEntities): string[] {
    switch (permission.type) {
      case 'schema':
        switch (permission.privilege) {
          case 'USAGE':
            return [
              `GRANT USAGE ON SCHEMA ${this.quoteSchemaName(permission.schema)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            ];
          default:
            throw new Error(`Invalid schema privilege: ${(permission as any).privilege};`);
        }
      case 'table':
        let columnPart = '';
        if (!isTrueClause(permission.columnClause)) {
          const table = entities.tables.filter((table) =>
            table.schema === permission.table.schema &&
            table.name === permission.table.name
          )[0]!;
          const columnNames = table.columns.filter((column) =>
            this.evalColumnQuery(permission.columnClause, column)
          );
          const colNameList = columnNames.map((col) => this.quoteIdentifier(col));          
          columnPart = ` (${colNameList.join(', ')})`;
        }

        switch (permission.privilege) {
          case 'SELECT': {
            const out = [
              `GRANT SELECT${columnPart} ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name
              ].join('_').toLowerCase();

              out.push(
                `CREATE POLICY ${policyName} ON ${this.quoteTableName(permission.table)} ` +
                `AS RESTRICTIVE FOR SELECT TO ${this.quoteUserName(permission.user)} ` +
                `USING (${this.clauseToSql(permission.rowClause)});`
              );
            }
            return out;
          }
          case 'INSERT': {
            const out = [
              `GRANT INSERT${columnPart} ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name
              ].join('_').toLowerCase();

              out.push(
                `CREATE POLICY ${policyName} ON ${this.quoteTableName(permission.table)} ` +
                `AS RESTRICTIVE FOR INSERT TO ${this.quoteUserName(permission.user)} ` +
                `WITH CHECK (${this.clauseToSql(permission.rowClause)});`
              );
            }
            return out;
          }
          case 'UPDATE': {
            const out = [
              `GRANT UPDATE${columnPart} ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name
              ].join('_').toLowerCase();

              out.push(
                `CREATE POLICY ${policyName} ON ${this.quoteTableName(permission.table)} ` +
                `AS RESTRICTIVE FOR UPDATE TO ${this.quoteUserName(permission.user)} ` +
                `USING (${this.clauseToSql(permission.rowClause)});`
              );
            }
            return out;
          }
          case 'DELETE': {
            const out = [
              `GRANT DELETE ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            ];
            if (!isTrueClause(permission.rowClause)) {
              const policyName = [
                permission.privilege,
                permission.table.schema,
                permission.table.name,
                permission.user.name
              ].join('_').toLowerCase();

              out.push(
                `CREATE POLICY ${policyName} ON ${this.quoteTableName(permission.table)} ` +
                `AS RESTRICTIVE FOR DELETE TO ${this.quoteUserName(permission.user)} ` +
                `USING (${this.clauseToSql(permission.rowClause)});`
              );
            }
            return out;
          }
          default:
            throw new Error(`Invalid table privilege: ${(permission as any).privilege}`)
        }
    }
  }

}
