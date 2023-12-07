import { Variable } from "oso";
import { Expression } from "oso/dist/src/Expression.js";
import { Pattern } from "oso/dist/src/Pattern.js";
import { arrayProduct } from "./utils.js";

export interface Literal {
  readonly type: 'value';
  readonly value: unknown;
}

export interface Column {
  readonly type: 'column';
  readonly value: string;
}

export type Value = Literal | Column;

export interface ExpressionClause {
  readonly type: 'expression';
  readonly operator: Expression['operator'];
  readonly values: readonly [Value, Value];
}

export interface NotClause {
  readonly type: 'not';
  readonly clause: Clause;
}

export interface AndClause {
  readonly type: 'and';
  readonly clauses: readonly Clause[];
}

export interface OrClause {
  readonly type: 'or';
  readonly clauses: readonly Clause[];
}

export type Clause = ExpressionClause | NotClause | AndClause | OrClause | Value;

export const TrueClause = { type: 'and', clauses: [] } as const satisfies AndClause;

export const FalseClause = { type: 'or', clauses: [] } as const satisfies OrClause;

function isTrueClause(clause: Clause): clause is AndClause & { clauses: [] } {
  return clause.type === 'and' && clause.clauses.length === 0;
}

function isFalseClause(clause: Clause): clause is OrClause & { clauses: [] } {
  return clause.type === 'or' && clause.clauses.length === 0;
}

export function mapClauses(
  clause: Clause,
  func: (clause: Clause) => Clause
): Clause {
  if (clause.type === 'and' || clause.type === 'or') {
    const subClauses = clause.clauses.map((subClause) =>
      mapClauses(subClause, func)
    );
    return func({
      type: clause.type,
      clauses: subClauses
    });
  }
  if (clause.type === 'not') {
    const subClause = mapClauses(clause.clause, func);
    return func({
      type: 'not',
      clause: subClause
    });
  }
  return func(clause);
}

export function *iterateClauses(clause: Clause): Generator<Clause> {
  if (clause.type === 'and' || clause.type === 'or') {
    for (const subClause of clause.clauses) {
      for (const subSubClause of iterateClauses(subClause)) {
        yield subSubClause;
      }
    }
  } else if (clause.type === 'not') {
    for (const subSubClause of iterateClauses(clause.clause)) {
      yield subSubClause;
    }
  }
  yield clause;
}

export function optimizeClause(clause: Clause): Clause {
  if (clause.type === 'and') {
    const outClauses: Clause[] = [];
    for (const subClause of clause.clauses) {
      const optimized = optimizeClause(subClause);
      if (isTrueClause(optimized)) {
        continue;
      }
      if (isFalseClause(optimized)) {
        return FalseClause;
      }
      if (optimized.type === 'and') {
        outClauses.push(...optimized.clauses);
        continue;
      }
      outClauses.push(optimized);
    }

    if (outClauses.length === 1) {
      return outClauses[0]!;
    }

    return {
      type: 'and',
      clauses: outClauses
    };
  }

  if (clause.type === 'or') {
    const outClauses: Clause[] = [];
    for (const subClause of clause.clauses) {
      const optimized = optimizeClause(subClause);
      if (isTrueClause(optimized)) {
        return TrueClause;
      }
      if (isFalseClause(optimized)) {
        continue;
      }
      if (optimized.type === 'or') {
        outClauses.push(...optimized.clauses);
        continue;
      }
      outClauses.push(optimized);
    }

    if (outClauses.length === 1) {
      return outClauses[0]!;
    }

    return { type: 'or', clauses: outClauses };
  }

  if (clause.type === 'not') {
    const optimized = optimizeClause(clause.clause);
    if (optimized.type === 'and') {
      const orClause: OrClause = {
        type: 'or',
        clauses: optimized.clauses.map((subClause) => {
          return { type: 'not', clause: subClause };
        })
      };
      return optimizeClause(orClause);
    }
    if (optimized.type === 'or') {
      const andClause: AndClause = {
        type: 'and',
        clauses: optimized.clauses.map((subClause) => ({
          type: 'not',
          clause: subClause
        }))
      };
      return optimizeClause(andClause);
    }
    return { type: 'not', clause: optimized };
  }

  return clause;
}

