# Incremental privilege reconciliation handoff

## Goal

Add an optional incremental application mode to `sqlauthz` so reapplying an unchanged permission configuration does not execute a large revoke-and-grant cycle.

The motivation is PostgreSQL installations using `pgaudit`, particularly configurations that audit role/permission changes. The existing replacement strategy is fast and transactional, but every run emits many `REVOKE` and `GRANT` statements and can produce an excessive volume of audit logs.

The intended reconciliation property is:

> After a successful run, managed users' direct privileges match the desired configuration. Reapplying an unchanged configuration emits no permission-changing SQL.

Catalog reads and transaction-control statements are expected. The goal is to eliminate unnecessary mutating permission statements, not literally all SQL.

## Decisions made

### Reconciliation is optional

The existing revoke-all-and-regrant behavior remains the default. The new behavior is enabled with:

```text
--reconcile
```

It is also available through the normal yargs configuration mechanisms as `reconcile` and `SQLAUTHZ_RECONCILE`.

### First-pass scope is direct object privileges

Reconciliation covers direct privileges on:

- Schemas
- Tables
- Table columns
- Views and materialized views
- Functions
- Procedures
- Sequences

The comparison uses PostgreSQL ACL catalog entries rather than effective-access helpers such as `has_table_privilege`. Inherited access, `PUBLIC`, ownership, and superuser access are therefore not mistaken for direct grants managed by `sqlauthz`.

Column-level grants are structurally distinct from table-level grants. A table-wide `SELECT` is not considered equivalent to `SELECT` on every current column, because their behavior differs when columns are later added.

Grant options are also part of the normalized privilege identity. Because the desired model does not express grant options, an existing privilege with `WITH GRANT OPTION` is revoked with `CASCADE` and the ordinary privilege is restored.

### Existing role-membership behavior is retained

Managed users still have all existing role memberships revoked. Reconciliation reads `pg_auth_members` and emits `REVOKE role FROM member` only for memberships that currently exist. This makes an unchanged subsequent run quiet without changing the functional behavior.

### Existing RLS behavior is retained

The first pass intentionally does not implement a complete RLS policy-expression reconciler.

- Existing permissive-policy and RLS-enablement checks continue to avoid creating already-satisfied state where the prior implementation already did so.
- Restrictive RLS policies targeting managed users retain the existing drop-and-recreate behavior.

Therefore, a configuration using restrictive row-level policies may still emit policy-changing statements when reapplied. Making those runs completely quiet would require comparing policy structure and PostgreSQL-normalized `USING`/`WITH CHECK` expressions, which should be treated as a separate follow-up.

### Transaction model

The CLI starts a transaction before fetching PostgreSQL metadata when reconciliation is enabled, then compiles and applies the delta and commits it. This preserves the all-or-nothing visibility property even though diff calculation happens in application code over multiple client round trips.

This does not prevent another administrator or process from changing privileges concurrently. For the first pass, the chosen level of rigor is:

```text
BEGIN -> read current state -> calculate diff -> apply diff -> COMMIT
```

Migrations and permission-management processes should not run concurrently. A transaction-scoped advisory lock was discussed as a useful optional future safeguard, but it has not been implemented. A verification read before commit was also discussed and deferred until there is a demonstrated need.

## Implementation completed

### Public API and query construction

- `CompileQueryArgs` now accepts `reconcile?: boolean`.
- `constructFullQuery` selects the replacement or reconciliation path.
- Reconciliation skips the temporary schema and `revoke_all_from_role` helper used by replacement mode.
- Backend reconciliation support is optional at the interface level; requesting reconciliation from a backend that does not implement it produces an explicit error.
- `dry-run-short` omits setup, teardown, and transaction statements while retaining the permission plan. In reconciliation mode this includes delta `REVOKE` and `GRANT` statements as well as applicable RLS statements.

Files:

- `src/api.ts`
- `src/backend.ts`
- `src/sql.ts`

### PostgreSQL catalog state

`PostgresBackend.fetchEntities()` now reads:

- Relation ACLs from `pg_class.relacl`
- Column ACLs from `pg_attribute.attacl`
- Schema ACLs from `pg_namespace.nspacl`
- Function/procedure ACLs from `pg_proc.proacl`
- Role memberships from `pg_auth_members`

ACL arrays are expanded with `aclexplode`, and only named role grantees are included. `PUBLIC` grants are intentionally outside the managed direct-grant set.

