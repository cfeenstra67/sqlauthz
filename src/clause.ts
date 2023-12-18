import { Variable } from "oso";
import { Expression } from "oso/dist/src/Expression.js";
import { Pattern } from "oso/dist/src/Pattern.js";
import { Predicate } from "oso/dist/src/Predicate.js";
import { PolarOperator } from "oso/dist/src/types.js";
import { arrayProduct } from "./utils.js";

export interface Literal {
  readonly type: "value";
  readonly value: unknown;
}

export interface FunctionCall {
  readonly type: "function-call";
  readonly schema: string;
  readonly name: string;
  readonly args: Value[];
}

export interface Column {
  readonly type: "column";
  readonly value: string;
}

export type Value = Literal | Column | FunctionCall;

export interface ExpressionClause {
  readonly type: "expression";
  readonly operator: PolarOperator;
  readonly values: readonly [Value, Value];
}

export interface NotClause {
  readonly type: "not";
  readonly clause: Clause;
}

export interface AndClause {
  readonly type: "and";
  readonly clauses: readonly Clause[];
}

export interface OrClause {
  readonly type: "or";
  readonly clauses: readonly Clause[];
}

export type Clause =
  | ExpressionClause
  | NotClause
  | AndClause
  | OrClause
  | Value;

export const TrueClause = {
  type: "and",
  clauses: [],
} as const satisfies AndClause;

export const FalseClause = {
  type: "or",
  clauses: [],
} as const satisfies OrClause;

export function isTrueClause(
  clause: Clause,
): clause is AndClause & { clauses: [] } {
  return clause.type === "and" && clause.clauses.length === 0;
}

export function isFalseClause(
  clause: Clause,
): clause is OrClause & { clauses: [] } {
  return clause.type === "or" && clause.clauses.length === 0;
}

export function mapClauses(
  clause: Clause,
  func: (clause: Clause) => Clause,
): Clause {
  if (clause.type === "and" || clause.type === "or") {
    const subClauses = clause.clauses.map((subClause) =>
      mapClauses(subClause, func),
    );
    return func({
      type: clause.type,
      clauses: subClauses,
    });
  }
  if (clause.type === "not") {
    const subClause = mapClauses(clause.clause, func);
    return func({
      type: "not",
      clause: subClause,
    });
  }
  if (clause.type === "expression") {
    const newValues = clause.values.map((value) => mapClauses(value, func)) as [
      Value,
      Value,
    ];
    return func({
      type: "expression",
      operator: clause.operator,
      values: newValues,
    });
  }
  if (clause.type === "function-call") {
    const values = clause.args.map((arg) => mapClauses(arg, func)) as Value[];
    return func({
      type: "function-call",
      schema: clause.schema,
      name: clause.name,
      args: values,
    });
  }
  return func(clause);
}

function clausesEqual(clause1: Clause, clause2: Clause): boolean {
  if (clause1.type !== clause2.type) {
    return false;
  }
  if (
    (clause1.type === "and" && clause2.type === "and") ||
    (clause1.type === "or" && clause2.type === "or")
  ) {
    const deduped1 = deduplicateClauses(clause1.clauses);
    const deduped2 = deduplicateClauses(clause2.clauses);
    return (
      deduped1.length === deduped2.length &&
      deduped1.every((clause, idx) => clausesEqual(clause, deduped2[idx]!))
    );
  }
  if (clause1.type === "not" && clause2.type === "not") {
    return clausesEqual(clause1.clause, clause2.clause);
  }
  if (clause1.type === "expression" && clause2.type === "expression") {
    return (
      clause1.operator === clause2.operator &&
      clause1.values.every((value, idx) =>
        clausesEqual(value, clause2.values[idx]!),
      )
    );
  }
  if (
    (clause1.type === "value" && clause2.type === "value") ||
    (clause1.type === "column" && clause2.type === "column")
  ) {
    return clause1.value === clause2.value;
  }
  if (clause1.type === "function-call" && clause2.type === "function-call") {
    return (
      clause1.name === clause2.name &&
      clause1.schema === clause2.schema &&
      clause1.args.length === clause2.args.length &&
      clause1.args.every((arg, idx) => arg === clause2.args[idx])
    );
  }
  return false;
}

