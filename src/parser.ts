import { Oso, Variable } from "oso";
import { SQLEntities } from "./backend.js";
import {
  Clause,
  Column,
  EvaluateClauseArgs,
  ValidationError,
  Value,
  evaluateClause,
  factorOrClauses,
  isTrueClause,
  mapClauses,
  optimizeClause,
  simpleEvaluator,
  valueToClause,
} from "./clause.js";
import { LiteralsContext } from "./oso.js";
import {
  Permission,
  Privilege,
  SQLActor,
  SQLSchema,
  SQLTableMetadata,
  SQLView,
  SchemaPermission,
  SchemaPrivileges,
  TablePermission,
  TablePrivileges,
  ViewPermission,
  ViewPrivileges,
  formatQualifiedName,
} from "./sql.js";
import { arrayProduct } from "./utils.js";

export interface ConvertPermissionSuccess<P extends Permission = Permission> {
  type: "success";
  permissions: P[];
}

export interface ConvertPermissionError {
  type: "error";
  errors: string[];
}

export type ConvertPermissionResult<P extends Permission = Permission> =
  | ConvertPermissionSuccess<P>
  | ConvertPermissionError;

interface ActorEvaluatorArgs {
  actor: SQLActor;
  debug?: boolean;
}

function actorEvaluator({
  actor,
  debug,
}: ActorEvaluatorArgs): EvaluateClauseArgs["evaluate"] {
  const variableName = "actor";
  const errorVariableName = debug
    ? actor.type === "user"
      ? `user(${actor.name})`
      : `group(${actor.name})`
    : variableName;
  return simpleEvaluator({
    variableName,
    errorVariableName,
    getValue: (value) => {
      if (value.type === "value") {
        return value.value;
      }
      if (value.type === "function-call") {
        throw new ValidationError(
          `${errorVariableName}: invalid function call`,
        );
      }
      if (value.value === "_this" || value.value === "_this.name") {
        return actor.name;
      }
      if (value.value === "_this.type") {
        return actor.type;
      }
      throw new ValidationError(
        `${errorVariableName}: invalid user field: ${value.value}`,
      );
    },
  });
}

type TableEvaluatorMatch = {
  type: "match";
  columnClause: Clause;
  rowClause: Clause;
};

type TableEvaluatorNoMatch = {
  type: "no-match";
};

type TableEvaluatorError = {
  type: "error";
  errors: string[];
};

type TableEvaluatorResult =
  | TableEvaluatorMatch
  | TableEvaluatorNoMatch
  | TableEvaluatorError;

interface TableEvaluatorArgs {
  table: SQLTableMetadata;
  clause: Clause;
  debug?: boolean;
  strictFields?: boolean;
}

