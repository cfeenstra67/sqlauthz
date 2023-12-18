import { AsyncLocalStorage } from "node:async_hooks";
import { Oso, Variable } from "oso";
import { Predicate } from "oso/dist/src/Predicate.js";
import { Value, valueToClause } from "./clause.js";
import { SQLFunction } from "./sql.js";

export interface LiteralsContext {
  use: <T>(func: () => Promise<T>) => Promise<T>;
  get: () => Map<string, Value>;
}

export function registerFunctions(
  oso: Oso,
  functions: SQLFunction[],
): LiteralsContext {
  const storage = new AsyncLocalStorage<Map<string, Value>>();
  let varIndex = 1;

  const get = () => {
    const map = storage.getStore();
    if (!map) {
      throw new Error("Not in SQL literal context");
    }
    return map;
  };

  const osoFunctionCaller = (name: string, schema: string) => {
    const fullName = `${schema}.${name}`;
    // biome-ignore lint/complexity/useArrowFunction: Need the `name` attribute
    const result = function (...args: unknown[]) {
      return new Predicate(fullName, args);
    };
    Object.defineProperty(result, "name", { value: fullName, writable: false });
    return result;
  };

  const schemaFunctions: Record<
    string,
    Record<string, (...args: unknown[]) => Predicate>
  > = {};
  const topLevelFunctions: Record<
    string,
    (...args: unknown[]) => Predicate | Variable
  > = {};

  for (const sqlFunc of functions) {
    const osoFunc = osoFunctionCaller(sqlFunc.name, sqlFunc.schema);
    if (sqlFunc.builtin) {
      topLevelFunctions[sqlFunc.name] = osoFunc;
    }
    schemaFunctions[sqlFunc.schema] ??= {};
    schemaFunctions[sqlFunc.schema]![sqlFunc.name] = osoFunc;
  }

  Object.assign(topLevelFunctions, schemaFunctions);

  topLevelFunctions.lit = function lit(arg) {
    const varName = `lit_${varIndex}`;
    varIndex++;
    const map = get();
    map.set(varName, valueToClause(arg) as Value);
    return new Variable(varName);
  };

  oso.registerConstant(topLevelFunctions, "sql");

  return {
    use: (func) => storage.run(new Map(), func),
    get,
  };
}

export interface CreateOsoArgs {
  paths: string[];
  functions: SQLFunction[];
  vars?: Record<string, unknown>;
}

export interface CreateOsoResult {
  oso: Oso;
  literalsContext: LiteralsContext;
}

export async function createOso({
  paths,
  functions,
  vars,
}: CreateOsoArgs): Promise<CreateOsoResult> {
  const oso = new Oso();

  const literalsContext = registerFunctions(oso, functions);

  for (const [key, value] of Object.entries(vars ?? {})) {
    oso.registerConstant(value, key);
  }

  await oso.loadFiles(paths);

  return { oso, literalsContext };
}