function deduplicateClauses(clauses: readonly Clause[]): readonly Clause[] {
  if (clauses.length <= 1) {
    return clauses;
  }
  if (clauses.length === 2) {
    if (clausesEqual(clauses[0]!, clauses[1]!)) {
      return [clauses[0]!];
    }
    return clauses;
  }
  const first = clauses[0]!;
  const rest = deduplicateClauses(clauses.slice(1));
  const out: Clause[] = [first];
  for (const clause of rest) {
    if (!clausesEqual(first, clause)) {
      out.push(clause);
    }
  }
  return out;
}

export function optimizeClause(clause: Clause): Clause {
  if (clause.type === "and") {
    const outClauses: Clause[] = [];
    for (const subClause of deduplicateClauses(clause.clauses)) {
      const optimized = optimizeClause(subClause);
      if (isTrueClause(optimized)) {
        continue;
      }
      if (isFalseClause(optimized)) {
        return FalseClause;
      }
      if (optimized.type === "and") {
        outClauses.push(...optimized.clauses);
        continue;
      }
      outClauses.push(optimized);
    }

    if (outClauses.length === 1) {
      return outClauses[0]!;
    }

    return {
      type: "and",
      clauses: outClauses,
    };
  }

  if (clause.type === "or") {
    const outClauses: Clause[] = [];
    for (const subClause of deduplicateClauses(clause.clauses)) {
      const optimized = optimizeClause(subClause);
      if (isTrueClause(optimized)) {
        return TrueClause;
      }
      if (isFalseClause(optimized)) {
        continue;
      }
      if (optimized.type === "or") {
        outClauses.push(...optimized.clauses);
        continue;
      }
      outClauses.push(optimized);
    }

    if (outClauses.length === 1) {
      return outClauses[0]!;
    }

    return { type: "or", clauses: outClauses };
  }

  if (clause.type === "not") {
    const optimized = optimizeClause(clause.clause);
    if (optimized.type === "and") {
      const orClause: OrClause = {
        type: "or",
        clauses: optimized.clauses.map((subClause) => {
          return { type: "not", clause: subClause };
        }),
      };
      return optimizeClause(orClause);
    }
    if (optimized.type === "or") {
      const andClause: AndClause = {
        type: "and",
        clauses: optimized.clauses.map((subClause) => ({
          type: "not",
          clause: subClause,
        })),
      };
      return optimizeClause(andClause);
    }
    return { type: "not", clause: optimized };
  }

  return clause;
}