function tableEvaluator({
  table,
  clause,
  debug,
  strictFields,
}: TableEvaluatorArgs): TableEvaluatorResult {
  const tableName = formatQualifiedName(table.table.schema, table.table.name);
  const variableName = "resource";
  const errorVariableName = debug ? `table(${tableName})` : variableName;

  const metaEvaluator = simpleEvaluator({
    variableName,
    errorVariableName,
    getValue: (value) => {
      if (value.type === "value") {
        return value.value;
      }
      if (value.type === "function-call") {
        throw new ValidationError(
          `${errorVariableName}: invalid function call`,
        );
      }
      if (value.value === "_this") {
        return tableName;
      }
      if (value.value === "_this.name") {
        return table.table.name;
      }
      if (value.value === "_this.schema") {
        return table.table.schema;
      }
      if (value.value === "_this.type") {
        return table.table.type;
      }
      throw new ValidationError(
        `${errorVariableName}: invalid table field: ${value.value}`,
      );
    },
  });

  const andParts = clause.type === "and" ? clause.clauses : [clause];

  const getColumnSpecifier = (column: Column) => {
    let rest: string;
    if (column.value.startsWith("_this.")) {
      rest = column.value.slice("_this.".length);
    } else if (column.value.startsWith(`${tableName}.`)) {
      rest = column.value.slice(`${tableName}.`.length);
    } else {
      return null;
    }
    const restParts = rest.split(".");
    if (restParts[0] === "col" && restParts.length === 1) {
      return { type: "col" } as const;
    }
    if (restParts[0] === "row" && restParts.length === 2) {
      return { type: "row", row: restParts[1]! } as const;
    }
    return null;
  };

  const isColumnClause = (clause: Clause) => {
    if (clause.type === "not") {
      return isColumnClause(clause.clause);
    }
    if (clause.type === "expression") {
      let colCount = 0;
      for (const value of clause.values) {
        if (value.type === "value") {
          continue;
        }
        if (value.type === "function-call") {
          const someCol = value.args.some((arg) => isColumnClause(arg));
          if (someCol) {
            colCount++;
          }
          continue;
        }
        const spec = getColumnSpecifier(value);
        if (spec && spec.type === "col") {
          colCount++;
          continue;
        }
        return false;
      }
      return colCount > 0;
    }
    if (clause.type === "function-call") {
      let colCount = 0;
      for (const value of clause.args) {
        if (value.type === "value") {
          continue;
        }
        if (value.type === "function-call") {
          const someCol = value.args.some((arg) => isColumnClause(arg));
          if (someCol) {
            colCount++;
          }
          continue;
        }
        const spec = getColumnSpecifier(value);
        if (spec && spec.type === "col") {
          colCount++;
          continue;
        }
        return false;
      }
      return colCount > 0;
    }
    return false;
  };

  const isRowClause = (clause: Clause) => {
    if (clause.type === "not") {
      return isRowClause(clause.clause);
    }
    if (clause.type === "expression") {
      let colCount = 0;
      for (const value of clause.values) {
        if (value.type === "value") {
          continue;
        }
        if (value.type === "function-call") {
          const someCol = value.args.some((arg) => isRowClause(arg));
          if (someCol) {
            colCount++;
          }
          continue;
        }
        const spec = getColumnSpecifier(value);
        if (spec && spec.type === "row") {
          colCount++;
          continue;
        }
        return false;
      }
      return colCount > 0;
    }
    if (clause.type === "function-call") {
      let colCount = 0;
      for (const value of clause.args) {
        if (value.type === "value") {
          continue;
        }
        if (value.type === "function-call") {
          const someCol = value.args.some((arg) => isRowClause(arg));
          if (someCol) {
            colCount++;
          }
          continue;
        }
        const spec = getColumnSpecifier(value);
        if (spec && spec.type === "row") {
          colCount++;
          continue;
        }
        return false;
      }
      return colCount > 0;
    }
    if (clause.type === "column") {
      const spec = getColumnSpecifier(clause);
      return spec && spec.type === "row";
    }
    return false;
  };

  const metaClauses: Clause[] = [];
  const colClauses: Clause[] = [];
  const rowClauses: Clause[] = [];
  for (const clause of andParts) {
    if (isColumnClause(clause)) {
      colClauses.push(clause);
    } else if (isRowClause(clause)) {
      rowClauses.push(clause);
    } else {
      metaClauses.push(clause);
    }
  }

  const rawColClause: Clause =
    colClauses.length === 1
      ? colClauses[0]!
      : { type: "and", clauses: colClauses };

  const errors: string[] = [];

  const columnClause = mapClauses(rawColClause, (clause) => {
    if (clause.type === "column") {
      return { type: "column", value: "col" };
    }
    if (clause.type === "value") {
      if (typeof clause.value !== "string") {
        errors.push(
          `${errorVariableName}: invalid column specifier: ${clause.value}`,
        );
      } else if (!table.columns.includes(clause.value)) {
        errors.push(
          `${errorVariableName}: invalid column for ${tableName}: ${clause.value}`,
        );
      }
    }
    return clause;
  });

  const rawRowClause: Clause =
    rowClauses.length === 1
      ? rowClauses[0]!
      : { type: "and", clauses: rowClauses };

  const rowClause = mapClauses(rawRowClause, (clause) => {
    if (clause.type === "column") {
      let key: string;
      if (clause.value.startsWith(`${tableName}.`)) {
        key = clause.value.slice(`${tableName}.row.`.length);
      } else {
        key = clause.value.slice("_this.row.".length);
      }
      if (!table.columns.includes(key)) {
        errors.push(
          `${errorVariableName}: invalid column for ${tableName}: ${key}`,
        );
      }
      return { type: "column", value: key };
    }
    return clause;
  });

  const evalResult = evaluateClause({
    clause: { type: "and", clauses: metaClauses },
    evaluate: metaEvaluator,
    strictFields,
  });
  if (evalResult.type === "error") {
    return evalResult;
  }
  if (!evalResult.result) {
    return { type: "no-match" };
  }
  if (errors.length > 0) {
    return { type: "error", errors };
  }
  return {
    type: "match",
    columnClause,
    rowClause,
  };
}

