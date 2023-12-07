import { Oso, Variable } from "oso";
import { Permission, SQLSchema, SQLTable, SQLTableMetadata, SQLUser, SchemaPrivilege, SchemaPrivileges, TablePrivilege, TablePrivileges, formatTableName } from "./sql.js";
import { arrayProduct, printQuery } from "./utils.js";
import { factorOrClauses, valueToClause, evaluateClause, EvaluateClauseArgs, Value } from "./clause.js";
import { SQLEntities } from "./backend.js";

export interface ConvertPermissionSuccess {
  type: 'success';
  permissions: Permission[];
}

export interface ConvertPermissionError {
  type: 'error';
  errors: string[];
}

export type ConvertPermissionResult = ConvertPermissionSuccess | ConvertPermissionError;

interface SimpleEvaluatorArgs {
  variableName: string;
  getValue: (value: Value) => any;
}

function simpleEvaluator({
  variableName,
  getValue,
}: SimpleEvaluatorArgs): EvaluateClauseArgs['evaluate'] {
  const func: EvaluateClauseArgs['evaluate'] = (expr) => {
    if (expr.type === 'column' && expr.value === variableName) {
      return { type: 'success', result: true }
    }
    if (expr.type === 'column') {
      return { type: 'error', errors: [`${variableName}: invalid reference: ${expr.value}`] };
    }
    if (expr.type === 'value') {
      return func({
        type: 'expression',
        operator: 'Eq',
        values: [
          { type: 'column', value: '_this' },
          expr
        ]
      });
    }
    if (expr.operator !== 'Eq') {
      return { type: 'error', errors: [`${variableName}: unsupported operator: ${expr.operator}`] }
    }
    if (expr.values[0].type === 'value' && expr.values[1].type === 'value') {
      return { type: 'success', result: expr.values[0].value === expr.values[1].value };
    }
    const errors: string[] = [];
    let left: any;
    let right: any;
    try {
      left = getValue(expr.values[0]);
    } catch (error) {
      if (error instanceof ValidationError) {
        errors.push(error.message);
      } else {
        throw error;
      }
    }
    try {
      right = getValue(expr.values[1]);
    } catch (error) {
      if (error instanceof ValidationError) {
        errors.push(error.message);
      } else {
        throw error;
      }
    }

    if (errors.length > 0) {
      return { type: 'error', errors }
    };

    return { type: 'success', result: left === right };
  };

  return func;
}

function userEvaluator(user: SQLUser): EvaluateClauseArgs['evaluate'] {
  return simpleEvaluator({
    variableName: 'actor',
    getValue: (value) => {
      if (value.type === 'value') {
        return value.value;
      }
      if (value.value === '_this' || value.value === '_this.name') {
        return user.name;
      }
      throw new ValidationError(`actor: invalid user field: ${value.value}`);
    }
  });
}

function tableEvaluator(table: SQLTableMetadata): EvaluateClauseArgs['evaluate'] {
  return simpleEvaluator({
    variableName: 'resource',
    getValue: (value) => {
      if (value.type === 'value') {
        return value.value;
      }
      if (value.value === '_this') {
        return formatTableName(table);
      }
      if (value.value === '_this.name') {
        return table.name;
      }
      if (value.value === '_this.schema') {
        return table.schema;
      }
      if (value.value === '_this.type') {
        return table.type;
      }
      throw new ValidationError(`resource: invalid table field: ${value.value}`);
    }
  });
}

function schemaEvaluator(schema: SQLSchema): EvaluateClauseArgs['evaluate'] {
  return simpleEvaluator({
    variableName: 'resource',
    getValue: (value) => {
      if (value.type === 'value') {
        return value.value;
      }
      if (value.value === '_this' || value.value === '_this.name') {
        return schema.name;
      }
      if (value.value === '_this.type') {
        return schema.type;
      }
      throw new ValidationError(`resource: invalid schema field: ${value.value}`);
    }
  });
}

function permissionEvaluator(permission: string): EvaluateClauseArgs['evaluate'] {
  return simpleEvaluator({
    variableName: 'action',
    getValue: (value) => {
      if (value.type === 'value' && typeof value.value === 'string') {
        return value.value.toUpperCase();
      }
      if (value.type === 'value') {
        return value.value;
      }
      if (value.value === '_this' || value.value === '_this.name') {
        return permission.toUpperCase();
      }
      throw new ValidationError(`action: invalid permission field: ${value.value}`);
    }
  });
}