export function valueToClause(value: unknown): Clause {
  if (value instanceof Expression) {
    if (value.operator === "And") {
      const outClauses = value.args.map((arg) => valueToClause(arg));

      return { type: "and", clauses: outClauses };
    }
    if (value.operator === "Or") {
      const outClauses = value.args.map((arg) => valueToClause(arg));

      return { type: "or", clauses: outClauses };
    }
    if (value.operator === "Dot") {
      if (typeof value.args[0] === "string") {
        const col: Column = {
          type: "column",
          value: ["_this", value.args[1]].join("."),
        };

        return {
          type: "and",
          clauses: [
            col,
            {
              type: "expression",
              operator: "Eq",
              values: [
                { type: "column", value: "_this" },
                { type: "value", value: value.args[0] },
              ],
            },
          ],
        };
      }

      const args = value.args.map((arg) => valueToClause(arg));
      const src = args[0] as Value | AndClause;
      const name = args[1] as Value;

      // TODO: is this the right behavior?
      if (src.type === "function-call" || name.type === "function-call") {
        throw new Error("Unexpected function call");
      }

      if (src.type === "and") {
        const col = src.clauses[0] as Column;
        const newCol: Column = {
          type: "column",
          value: [col.value, name.value].join("."),
        };

        return {
          type: "and",
          clauses: [newCol, ...src.clauses.slice(1)],
        };
      }

      return {
        type: "column",
        value: [src.value, name.value].join("."),
      };
    }
    if (value.operator === "Not") {
      const subClause = valueToClause(value.args[0]);

      return {
        type: "not",
        clause: subClause,
      };
      // Ignore these operators
    }
    if (
      value.operator === "Cut" ||
      value.operator === "Assign" ||
      value.operator === "ForAll" ||
      value.operator === "Isa" ||
      value.operator === "Print"
    ) {
      return TrueClause;
    }
    const clauses: Clause[] = [];
    const leftClause = valueToClause(value.args[0]) as Value | AndClause;
    let left: Value;
    if (leftClause.type === "and") {
      left = leftClause.clauses[0] as Value;
      clauses.push(...leftClause.clauses.slice(1));
    } else {
      left = leftClause;
    }

    const rightClause = valueToClause(value.args[1]) as Value | AndClause;
    let right: Value;
    if (rightClause.type === "and") {
      right = rightClause.clauses[0] as Value;
      clauses.push(...rightClause.clauses.slice(1));
    } else {
      right = rightClause;
    }

    const operator = value.operator === "Unify" ? "Eq" : value.operator;

    const newClause: ExpressionClause = {
      type: "expression",
      operator,
      values: [left, right],
    };

    if (clauses.length > 0) {
      return { type: "and", clauses: [newClause, ...clauses] };
    }
    return newClause;
  }
  if (value instanceof Variable) {
    return {
      type: "column",
      value: value.name,
    };
  }
  if (value instanceof Pattern) {
    // TODO
    return TrueClause;
  }
  if (value instanceof Predicate) {
    const [schema, name] = value.name.split(".");
    const clauses: Clause[] = [];
    const args: Value[] = [];
    for (const arg of value.args) {
      const subClause = valueToClause(arg) as Value | AndClause;
      if (subClause.type === "and") {
        args.push(subClause.clauses[0] as Value);
        clauses.push(...subClause.clauses.slice(1));
      } else {
        args.push(subClause);
      }
    }

    const newClause: FunctionCall = {
      type: "function-call",
      schema: schema!,
      name: name!,
      args,
    };

    if (clauses.length > 0) {
      return { type: "and", clauses: [newClause, ...clauses] };
    }
    return newClause;
  }

  return { type: "value", value };
}

export function factorOrClauses(clause: Clause): Clause[] {
  const inner = (clause: Clause): Clause[] => {
    if (clause.type === "and") {
      const subOrs = clause.clauses.map((subClause) =>
        factorOrClauses(subClause),
      );

      return Array.from(arrayProduct(subOrs)).map((subClauses) => ({
        type: "and",
        clauses: subClauses,
      }));
    }

    if (clause.type === "or") {
      return clause.clauses.flatMap((subClause) => factorOrClauses(subClause));
    }

    if (clause.type === "not") {
      const subClauses = factorOrClauses(clause.clause);
      if (subClauses.length > 1) {
        const negativeAndClause: AndClause = {
          type: "and",
          clauses: subClauses.map((subClause) => ({
            type: "not",
            clause: subClause,
          })),
        };
        return factorOrClauses(negativeAndClause);
      }
      return [{ type: "not", clause: subClauses[0]! }];
    }

    return [clause];
  };

  return inner(optimizeClause(clause)).map((subClause) =>
    optimizeClause(subClause),
  );
}

export interface EvaluateClauseArgs {
  clause: Clause;
  evaluate: (
    expr: Exclude<Clause, AndClause | OrClause | NotClause>,
  ) => EvaluateClauseResult;
  strictFields?: boolean;
}

export interface EvaluateClauseSuccess {
  type: "success";
  result: boolean;
}

export interface EvaluateClauseError {
  type: "error";
  errors: string[];
}

