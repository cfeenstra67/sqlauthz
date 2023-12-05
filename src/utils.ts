import { Variable } from "oso";
import { Expression } from 'oso/dist/src/Expression.js';
import { Pattern } from 'oso/dist/src/Pattern.js';

export function printExpression(obj: unknown): string {
  const prefix = '  ';
  if (obj instanceof Expression) {
    const lines: string[] = [obj.operator + ':'];
    for (const arg of obj.args) {
      const output = printExpression(arg).split('\n');
      const withPrefix = output.map((line) => prefix + line);
      lines.push(...withPrefix);
    }
    return lines.join('\n');
  }
  if (obj instanceof Pattern) {
    const fields = JSON.stringify(obj.fields);
    return `pattern(${obj.tag}, ${fields})`;
  }
  if (obj instanceof Variable) {
    return `var(${obj.name})`;
  }
  return (obj as any).toString();
}

export function printQuery(query: Map<string, unknown>): string {
  const lines: string[] = [];
  const prefix = '  ';
  for (const [key, value] of query.entries()) {
    lines.push(key + ':');
    const exprLines = printExpression(value).split('\n');
    const withPrefix = exprLines.map((line) => prefix + line);
    lines.push(...withPrefix);
  }
  return lines.join('\n');
}

type ArrayProductItem<A extends readonly (readonly any[])[]> =
  A extends readonly []
  ? readonly []
  : A extends readonly [infer T extends readonly any[]]
  ? readonly [T[number]]
  : A extends readonly [infer T extends readonly any[], ...infer R extends readonly (readonly any[])[]]
  ? readonly [T[number], ...ArrayProductItem<R>]
  : A extends readonly (infer T)[]
  ? T
  : never;

export type ArrayProduct<A extends readonly (readonly any[])[]> = ArrayProductItem<A>[];

export function arrayProduct<A extends readonly [any, ...any[]]>(inputs: A): ArrayProduct<A>;
export function arrayProduct<A extends readonly (readonly any[])[]>(inputs: A): ArrayProduct<A>;
export function arrayProduct<A extends readonly (readonly any[])[]>(inputs: A): ArrayProduct<A> {
  const cumulativeProducts: number[] = [];
  let totalCombinations = 1;
  for (const clauses of inputs) {
    cumulativeProducts.push(totalCombinations);
    totalCombinations *= clauses.length;
  }

  const out: any[] = [];
  for (let i = 0; i < totalCombinations; i++) {
    const outItems = inputs.map((values, idx) => {
      const cumulativeProduct = cumulativeProducts[idx]!;
      const cycle = values.length * cumulativeProduct;
      const remainder = i % cycle;
      const outIdx = Math.floor(remainder / cumulativeProduct);
      return values[outIdx]!;
    });
    out.push(outItems);
  }

  return out as ArrayProduct<A>;
}