interface SchemaEvaluatorArgs {
  schema: SQLSchema;
  debug?: boolean;
}

function schemaEvaluator({
  schema,
  debug,
}: SchemaEvaluatorArgs): EvaluateClauseArgs["evaluate"] {
  const variableName = "resource";
  const errorVariableName = debug ? `schema(${schema.name})` : variableName;
  return simpleEvaluator({
    variableName,
    errorVariableName,
    getValue: (value) => {
      if (value.type === "value") {
        return value.value;
      }
      if (value.type === "function-call") {
        throw new ValidationError(
          `${errorVariableName}: invalid function call`,
        );
      }
      if (
        value.value === "_this" ||
        value.value === "_this.name" ||
        value.value === "_this.schema"
      ) {
        return schema.name;
      }
      if (value.value === "_this.type") {
        return schema.type;
      }
      throw new ValidationError(
        `${errorVariableName}: invalid schema field: ${value.value}`,
      );
    },
  });
}

interface ViewEvaluatorArgs {
  view: SQLView;
  debug?: boolean;
}

function viewEvaluator({
  view,
  debug,
}: ViewEvaluatorArgs): EvaluateClauseArgs["evaluate"] {
  const variableName = "resource";
  const errorVariableName = debug ? `view(${view.name})` : variableName;
  return simpleEvaluator({
    variableName,
    errorVariableName,
    getValue: (value) => {
      if (value.type === "value") {
        return value.value;
      }
      if (value.type === "function-call") {
        throw new ValidationError(
          `${errorVariableName}: invalid function call`,
        );
      }
      if (value.value === "_this" || value.value === "_this.name") {
        return formatQualifiedName(view.schema, view.name);
      }
      if (value.value === "_this.type") {
        return view.type;
      }
      throw new ValidationError(
        `${errorVariableName}: invalid view field: ${value.value}`,
      );
    },
  });
}

interface PermissionEvaluatorArgs {
  permission: string;
  debug?: boolean;
}

function permissionEvaluator({
  permission,
  debug,
}: PermissionEvaluatorArgs): EvaluateClauseArgs["evaluate"] {
  const variableName = "action";
  const errorVariableName = debug ? `permission(${permission})` : variableName;

  return simpleEvaluator({
    variableName,
    errorVariableName,
    getValue: (value) => {
      if (value.type === "function-call") {
        throw new ValidationError(
          `${errorVariableName}: invalid function call`,
        );
      }
      if (value.type === "value" && typeof value.value === "string") {
        return value.value.toUpperCase();
      }
      if (value.type === "value") {
        return value.value;
      }
      if (value.value === "_this" || value.value === "_this.name") {
        return permission.toUpperCase();
      }
      throw new ValidationError(
        `${errorVariableName}: invalid permission field: ${value.value}`,
      );
    },
  });
}

function isIdentityClause(clause: Clause, variable: string): boolean {
  return clause.type === "column" && clause.value === variable;
}

interface GetPermissionsArgs<P extends Permission> {
  clause: Clause;
  users: SQLActor[];
  privileges: P["privilege"][];
  entities: SQLEntities;
  strictFields?: boolean;
  debug?: boolean;
}

interface DatabaseObjectTypeHandler<P extends Permission> {
  privileges: readonly P["privilege"][];
  getPermissions: (args: GetPermissionsArgs<P>) => ConvertPermissionResult<P>;
  getDeduplicationKey: (permission: P) => string;
  deduplicate: (permissions: P[]) => P;
}

type Handlers = {
  [P in Permission as P["type"]]: DatabaseObjectTypeHandler<P>;
};

