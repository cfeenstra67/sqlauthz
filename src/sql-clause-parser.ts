import type { PolarOperator } from "oso/dist/src/types.js";
import {
  type Clause,
  type Value,
  mapClauses,
  optimizeClause,
} from "./clause.js";

export function normalizeClauseForComparison(clause: Clause): Clause {
  return optimizeClause(
    mapClauses(clause, (part) => {
      if (part.type !== "function-call") {
        return part;
      }
      if (
        part.name === "cast" &&
        part.args[0]?.type === "column" &&
        part.args[1]?.type === "value" &&
        part.args[1].value === "text"
      ) {
        // PostgreSQL compares varchar columns through text operators in pg_policies.
        return part.args[0];
      }
      return {
        ...part,
        schema: part.schema === "pg_catalog" ? "" : part.schema,
      };
    }),
  );
}

type SqlToken =
  | { type: "identifier" | "string" | "number" | "operator"; value: string }
  | { type: "punctuation"; value: "(" | ")" | "," | "::" };

const SqlOperators: Record<string, PolarOperator> = {
  "=": "Eq",
  "!=": "Neq",
  "<>": "Neq",
  ">": "Gt",
  "<": "Lt",
  ">=": "Geq",
  "<=": "Leq",
};

function tokenizeSqlExpression(expression: string): SqlToken[] | null {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    if (rest.startsWith("::")) {
      tokens.push({ type: "punctuation", value: "::" });
      index += 2;
      continue;
    }
    const operator = /^(>=|<=|<>|!=|=|>|<)/.exec(rest);
    if (operator) {
      tokens.push({ type: "operator", value: operator[0] });
      index += operator[0].length;
      continue;
    }
    const punctuation = /^[(),]/.exec(rest);
    if (punctuation) {
      tokens.push({
        type: "punctuation",
        value: punctuation[0] as "(" | ")" | ",",
      });
      index++;
      continue;
    }
    if (rest[0] === "'") {
      let value = "";
      index++;
      while (index < expression.length) {
        if (expression[index] !== "'") {
          value += expression[index++];
          continue;
        }
        if (expression[index + 1] === "'") {
          value += "'";
          index += 2;
          continue;
        }
        index++;
        tokens.push({ type: "string", value });
        break;
      }
      if (tokens.at(-1)?.type !== "string") {
        return null;
      }
      continue;
    }
    if (rest[0] === '"') {
      let value = "";
      index++;
      while (index < expression.length) {
        if (expression[index] !== '"') {
          value += expression[index++];
          continue;
        }
        if (expression[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        index++;
        tokens.push({ type: "identifier", value });
        break;
      }
      if (tokens.at(-1)?.type !== "identifier") {
        return null;
      }
      continue;
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ type: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_$.]*/.exec(rest);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    return null;
  }
  return tokens;
}

export function parseSqlClause(expression: string): Clause | null {
  const tokens = tokenizeSqlExpression(expression);
  if (!tokens) {
    return null;
  }
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const isKeyword = (keyword: string) =>
    peek()?.type === "identifier" &&
    peek()!.value.toUpperCase() === keyword;

  const parseValue = (): Value | null => {
    const token = take();
    if (!token) {
      return null;
    }
    if (token.type === "punctuation" && token.value === "(") {
      const clause = parseOr();
      if (take()?.value !== ")") {
        return null;
      }
      if (
        clause.type !== "value" &&
        clause.type !== "column" &&
        clause.type !== "function-call"
      ) {
        return null;
      }
      return clause;
    }
    if (token.type === "string") {
      return { type: "value", value: token.value };
    }
    if (token.type === "number") {
      return { type: "value", value: Number(token.value) };
    }
    if (token.type !== "identifier") {
      return null;
    }
    const upper = token.value.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") {
      return { type: "value", value: upper === "TRUE" };
    }
    if (upper === "NULL") {
      return { type: "value", value: null };
    }
    if (peek()?.value !== "(") {
      return { type: "column", value: token.value.split(".").at(-1)! };
    }
    take();
    const args: Value[] = [];
    while (peek()?.value !== ")") {
      const arg = parseValueWithCast();
      if (!arg) {
        return null;
      }
      args.push(arg);
      if (peek()?.value === ",") {
        take();
      } else if (peek()?.value !== ")") {
        return null;
      }
    }
    take();
    const parts = token.value.split(".");
    return {
      type: "function-call",
      schema: parts.length > 1 ? parts.slice(0, -1).join(".") : "",
      name: parts.at(-1)!,
      args,
    };
  };

  const parseValueWithCast = (): Value | null => {
    let value = parseValue();
    while (value && peek()?.value === "::") {
      take();
      const typeParts: string[] = [];
      while (peek()?.type === "identifier") {
        typeParts.push(take()!.value);
      }
      if (typeParts.length === 0) {
        return null;
      }
      const type = typeParts.join(" ");
      // PostgreSQL annotates unknown literals with their inferred type.
      if (value.type !== "value") {
        value = {
          type: "function-call",
          schema: "",
          name: "cast",
          args: [value, { type: "value", value: type }],
        };
      }
    }
    return value;
  };

  const parseComparison = (): Clause => {
    if (peek()?.value === "(") {
      const start = index;
      const value = parseValueWithCast();
      if (value && peek()?.type === "operator") {
        const operator = take()!;
        const right = parseValueWithCast();
        const polarOperator = SqlOperators[operator.value];
        if (!right || !polarOperator) {
          throw new Error("Invalid SQL comparison");
        }
        return {
          type: "expression",
          operator: polarOperator,
          values: [value, right],
        };
      }
      index = start;
      take();
      const clause = parseOr();
      if (take()?.value !== ")") {
        throw new Error("Invalid SQL expression");
      }
      return clause;
    }
    const left = parseValueWithCast();
    if (!left) {
      throw new Error("Invalid SQL value");
    }
    if (peek()?.type !== "operator") {
      return left;
    }
    const operator = take()!;
    const right = parseValueWithCast();
    if (!right || operator.type !== "operator") {
      throw new Error("Invalid SQL comparison");
    }
    const polarOperator = SqlOperators[operator.value];
    if (!polarOperator) {
      throw new Error("Unsupported SQL operator");
    }
    return {
      type: "expression",
      operator: polarOperator,
      values: [left, right],
    };
  };

  const parseNot = (): Clause => {
    if (isKeyword("NOT")) {
      take();
      return { type: "not", clause: parseNot() };
    }
    return parseComparison();
  };
  const parseAnd = (): Clause => {
    const clauses = [parseNot()];
    while (isKeyword("AND")) {
      take();
      clauses.push(parseNot());
    }
    return clauses.length === 1 ? clauses[0]! : { type: "and", clauses };
  };
  const parseOr = (): Clause => {
    const clauses = [parseAnd()];
    while (isKeyword("OR")) {
      take();
      clauses.push(parseAnd());
    }
    return clauses.length === 1 ? clauses[0]! : { type: "or", clauses };
  };

  try {
    const clause = parseOr();
    return index === tokens.length
      ? normalizeClauseForComparison(clause)
      : null;
  } catch {
    return null;
  }
}