export function valueToClause(value: unknown): Clause {
  if (value instanceof Expression) {
    if (value.operator === 'And') {
      const outClauses = value.args.map((arg) =>
        valueToClause(arg)
      );

      return { type: 'and', clauses: outClauses };
    } else if (value.operator === 'Or') {
      const outClauses = value.args.map((arg) =>
        valueToClause(arg)
      );

      return { type: 'or', clauses: outClauses };
    } else if (value.operator === 'Dot') {
      const args = value.args.map((arg) => valueToClause(arg));
      const src = args[0] as Column;
      const name = args[1] as Literal;

      return {
        type: 'column',
        value: [src.value, name.value].join('.')
      };
    } else if (value.operator === 'Not') {
      const subClause = valueToClause(value.args[0]);

      return {
        type: 'not',
        clause: subClause
      };
    // Ignore these operators
    } else if (
      value.operator === 'Cut' ||
      value.operator === 'Assign' ||
      value.operator === 'ForAll' ||
      value.operator === 'Isa' ||
      value.operator === 'Print' ||
      value.operator === 'Unify'
    ) {
      return TrueClause;
    } else {
      const left = valueToClause(value.args[0]) as Value;
      const right = valueToClause(value.args[1]) as Value;

      // TODO: should ignore some operators
      return {
        type: 'expression',
        operator: value.operator,
        values: [left, right]
      };
    }
  } else if (value instanceof Variable) {
    return {
      type: 'column',
      value: value.name
    };
  } else if (value instanceof Pattern) {
    // TODO
    return TrueClause;
  }

  return { type: 'value', value };
}

export function factorOrClauses(clause: Clause): Clause[] {
  const inner = (clause: Clause): Clause[] => {
    if (clause.type === 'and') {
      const subOrs = clause.clauses.map((subClause) =>
        factorOrClauses(subClause)
      );

      return Array.from(arrayProduct(subOrs)).map((subClauses) => ({
        type: 'and',
        clauses: subClauses
      }));
    }
  
    if (clause.type === 'or') {
      return clause.clauses.flatMap((subClause) =>
        factorOrClauses(subClause)
      );
    }
  
    if (clause.type === 'not') {
      const subClauses = factorOrClauses(clause.clause);
      if (subClauses.length > 1) {
        const negativeAndClause: AndClause = {
          type: 'and',
          clauses: subClauses.map((subClause) => (
            { type: 'not', clause: subClause }
          ))
        };
        return factorOrClauses(negativeAndClause);
      }
      return [{ type: 'not', clause: subClauses[0]! }];
    }
  
    return [clause];
  };

  return inner(optimizeClause(clause)).map((subClause) =>
    optimizeClause(subClause)
  );
}

export interface EvaluateClauseArgs {
  clause: Clause;
  evaluate: (expr: Exclude<Clause, AndClause | OrClause | NotClause>) => EvaluateClauseResult;
}

export interface EvaluateClauseSuccess {
  type: 'success';
  result: boolean;
}

export interface EvaluateClauseError {
  type: 'error';
  errors: string[];
}

export type EvaluateClauseResult = EvaluateClauseSuccess | EvaluateClauseError;

export function evaluateClause({
  clause,
  evaluate,
}: EvaluateClauseArgs): EvaluateClauseResult {
  if (clause.type === 'and') {
    const errors: string[] = [];
    let result = true;
    for (const subClause of clause.clauses) {
      const clauseResult = evaluateClause({ clause: subClause, evaluate });
      if (clauseResult.type === 'success') {
        result &&= clauseResult.result;
      } else {
        errors.push(...clauseResult.errors);
      }
    }
    if (errors.length > 0) {
      return { type: 'error', errors };
    }
    return { type: 'success', result };
  }
  if (clause.type === 'or') {
    const errors: string[] = [];
    let result = false;
    for (const subClause of clause.clauses) {
      const clauseResult = evaluateClause({ clause: subClause, evaluate });
      if (clauseResult.type === 'success') {
        result ||= clauseResult.result;
      } else {
        errors.push(...clauseResult.errors);
      }
    }
    if (errors.length > 0) {
      return { type: 'error', errors };
    }
    return { type: 'success', result };
  }
  if (clause.type === 'not') {
    const clauseResult = evaluateClause({ clause: clause.clause, evaluate });
    if (clauseResult.type === 'success') {
      return { type: 'success', result: !clauseResult.result };
    }
    return { type: 'error', errors: clauseResult.errors };
  }

  return evaluate(clause);
}
