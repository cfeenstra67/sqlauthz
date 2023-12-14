import {
  Permission,
  SQLRowLevelSecurityPolicy,
  SQLSchema,
  SQLTableMetadata,
  SQLUser,
} from "./sql.js";

export interface SQLEntities {
  users: SQLUser[];
  schemas: SQLSchema[];
  tables: SQLTableMetadata[];
  rlsPolicies: SQLRowLevelSecurityPolicy[];
}

export interface SQLBackendContext {
  setupQuery?: string;
  teardownQuery?: string;
  transactionStartQuery?: string;
  transactionCommitQuery?: string;
  removeAllPermissionsFromUsersQueries: (
    users: SQLUser[],
    entities: SQLEntities,
  ) => string[];
  compileGrantQueries: (
    permissions: Permission[],
    entities: SQLEntities,
  ) => string[];
}

export interface SQLBackend {
  fetchEntities: () => Promise<SQLEntities>;

  execute: (query: string) => Promise<void>;

  getContext: (entities: SQLEntities) => Promise<SQLBackendContext>;
}
