import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import pg from 'pg';
import { SQLBackend, SQLBackendContext, SQLEntities } from "./backend.js";
import { Permission, SQLSchema, SQLTable, SQLTableMetadata, SQLUser } from './sql.js';

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
    const tables = await this.client.query<{ schema: string; name: string; }>(
      `
        SELECT
          table_schema as "schema",
          table_name as "name"
        FROM
          information_schema.tables
        WHERE
          table_schema != 'information_schema'
          AND table_schema != 'pg_catalog'
          AND table_schema != 'pg_toast'
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

    const tableItems: Record<string, SQLTableMetadata> = {};
    for (const table of tables.rows) {
      const fullName = `${table.schema}.${table.name}`;
      tableItems[fullName] = {
        type: 'table',
        name: table.name,
        schema: table.schema,
        columns: []
      };
    }

    for (const row of columns.rows) {
      const fullName = `${row.schema}.${row.table}`;
      tableItems[fullName]!.columns.push(row.name);
    }

    return {
      users: users.rows,
      schemas: schemas.rows.map((row) => ({ type: 'schema', name: row.name })),
      tables: Object.values(tableItems)
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
      removeAllPermissionsFromUserQuery: (user) =>
        `SELECT ${tmpSchema}.revoke_all_from_role('${user.name}');`
    };
  }

  compileGrantQuery(permission: Permission): string {
    switch (permission.type) {
      case 'schema':
        switch (permission.privilege) {
          case 'USAGE':
            return (
              `GRANT USAGE ON SCHEMA ${this.quoteSchemaName(permission.schema)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            );
          default:
            throw new Error(`Invalid schema privilege: ${(permission as any).privilege};`);
        }
      case 'table':
        switch (permission.privilege) {
          case 'SELECT':
            return (
              `GRANT SELECT ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            );
          case 'INSERT':
            return (
              `GRANT INSERT ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            );
          case 'UPDATE':
            return (
              `GRANT UPDATE ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            );
          case 'DELETE':
            return (
              `GRANT DELETE ON ${this.quoteTableName(permission.table)} ` +
              `TO ${this.quoteUserName(permission.user)};`
            );
          default:
            throw new Error(`Invalid table privilege: ${(permission as any).privilege}`)
        }
    }
  }

}
