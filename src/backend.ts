import { Permission, SQLSchema, SQLTableMetadata, SQLUser } from "./sql.js";

export interface SQLEntities {
  users: SQLUser[];
  schemas: SQLSchema[];
  tables: SQLTableMetadata[];
}

export interface SQLBackendContext {
  setupQuery?: string;
  teardownQuery?: string;
  transactionStartQuery?: string;
  transactionCommitQuery?: string;
  removeAllPermissionsFromUserQuery: (user: SQLUser) => string;
}

export interface SQLBackend {
  setup: () => Promise<void>;

  teardown: () => Promise<void>;

  fetchEntities: () => Promise<SQLEntities>;

  execute: (query: string) => Promise<void>;

  getContext: (entities: SQLEntities) => Promise<SQLBackendContext>;

  compileGrantQuery: (permission: Permission) => string;
}
