import assert from "node:assert";
import { describe, it } from "node:test";
import { valueToSqlLiteral } from "../src/utils.js";

describe("sql-literal", async () => {
  interface TestCase {
    id: string;
    value: unknown;
    error?: boolean;
    output: string;
  }

  const cases: TestCase[] = [
    {
      id: "number-1",
      value: 12,
      output: "12",
    },
    {
      id: "number-2",
      value: 12.32,
      output: "12.32",
    },
    {
      id: "boolean-1",
      value: true,
      output: "true",
    },
    {
      id: "boolean-2",
      value: false,
      output: "false",
    },
    {
      id: "null-1",
      value: null,
      output: "null",
    },
    {
      id: "null-2",
      value: undefined,
      output: "null",
    },
    {
      id: "object-1",
      value: {},
      error: true,
      output: "",
    },
    {
      id: "date-1",
      value: new Date(Date.UTC(2023, 12, 3, 12, 4, 3)),
      output: "'2024-01-03T12:04:03.000Z'",
    },
    {
      id: "string-1",
      value: "abc",
      output: "'abc'",
    },
    {
      id: "string-2",
      value: "def'ghi",
      output: "'def''ghi'",
    },
  ];

  for (const caseVal of cases) {
    await it(`${caseVal.id}: formats correctly`, async () => {
      if (caseVal.error) {
        assert.throws(() => valueToSqlLiteral(caseVal.value));
      } else {
        const output = valueToSqlLiteral(caseVal.value);
        assert.equal(output, caseVal.output);
      }
    });
  }
});
