import { SQLSchema, SQLTableMetadata, SQLUser } from "./sql.js";

export interface SQLEntities {
  users: SQLUser[];
  schemas: SQLSchema[];
  tables: SQLTableMetadata[];
}

export interface SQLBackend {
  fetchEntities(): Promise<SQLEntities>;
}