export function convertPermission(result: Map<string, unknown>, entities: SQLEntities): ConvertPermissionResult {
  const resource = result.get('resource');
  const action = result.get('action');
  const actor = result.get('actor');

  const actorClause = valueToClause(actor);
  const actionClause = valueToClause(action);
  const resourceClause = valueToClause(resource);

  const actorOrs = factorOrClauses(actorClause);
  const actionOrs = factorOrClauses(actionClause);
  const resourceOrs = factorOrClauses(resourceClause);

  const errors: string[] = [];
  const permissions: Permission[] = [];

  for (const [actorOr, actionOr, resourceOr] of arrayProduct([actorOrs, actionOrs, resourceOrs])) {
    const users: SQLUser[] = [];
    for (const user of entities.users) {
      const result = evaluateClause({ clause: actorOr, evaluate: userEvaluator(user) });
      if (result.type === 'error') {
        errors.push(...result.errors);
      } else if (result.result) {
        users.push(user);
      }
    }

    if (users.length === 0) {
      continue;
    }

    const schemaPrivileges: SchemaPrivilege[] = [];
    for (const privilege of SchemaPrivileges) {
      const result = evaluateClause({ clause: actionOr, evaluate: permissionEvaluator(privilege) });
      if (result.type === 'error') {
        errors.push(...result.errors);
      } else if (result.result) {
        schemaPrivileges.push(privilege);
      }
    }

    if (schemaPrivileges.length > 0) {
      const schemas: SQLSchema[] = [];
      for (const schema of entities.schemas) {
        const result = evaluateClause({ clause: resourceOr, evaluate: schemaEvaluator(schema) });
        if (result.type === 'error') {
          errors.push(...result.errors);
        } else if (result.result) {
          schemas.push(schema);
        }
      }

      for (const [user, privilege, schema] of arrayProduct([users, schemaPrivileges, schemas])) {
        permissions.push({
          type: 'schema',
          schema,
          privilege,
          user
        });
      }
    }

    const tablePrivileges: TablePrivilege[] = [];
    for (const privilege of TablePrivileges) {
      const result = evaluateClause({ clause: actionOr, evaluate: permissionEvaluator(privilege) });
      if (result.type === 'error') {
        errors.push(...result.errors);
      } else if (result.result) {
        tablePrivileges.push(privilege);
      }
    }

    if (tablePrivileges.length > 0) {
      const tables: SQLTable[] = [];
      for (const table of entities.tables) {
        const result = evaluateClause({ clause: resourceOr, evaluate: tableEvaluator(table) });
        if (result.type === 'error') {
          errors.push(...result.errors);
        } else if (result.result) {
          tables.push({ type: 'table', schema: table.schema, name: table.name });
        }
      }

      for (const [user, privilege, table] of arrayProduct([users, tablePrivileges, tables])) {
        permissions.push({
          type: 'table',
          table,
          privilege,
          user
        });
      }
    }
  }

  if (errors.length > 0) {
    return {
      type: 'error',
      errors
    };
  }

  return {
    type: 'success',
    permissions
  };
}

export interface LoadPermissionsArgs {
  oso: Oso;
  entities: SQLEntities;
}

export async function parsePermissions({
  oso,
  entities,
}: LoadPermissionsArgs): Promise<ConvertPermissionResult> {
  const result = oso.queryRule(
    {
     acceptExpression: true
    },
    'allow',
    new Variable('actor'),
    new Variable('action'),
    new Variable('resource')
  );

  const permissions: Permission[] = [];
  const errors: string[] = [];

  for await (const item of result) {
    // Debugging
    console.log('\nQUERY\n', printQuery(item));
    const result = convertPermission(item, entities);
    if (result.type === 'success') {
      permissions.push(...result.permissions);
    } else {
      errors.push(...result.errors);
    }
  }

  if (errors.length > 0) {
    return {
      type: 'error',
      errors
    };
  }

  return {
    type: 'success',
    permissions
  };
}

export function deduplicatePermissions(permissions: Permission[]): Permission[] {
  const permissionsByKey: Record<string, Permission[]> = {};
  for (const permission of permissions) { 
    let key: string;
    if (permission.type === 'schema') {
      key = [permission.type, permission.privilege, permission.user, permission.schema.name].join(',');
    } else {
      key = [permission.type, permission.privilege, permission.user, formatTableName(permission.table)].join(',');
    }
    permissionsByKey[key] ??= [];
    permissionsByKey[key]!.push(permission);
  }
  return Object.values(permissionsByKey).map((permissions) => permissions[0]!);
}

class ValidationError extends Error {
  constructor(readonly message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