const handlers: Handlers = {
  table: {
    privileges: TablePrivileges,
    getPermissions: ({
      clause,
      users,
      privileges,
      entities,
      strictFields,
      debug,
    }) => {
      if (privileges.length === 0) {
        return { type: "success", permissions: [] };
      }
      const errors: string[] = [];
      const permissions: TablePermission[] = [];
      for (const table of entities.tables) {
        const result = tableEvaluator({
          table,
          clause,
          strictFields,
          debug,
        });
        if (result.type === "error") {
          errors.push(...result.errors);
        } else if (result.type === "match") {
          for (const [user, privilege] of arrayProduct([users, privileges])) {
            permissions.push({
              type: "table",
              table: table.table,
              user,
              privilege,
              columnClause: result.columnClause,
              rowClause: result.rowClause,
            });
          }
        }
      }
      if (errors.length > 0) {
        return { type: "error", errors };
      }
      return { type: "success", permissions };
    },
    getDeduplicationKey: (permission) => {
      return [
        permission.type,
        permission.privilege,
        permission.user.name,
        formatQualifiedName(permission.table.schema, permission.table.name),
      ].join(",");
    },
    deduplicate: (permissions) => {
      const [first, ...rest] = permissions;
      const rowClause = optimizeClause({
        type: "or",
        clauses: [first!.rowClause, ...rest.map((perm) => perm.rowClause)],
      });
      const columnClause = optimizeClause({
        type: "or",
        clauses: [
          first!.columnClause,
          ...rest.map((perm) => perm.columnClause),
        ],
      });
      return {
        type: "table",
        user: first!.user,
        table: first!.table,
        privilege: first!.privilege,
        rowClause,
        columnClause,
      };
    },
  },
  schema: {
    privileges: SchemaPrivileges,
    getPermissions: ({
      clause,
      users,
      privileges,
      entities,
      strictFields,
      debug,
    }) => {
      if (privileges.length === 0) {
        return { type: "success", permissions: [] };
      }

      const errors: string[] = [];
      const schemas: SQLSchema[] = [];
      const permissions: SchemaPermission[] = [];
      for (const schema of entities.schemas) {
        const result = evaluateClause({
          clause,
          evaluate: schemaEvaluator({ schema, debug }),
          strictFields,
        });
        if (result.type === "error") {
          errors.push(...result.errors);
        } else if (result.result) {
          schemas.push(schema);
        }
      }

      for (const [user, privilege, schema] of arrayProduct([
        users,
        privileges,
        schemas,
      ])) {
        permissions.push({
          type: "schema",
          schema,
          privilege,
          user,
        });
      }

      if (errors.length > 0) {
        return { type: "error", errors };
      }
      return { type: "success", permissions };
    },
    getDeduplicationKey: (permission) => {
      return [
        permission.type,
        permission.privilege,
        permission.user.name,
        permission.schema.name,
      ].join(",");
    },
    deduplicate: (permissions) => {
      return permissions[0]!;
    },
  },
  view: {
    privileges: ViewPrivileges,
    getPermissions: ({
      clause,
      users,
      privileges,
      entities,
      strictFields,
      debug,
    }) => {
      const views: SQLView[] = [];
      const errors: string[] = [];
      const permissions: ViewPermission[] = [];
      for (const view of entities.views) {
        const result = evaluateClause({
          clause,
          evaluate: viewEvaluator({ view, debug }),
          strictFields,
        });
        if (result.type === "error") {
          errors.push(...result.errors);
        } else if (result.result) {
          views.push(view);
        }
      }

      for (const [user, privilege, view] of arrayProduct([
        users,
        privileges,
        views,
      ])) {
        permissions.push({
          type: "view",
          view,
          privilege,
          user,
        });
      }

      if (errors.length > 0) {
        return { type: "error", errors };
      }
      return { type: "success", permissions };
    },
    getDeduplicationKey: (permission) => {
      return [
        permission.type,
        permission.privilege,
        permission.user.name,
        formatQualifiedName(permission.view.schema, permission.view.name),
      ].join(",");
    },
    deduplicate: (permissions) => {
      return permissions[0]!;
    },
  },
};

export interface ConvertPermissionArgs {
  result: Map<string, unknown>;
  entities: SQLEntities;
  allowAnyActor?: boolean;
  strictFields?: boolean;
  debug?: boolean;
  literals: Map<string, Value>;
}

