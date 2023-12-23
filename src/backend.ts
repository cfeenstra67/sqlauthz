import {
  Permission,
  SQLFunction,
  SQLGroup,
  SQLProcedure,
  SQLRowLevelSecurityPolicy,
  SQLSchema,
  SQLSequence,
  SQLTableMetadata,
  SQLUser,
  SQLView,
} from "./sql.js";

export interface SQLEntities {
  users: SQLUser[];
  groups: SQLGroup[];
  schemas: SQLSchema[];
  tables: SQLTableMetadata[];
  views: SQLView[];
  rlsPolicies: SQLRowLevelSecurityPolicy[];
  functions: SQLFunction[];
  procedures: SQLProcedure[];
  sequences: SQLSequence[];
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

  getContext: (entities: SQLEntities) => Promise<SQLBackendContext>;
}
