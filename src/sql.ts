import type { SQLBackendContext, SQLEntities } from "./backend.js";
import type { Clause } from "./clause.js";

export interface SQLTable {
  type: "table";
  schema: string;
  name: string;
}

export interface SQLView {
  type: "view";
  schema: string;
  name: string;
}

export interface SQLTableMetadata {
  type: "table-metadata";
  table: SQLTable;
  rlsEnabled: boolean;
  columns: string[];
}

export interface SQLSchema {
  type: "schema";
  name: string;
}

export const SQLRowLevelSecurityPolicyPrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
] as const satisfies TablePrivilege[];

export type SQLRowLevelSecurityPolicyPrivilege =
  (typeof SQLRowLevelSecurityPolicyPrivileges)[number];

export interface SQLRowLevelSecurityPolicy {
  type: "rls-policy";
  name: string;
  table: SQLTable;
  permissive: "PERMISSIVE" | "RESTRICTIVE";
  privileges: Set<SQLRowLevelSecurityPolicyPrivilege>;
  isDefault: boolean;
  users: SQLUser[];
  groups: SQLGroup[];
}

export interface SQLFunction {
  type: "function";
  schema: string;
  name: string;
  builtin: boolean;
}

export interface SQLProcedure {
  type: "procedure";
  schema: string;
  name: string;
  builtin: boolean;
}

export interface SQLSequence {
  type: "sequence";
  schema: string;
  name: string;
}

export interface SQLUser {
  type: "user";
  name: string;
}

export interface SQLGroup {
  type: "group";
  name: string;
  users: SQLUser[];
}

export type SQLActor = SQLUser | SQLGroup;

export const TablePrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

export type TablePrivilege = (typeof TablePrivileges)[number];

export const ViewPrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRIGGER",
] as const;

export type ViewPrivilege = (typeof ViewPrivileges)[number];

export const SchemaPrivileges = ["USAGE", "CREATE"] as const;

export type SchemaPrivilege = (typeof SchemaPrivileges)[number];

export const FunctionPrivileges = ["EXECUTE"] as const;

export type FunctionPrivilege = (typeof FunctionPrivileges)[number];

export const ProcedurePrivileges = ["EXECUTE"] as const;

export type ProcedurePrivilege = (typeof FunctionPrivileges)[number];

export const SequencePrivileges = ["USAGE", "SELECT", "UPDATE"] as const;

export type SequencePrivilege = (typeof SequencePrivileges)[number];

export interface BasePermission {
  user: SQLActor;
}

export interface TablePermission extends BasePermission {
  type: "table";
  table: SQLTable;
  privilege: TablePrivilege;
  columnClause: Clause;
  rowClause: Clause;
}

export interface SchemaPermission extends BasePermission {
  type: "schema";
  schema: SQLSchema;
  privilege: SchemaPrivilege;
}

export interface ViewPermission extends BasePermission {
  type: "view";
  view: SQLView;
  privilege: ViewPrivilege;
}

export interface FunctionPermission extends BasePermission {
  type: "function";
  function: SQLFunction;
  privilege: FunctionPrivilege;
}

export interface ProcedurePermission extends BasePermission {
  type: "procedure";
  procedure: SQLProcedure;
  privilege: ProcedurePrivilege;
}

export interface SequencePermission extends BasePermission {
  type: "sequence";
  sequence: SQLSequence;
  privilege: SequencePrivilege;
}

export type Permission =
  | TablePermission
  | SchemaPermission
  | ViewPermission
  | FunctionPermission
  | ProcedurePermission
  | SequencePermission;

export type Privilege = {
  [P in Permission as P["type"]]: P["privilege"];
}[Permission["type"]];

export interface SQLDirectPrivilege {
  actor: string;
  type: Permission["type"];
  schema: string;
  name?: string;
  privilege: Privilege;
  column?: string;
  grantOption: boolean;
}

export function parseQualifiedName(tableName: string): [string, string] | null {
  const parts = tableName.split(".");
  if (parts.length !== 2) {
    return null;
  }
  return parts as [string, string];
}

export function formatQualifiedName(schema: string, name: string): string {
  return `${schema}.${name}`;
}

export interface ConstructFullQueryArgs {
  context: SQLBackendContext;
  entities: SQLEntities;
  revokeUsers: SQLActor[];
  permissions: Permission[];
  includeSetupAndTeardown?: boolean;
  includeTransaction?: boolean;
  reconcile?: boolean;
}

export function constructFullQuery({
  entities,
  context,
  revokeUsers,
  permissions,
  includeSetupAndTeardown,
  includeTransaction,
  reconcile,
}: ConstructFullQueryArgs): string {
  if (includeSetupAndTeardown === undefined) {
    includeSetupAndTeardown = true;
  }
  if (includeTransaction === undefined) {
    includeTransaction = true;
  }

  const queryParts: string[] = [];

  if (context.transactionStartQuery && includeTransaction) {
    queryParts.push(context.transactionStartQuery);
  }

  if (context.setupQuery && includeSetupAndTeardown && !reconcile) {
    queryParts.push(context.setupQuery);
  }

  if (reconcile) {
    const reconcileQueries = context.reconcilePermissionsQueries(
      revokeUsers,
      permissions,
      entities,
    );
    queryParts.push(...reconcileQueries);
  } else if (includeSetupAndTeardown) {
    queryParts.push(
      ...context.removeAllPermissionsFromActorsQueries(revokeUsers, entities),
    );
  }

  queryParts.push(...context.compileRlsQueries(permissions, entities));
  if (!reconcile) {
    queryParts.push(
      ...context.compilePrivilegeGrantQueries(permissions, entities),
    );
  }

  if (context.teardownQuery && includeSetupAndTeardown && !reconcile) {
    queryParts.push(context.teardownQuery);
  }
  if (context.transactionCommitQuery && includeTransaction) {
    queryParts.push(context.transactionCommitQuery);
  }

  return queryParts.join("\n");
}
