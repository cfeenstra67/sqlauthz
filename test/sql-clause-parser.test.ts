import assert from "node:assert";
import { it } from "node:test";
import {
  type Clause,
  clausesEqual,
  normalizeClauseForComparison,
} from "../src/clause.js";
import { parseSqlClause } from "../src/sql-clause-parser.js";

it("parses PostgreSQL-normalized policy expressions", () => {
  const desired: Clause = {
    type: "expression",
    operator: "Eq",
    values: [
      { type: "column", value: "id" },
      {
        type: "function-call",
        schema: "",
        name: "cast",
        args: [
          {
            type: "function-call",
            schema: "pg_catalog",
            name: "current_setting",
            args: [{ type: "value", value: "user.id" }],
          },
          { type: "value", value: "bigint" },
        ],
      },
    ],
  };

  const parsed = parseSqlClause(
    "(id = (current_setting('user.id'::text))::bigint)",
  );

  assert.ok(parsed);
  assert.equal(
    clausesEqual(normalizeClauseForComparison(desired), parsed),
    true,
  );
});

it("compares PostgreSQL text predicates", () => {
  const desired: Clause = {
    type: "expression",
    operator: "Eq",
    values: [
      { type: "column", value: "author" },
      { type: "value", value: "Author A" },
    ],
  };
  const parsed = parseSqlClause("(author = 'Author A'::text)");

  assert.ok(parsed);
  assert.equal(clausesEqual(desired, parsed), true);
});

it("ignores PostgreSQL's implicit varchar-to-text cast", () => {
  const desired: Clause = {
    type: "expression",
    operator: "Eq",
    values: [
      { type: "column", value: "org_id" },
      {
        type: "function-call",
        schema: "pg_catalog",
        name: "current_setting",
        args: [{ type: "value", value: "user.org_id" }],
      },
    ],
  };
  const parsed = parseSqlClause(
    "((org_id)::text = current_setting('user.org_id'::text))",
  );

  assert.ok(parsed);
  assert.equal(
    clausesEqual(normalizeClauseForComparison(desired), parsed),
    true,
  );
});
