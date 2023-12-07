import { SQLBackend, SQLBackendContext, SQLEntities } from "./backend.js";

export interface SQLTable {
  type: 'table';
  schema: string;
  name: string;
}

export interface SQLTableMetadata extends SQLTable {
  columns: string[];
}

export interface SQLUser {
  name: string;
}

export interface SQLSchema {
  type: 'schema';
  name: string;
}

export const TablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE'
] as const;

export type TablePrivilege = typeof TablePrivileges[number];

export const SchemaPrivileges = [
  'USAGE',
] as const;

export type SchemaPrivilege = typeof SchemaPrivileges[number];

export interface BasePermission {
  user: SQLUser;
}

export interface TablePermission extends BasePermission {
  type: 'table';
  table: SQLTable;
  privilege: TablePrivilege;
}

export interface SchemaPermission extends BasePermission {
  type: 'schema';
  schema: SQLSchema;
  privilege: SchemaPrivilege;
}

export type Permission = TablePermission | SchemaPermission;

export function parseTableName(tableName: string): SQLTable | null {
  const parts = tableName.split('.');
  if (parts.length !== 2) {
    return null;
  }
  return {
    type: 'table',
    name: parts[1]!,
    schema: parts[0]!,
  };
}

export function formatTableName(table: SQLTable): string {
  return `${table.schema}.${table.name}`;
}

export interface UserRevokePolicyAll {
  type: 'all';
}

export interface UserRevokePolicyReferenced {
  type: 'referenced';
}

export interface UserRevokePolicyExplicit {
  type: 'explicit';
  usernames: string[];
}

export type UserRevokePolicy =
  | UserRevokePolicyAll
  | UserRevokePolicyReferenced
  | UserRevokePolicyExplicit;

export interface ConstructFullQueryArgs {
  backend: SQLBackend;
  context: SQLBackendContext;
  entities: SQLEntities;
  userRevokePolicy?: UserRevokePolicy;
  permissions: Permission[];
  includeSetupAndTeardown?: boolean;
  includeTransaction?: boolean;
}

export function constructFullQuery({
  backend,
  entities,
  context,
  userRevokePolicy,
  permissions,
  includeSetupAndTeardown,
  includeTransaction,
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

  if (context.setupQuery && includeSetupAndTeardown) {
    queryParts.push(context.setupQuery);
  }
  
  if (includeSetupAndTeardown) {
    const revokePolicy = userRevokePolicy ?? { type: 'referenced' };
    let usersToRevoke: string[];
    switch (revokePolicy.type) {
      case 'all':
        usersToRevoke = entities.users.map((user) => user.name);
        break;
      case 'explicit':
        const allUsernames = new Set(entities.users.map((user) => user.name));
        usersToRevoke = revokePolicy.usernames.filter((username) =>
          allUsernames.has(username)      
        );
        break;
      case 'referenced':
        const referencedUsers = new Set(
          permissions.map((permission) => permission.user.name)
        );
        usersToRevoke = Array.from(referencedUsers);
    }
  
    for (const username of usersToRevoke) {
      queryParts.push(context.removeAllPermissionsFromUserQuery({ name: username }));
    }
  }

  const grantQueries = permissions.map((permission) =>
    backend.compileGrantQuery(permission)
  );
  queryParts.push(...grantQueries);

  if (context.teardownQuery && includeSetupAndTeardown) {
    queryParts.push(context.teardownQuery);
  }
  if (context.transactionCommitQuery && includeTransaction) {
    queryParts.push(context.transactionCommitQuery);
  }

  return queryParts.join('\n');
}