### Delta generation

Desired permissions and catalog ACLs are normalized to records containing:

```text
actor
object type
schema
object name, where applicable
privilege
column, where applicable
grant-option status
```

The reconciler computes:

```text
current - desired => REVOKE
desired - current => GRANT
intersection      => no statement
```

Unexpected grant-option privileges use `REVOKE ... CASCADE`; desired privileges are then regranted because cascading revocation can remove privileges dependent on that grant option.

File:

- `src/pg-backend.ts`

### CLI

The CLI now exposes `--reconcile`. For a real reconciliation run it:

1. Connects to PostgreSQL.
2. Executes `BEGIN`.
3. Fetches metadata and compiles the delta in that transaction.
4. Executes the resulting mutation plan.
5. Executes `COMMIT`, or `ROLLBACK` on compilation/execution failure.

File:

- `src/cli.ts`

### Documentation

The README includes the new configuration option, transaction behavior, concurrency expectation, and the retained role/RLS semantics.

File:

- `README.md`

### Tests

A focused PostgreSQL integration test covers:

- Initial minimal grants
- Revoking an existing role membership
- An unchanged second run producing only `BEGIN; COMMIT;`
- Revoking manually introduced privilege drift without regranting unchanged state
- Adding and removing column-level privileges
- Removing an unexpected grant option and restoring the desired ordinary privilege
- Convergence to a no-op after each applied delta

File:

- `test/reconcile.test.ts`

## Validation status

Completed successfully:

- `pnpm build`
- `pnpm exec tsx --test test/reconcile.test.ts`
- `git diff --check`

The focused integration test runs against PostgreSQL and passes.

The full existing suite passes under the supported Node 20 runtime: 309 tests passed with no failures. Running the suite under the unsupported local Node 19 runtime produces `node:test` parent-lifecycle failures; the same unchanged tests pass under Node 20 and Node 22.

`pnpm check` is also currently blocked before checking source files because the existing `biome.json` contains the unsupported `nursery.noUnusedImports` key for the installed Biome version. This configuration problem was not changed.

## Follow-up review items

Before merging, another agent should review these areas carefully:

1. PostgreSQL-version compatibility of the catalog queries across the supported PostgreSQL 12-18 matrix, especially `aclexplode`, procedure ACL handling, partitioned/foreign/materialized relations, and explicit `NULL` ACL behavior.
2. Function and procedure overloads. The existing permission model identifies routines only by schema and name, and generated SQL omits argument signatures. Reconciliation preserves that existing limitation, but overloaded routines deserve explicit testing.
3. Group semantics. `SQLActor` includes users and groups, while the existing revoke policy and RLS expansion have nuanced behavior. Add focused reconciliation coverage for direct grants to groups and memberships involving group roles.
4. `dry-run` and `dry-run-short` behavior with `--reconcile`, including documentation or tests for exactly what each includes.
5. CLI error handling if `ROLLBACK` itself fails. The current implementation follows the project's straightforward error style, but rollback failure could mask the original exception.
6. Ordering and dependency behavior around `REVOKE ... CASCADE`, especially grant options. The implementation conservatively regrants all desired privileges if any managed grant-option privilege is removed.
7. Decide whether the output for an unchanged reconciliation should remain `BEGIN; COMMIT;` or whether query construction should return an empty string and let the CLI commit its already-open transaction. The current behavior is tested and harmless, but an empty compiled plan may be clearer.

## Optional future work

- Add an optional transaction-scoped advisory lock to serialize cooperating `sqlauthz` processes.
- Add a post-apply metadata read and convergence assertion before commit.
- Reconcile restrictive RLS policies by comparing policy command, mode, roles, and normalized expressions, using `ALTER POLICY` where possible and replacement only when necessary.
- Add a structured reconciliation plan/result such as counts of grants, revokes, memberships, and policy changes. This would improve dry-run output and compliance reporting.
- Consider whether reconciliation should become the default after it has matured, retaining replacement mode as a forced-reset strategy.

## Working-tree note

The repository already contained unrelated modified/untracked files. They were intentionally left untouched. The task-related files are:

- `README.md`
- `src/api.ts`
- `src/backend.ts`
- `src/cli.ts`
- `src/pg-backend.ts`
- `src/sql.ts`
- `test/reconcile.test.ts`
- `task.md`

Review `git status` before staging so unrelated user files are not included accidentally.
