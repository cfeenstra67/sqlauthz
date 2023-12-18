import { SQLBackend, SQLEntities } from "./backend.js";
import { CreateOsoArgs, createOso } from "./oso.js";
import { deduplicatePermissions, parsePermissions } from "./parser.js";
import { UserRevokePolicy, constructFullQuery } from "./sql.js";

export interface CompileQueryArgs extends Omit<CreateOsoArgs, "functions"> {
  backend: SQLBackend;
  entities?: SQLEntities;
  userRevokePolicy?: UserRevokePolicy;
  includeSetupAndTeardown?: boolean;
  includeTransaction?: boolean;
  strictFields?: boolean;
  allowAnyActor?: boolean;
  debug?: boolean;
}

export interface CompileQuerySuccess {
  type: "success";
  query: string;
}

export interface CompileQueryError {
  type: "error";
  errors: string[];
}

export type CompileQueryResult = CompileQuerySuccess | CompileQueryError;

export async function compileQuery({
  backend,
  entities,
  userRevokePolicy,
  includeSetupAndTeardown,
  includeTransaction,
  debug,
  strictFields,
  allowAnyActor,
  paths,
  vars,
}: CompileQueryArgs): Promise<CompileQueryResult> {
  if (entities === undefined) {
    entities = await backend.fetchEntities();
  }

  const { oso, literalsContext } = await createOso({
    paths,
    functions: entities.functions,
    vars,
  });

  const result = await parsePermissions({
    oso,
    entities,
    debug,
    strictFields,
    allowAnyActor,
    literalsContext,
  });

  if (result.type !== "success") {
    return result;
  }

  const context = await backend.getContext(entities);

  const permissions = deduplicatePermissions(result.permissions);

  const fullQuery = constructFullQuery({
    entities,
    context,
    permissions,
    userRevokePolicy,
    includeSetupAndTeardown,
    includeTransaction,
  });

  return { type: "success", query: fullQuery };
}