export function convertPermission({
  result,
  entities,
  allowAnyActor,
  strictFields,
  debug,
  literals,
}: ConvertPermissionArgs): ConvertPermissionResult {
  const resource = result.get("resource");
  const action = result.get("action");
  const actor = result.get("actor");

  const getClause = (arg: unknown): Clause => {
    const clause = valueToClause(arg);
    return mapClauses(clause, (subClause) => {
      if (subClause.type !== "column") {
        return subClause;
      }
      const literal = literals.get(subClause.value);
      if (!literal) {
        return subClause;
      }
      return literal;
    });
  };

  const actorClause = getClause(actor);
  const actionClause = getClause(action);
  const resourceClause = getClause(resource);

  const actorOrs = factorOrClauses(actorClause);
  const actionOrs = factorOrClauses(actionClause);
  const resourceOrs = factorOrClauses(resourceClause);

  const errors: string[] = [];
  const permissions: Permission[] = [];

  for (const [actorOr, actionOr, resourceOr] of arrayProduct([
    actorOrs,
    actionOrs,
    resourceOrs,
  ])) {
    if (
      !allowAnyActor &&
      (isTrueClause(actorOr) || isIdentityClause(actorOr, "actor"))
    ) {
      errors.push("rule does not specify a user");
    }

    const users: SQLActor[] = [];
    const allActors = (entities.users as SQLActor[]).concat(entities.groups);
    for (const actor of allActors) {
      const result = evaluateClause({
        clause: actorOr,
        evaluate: actorEvaluator({ actor, debug }),
        strictFields,
      });
      if (result.type === "error") {
        errors.push(...result.errors);
      } else if (result.result) {
        users.push(actor);
      }
    }

    if (users.length === 0) {
      continue;
    }

    for (const handler of Object.values(handlers)) {
      const privileges: Privilege[] = [];
      for (const privilege of handler.privileges) {
        const result = evaluateClause({
          clause: actionOr,
          evaluate: permissionEvaluator({ permission: privilege, debug }),
          strictFields,
        });
        if (result.type === "error") {
          errors.push(...result.errors);
        } else if (result.result) {
          privileges.push(privilege);
        }
      }

      const result = handler.getPermissions({
        clause: resourceOr,
        // biome-ignore lint/suspicious/noExplicitAny: tricky type situation
        privileges: privileges as any,
        users,
        entities,
        strictFields,
        debug,
      });

      if (result.type === "success") {
        permissions.push(...result.permissions);
      } else {
        errors.push(...result.errors);
      }
    }
  }

  if (errors.length > 0) {
    return {
      type: "error",
      errors,
    };
  }

  return {
    type: "success",
    permissions,
  };
}

export interface ParsePermissionsArgs {
  oso: Oso;
  entities: SQLEntities;
  allowAnyActor?: boolean;
  strictFields?: boolean;
  debug?: boolean;
  literalsContext: LiteralsContext;
}

export async function parsePermissions({
  oso,
  entities,
  allowAnyActor,
  strictFields,
  debug,
  literalsContext,
}: ParsePermissionsArgs): Promise<ConvertPermissionResult> {
  return await literalsContext.use(async () => {
    const result = oso.queryRule(
      {
        acceptExpression: true,
      },
      "allow",
      new Variable("actor"),
      new Variable("action"),
      new Variable("resource"),
    );

    const permissions: Permission[] = [];
    const errors: string[] = [];

    for await (const item of result) {
      const result = convertPermission({
        result: item,
        entities,
        allowAnyActor,
        strictFields,
        debug,
        literals: literalsContext.get(),
      });
      if (result.type === "success") {
        permissions.push(...result.permissions);
      } else {
        errors.push(...result.errors);
      }
    }

    if (errors.length > 0) {
      return {
        type: "error",
        errors: Array.from(new Set(errors)),
      };
    }

    return {
      type: "success",
      permissions,
    };
  });
}

export function deduplicatePermissions(
  permissions: Permission[],
): Permission[] {
  const permissionsByKey: Record<string, Permission[]> = {};
  for (const permission of permissions) {
    const handler = handlers[permission.type];
    // biome-ignore lint/suspicious/noExplicitAny: deep type intersection
    const key = handler.getDeduplicationKey(permission as any);

    permissionsByKey[key] ??= [];
    permissionsByKey[key]!.push(permission);
  }

  const outPermissions: Permission[] = [];
  for (const groupedPermissions of Object.values(permissionsByKey)) {
    const first = groupedPermissions[0]!;
    const handler = handlers[first.type];
    // biome-ignore lint/suspicious/noExplicitAny: deep type intersection
    const newPermission = handler.deduplicate(groupedPermissions as any);
    outPermissions.push(newPermission);
  }

  return outPermissions;
}
