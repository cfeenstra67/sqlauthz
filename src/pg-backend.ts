import pg from 'pg';
import { SQLBackend, SQLEntities } from "./backend.js";
import { SQLTableMetadata } from './sql.js';

export class PostgresBackend implements SQLBackend {

  private readonly client: pg.Client;

  constructor(config?: string | pg.ClientConfig) {
    this.client = new pg.Client(config)
  }

  private async useConnection<T>(func: () => Promise<T>): Promise<T> {
    await this.client.connect();
    try {
      return await func();
    } finally {
      await this.client.end();
    }
  }

  async fetchEntities(): Promise<SQLEntities> {
    return await this.useConnection(async () => {
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
    });
  }

}
