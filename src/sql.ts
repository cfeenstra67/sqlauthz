
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