export type EvaluateClauseResult = EvaluateClauseSuccess | EvaluateClauseError;

export function evaluateClause({
  clause,
  evaluate,
  strictFields,
}: EvaluateClauseArgs): EvaluateClauseResult {
  if (clause.type === "and") {
    const errors: string[] = [];
    let result = true;
    for (const subClause of clause.clauses) {
      const clauseResult = evaluateClause({ clause: subClause, evaluate });
      if (clauseResult.type === "success") {
        result &&= clauseResult.result;
      } else {
        errors.push(...clauseResult.errors);
      }
    }
    if ((strictFields || result) && errors.length > 0) {
      return { type: "error", errors };
    }
    return { type: "success", result };
  }
  if (clause.type === "or") {
    const errors: string[] = [];
    let result = false;
    for (const subClause of clause.clauses) {
      const clauseResult = evaluateClause({ clause: subClause, evaluate });
      if (clauseResult.type === "success") {
        result ||= clauseResult.result;
      } else {
        errors.push(...clauseResult.errors);
      }
    }
    if (errors.length > 0) {
      return { type: "error", errors };
    }
    return { type: "success", result };
  }
  if (clause.type === "not") {
    const clauseResult = evaluateClause({ clause: clause.clause, evaluate });
    if (clauseResult.type === "success") {
      return { type: "success", result: !clauseResult.result };
    }
    return { type: "error", errors: clauseResult.errors };
  }

  return evaluate(clause);
}

export interface SimpleEvaluatorArgs {
  variableName: string;
  errorVariableName: string;
  // biome-ignore lint/suspicious/noExplicitAny: needed here
  getValue: (value: Value) => any;
}

export function simpleEvaluator({
  variableName,
  errorVariableName,
  getValue,
}: SimpleEvaluatorArgs): EvaluateClauseArgs["evaluate"] {
  const func: EvaluateClauseArgs["evaluate"] = (expr) => {
    if (expr.type === "column" && expr.value === variableName) {
      return { type: "success", result: true };
    }
    if (expr.type === "column") {
      return {
        type: "error",
        errors: [`${errorVariableName}: invalid reference: ${expr.value}`],
      };
    }
    if (expr.type === "value") {
      return func({
        type: "expression",
        operator: "Eq",
        values: [{ type: "column", value: "_this" }, expr],
      });
    }
    if (expr.type === "function-call") {
      // TODO: is this the right behavior?
      return {
        type: "error",
        errors: [`${errorVariableName}: unexpected function call`],
      };
    }
    let operatorFunc: (a: unknown, b: unknown) => boolean;
    if (expr.operator === "Eq") {
      operatorFunc = (a, b) => a === b;
    } else if (expr.operator === "Neq") {
      operatorFunc = (a, b) => a !== b;
    } else if (expr.operator === "Geq") {
      operatorFunc = (a, b) => (a as string | number) >= (b as string | number);
    } else if (expr.operator === "Gt") {
      operatorFunc = (a, b) => (a as string | number) > (b as string | number);
    } else if (expr.operator === "Lt") {
      operatorFunc = (a, b) => (a as string | number) < (b as string | number);
    } else if (expr.operator === "Leq") {
      operatorFunc = (a, b) => (a as string | number) <= (b as string | number);
    } else {
      return {
        type: "error",
        errors: [
          `${errorVariableName}: unsupported operator: ${expr.operator}`,
        ],
      };
    }
    if (expr.values[0].type === "value" && expr.values[1].type === "value") {
      return {
        type: "success",
        result: operatorFunc(expr.values[0].value, expr.values[1].value),
      };
    }
    const errors: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: needed here
    let left: any;
    // biome-ignore lint/suspicious/noExplicitAny: needed here
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
      return { type: "error", errors };
    }

    return { type: "success", result: operatorFunc(left, right) };
  };

  return func;
}

export class ValidationError extends Error {
  constructor(readonly message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
