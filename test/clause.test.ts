import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Clause, optimizeClause, valueToClause } from '../src/clause.js';
import { Expression } from 'oso/dist/src/Expression.js';
import { Variable } from 'oso';

describe(valueToClause.name, async () => {

  interface TestCase {
    id: string;
    input: unknown;
    output: Clause;
  }

  const testCases: TestCase[] = [
    {
      id: 'expression-1',
      input: new Expression(
        'Gt',
        [new Variable('a'), 2]
      ),
      output: {
        type: 'expression',
        operator: 'Gt',
        values: [
          { type: 'column', value: 'a' },
          { type: 'value', value: 2 }
        ]
      }
    },
    {
      id: 'column-1',
      input: new Variable('blah'),
      output: {
        type: 'column',
        value: 'blah'
      }
    },
    {
      id: 'value-boolean-1',
      input: false,
      output: {
        type: 'value',
        value: false
      }
    },
    {
      id: 'and-1',
      input: new Expression('And', [
        new Expression('Neq', [1, 2]),
        true,
        false
      ]),
      output: {
        type: 'and',
        clauses: [
          {
            type: 'expression',
            operator: 'Neq',
            values: [
              { type: 'value', value: 1 },
              { type: 'value', value: 2 }
            ]
          },
          {
            type: 'value',
            value: true
          },
          {
            type: 'value',
            value: false
          }
        ]
      }
    },
    {
      id: 'or-1',
      input: new Expression('Or', [
        new Expression('Neq', [1, 2]),
        true,
        false
      ]),
      output: {
        type: 'or',
        clauses: [
          {
            type: 'expression',
            operator: 'Neq',
            values: [
              { type: 'value', value: 1 },
              { type: 'value', value: 2 }
            ]
          },
          {
            type: 'value',
            value: true
          },
          {
            type: 'value',
            value: false
          }
        ]
      }
    },
    {
      id: 'not-1',
      input: new Expression('Not', [
        new Expression('Neq', [1, 2]),
      ]),
      output: {
        type: 'not',
        clause: {
          type: 'expression',
          operator: 'Neq',
          values: [
            { type: 'value', value: 1 },
            { type: 'value', value: 2 }
          ]
        }
      }
    }
  ];

  for (const testCase of testCases) {
    await it(testCase.id, () => {
      const result = valueToClause(testCase.input);
      assert.deepEqual(result, testCase.output);
    });
  }

});

describe(optimizeClause.name, async () => {

  interface TestCase {
    id: string;
    input: Clause;
    output: Clause;
  }

  const testCases: TestCase[] = [
    {
      id: 'single-and-1',
      input: { type: 'and', clauses: [{ type: 'value', value: true }] },
      output: { type: 'value', value: true }
    },
    {
      id: 'single-or-1',
      input: { type: 'or', clauses: [{ type: 'value', value: true }] },
      output: { type: 'value', value: true }
    },
    {
      id: 'not-and-with-dupe-1',
      input: {
        type: 'not',
        clause: {
          type: 'and',
          clauses: [
            { type: 'column', value: 'blah' },
            { type: 'column', value: 'blah' },
            { type: 'value', value: true }
          ]
        }
      },
      output: {
        type: 'or',
        clauses: [
          { type: 'not', clause: { type: 'column', value: 'blah' } },
          { type: 'not', clause: { type: 'value', value: true } }
        ]
      }
    }
  ];

  for (const testCase of testCases) {
    await it(testCase.id, () => {
      const result = optimizeClause(testCase.input);
      assert.deepEqual(result, testCase.output);
    });
  }

});
