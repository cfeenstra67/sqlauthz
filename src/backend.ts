import type {
  Permission,
  SQLActor,
  SQLDirectPrivilege,
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
  directPrivileges?: SQLDirectPrivilege[];
  roleMemberships?: { role: string; member: string }[];
}

export interface SQLBackendContext {
  setupQuery?: string;
  teardownQuery?: string;
  transactionStartQuery?: string;
  transactionCommitQuery?: string;
  removeAllPermissionsFromActorsQueries: (
    users: SQLActor[],
    entities: SQLEntities,
  ) => string[];
  reconcilePermissionsQueries: (
    users: SQLActor[],
    permissions: Permission[],
    entities: SQLEntities,
  ) => string[];
  compilePrivilegeGrantQueries: (
    permissions: Permission[],
    entities: SQLEntities,
  ) => string[];
  compileRlsQueries: (
    users: SQLActor[],
    permissions: Permission[],
    entities: SQLEntities,
    reconcile: boolean,
  ) => string[];
}

export interface SQLBackend {
  fetchEntities: () => Promise<SQLEntities>;

  getContext: (entities: SQLEntities) => Promise<SQLBackendContext>;
}
