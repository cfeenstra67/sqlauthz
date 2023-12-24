# sqlauthz - Declarative permissions management for PostgreSQL

> [!WARNING]
> `sqlauthz` is still experimental. Because permissions have such critical security implications, it's highly recommended that you **inspect the SQL queries** (using the `--dry-run` or `--dry-run-short` CLi arguments) that `sqlauthz` will run before running them and **test** that the resulting roles behave how you expect when using it with any important data.

`sqlauthz` allows you to manage your permissions in PostgresSQL in a **declarative** way using simple rules written in the [Polar](https://www.osohq.com/docs/reference/polar/foundations) language. Polar is a language designed by [Oso](https://www.osohq.com/) specifically for writing authorization rules, so its syntax is a great fit for declaring permissions. As an example of what this might look like, see the examples below:

```polar
# Give `user1` the `USAGE` permission on schema `myschema`;
allow("user1", "usage", "myschema");

# Allow `user1` to run `SELECT` queries on the columns "id" and "othercolumn"
# and rows where the "owner" column is equal to "owner1" in table "myschema.mytable"
allow("user1", action, resource)
    if action in ["select"]
    and resource == "myschema.mytable"
    and resource.col in ["id", "othercolumn"]
    and resource.row.owner == "owner1";

# Give `user2`, `user3`, and `user4` `USAGE` on the `test` schema
# And all permissions on all tables within the `test` schema
allow(actor, _, resource)
    if isInTestGroup(actor)
    and resource.schema == "test";
    
isInTestGroup(user) if user in ["user2", "user3"];
isInTestGroup("user4");
```

Currently `sqlauthz` support PostgreSQL as a backend, and it allows you to define:

- Schema permissions
- Table permissions **including column and row-level security**
- View permissions
- Function and procedure permissions
- Sequence permissions

To get started, check out the [Table of Contents](#table-of-contents) below.

## Table of Contents

- [Installation](#installation)
- [Compatibility](#compatilibity)
- [CLI](#cli)
    - [CLI Configuration](#cli-configuration)
    - [User revoke strategies](#user-revoke-strategies)
- [Using `sqlauthz` as a library](#using-sqlauthz-as-a-library)
- [Writing rules](#writing-rules)
    - [Using SQL functions in row-level security clauses](#using-sql-functions-in-row-level-security-clauses)
    - [Available constants](#available-constants)
    - [Permissions that depend on one another](#permissions-that-depend-on-one-another)
- [Incremental Adoption](#incremental-adoption)
- [Examples](#examples)
    - [A complete example](#a-complete-example)
    - [Grant a user all permissions on all schemas](#grant-a-user-all-permissions-on-all-schemas)
    - [Grant a group of users all permissions on a schema](#grant-a-group-of-users-all-permissions-on-a-schema)
    - [Grant a user read-only access on a schema](#grant-a-user-read-only-access-on-a-schema)
    - [Grant a user read permissions on a limited set of rows and columns in a table](#grant-a-user-read-permissions-on-a-limited-set-of-rows-and-columns-in-a-table)
- [Motivation](#motivation)
- [Limitations](#limitations)
- [Support and Feature Requests](#support-and-feature-requests)

## Installation

`sqlauthz` is distributed as an `npm` package, so you can install it via your favorite package manager:
```bash
npm install --save-dev sqlauthz
```
You may not want to install it as a development dependency if you plan on using it [as a library](#using-sqlauthz-as-a-library) within your application.

## Compatilibity

`sqlauthz` has automated testing in place and is compatible with node 18 and 20, and PostgreSQL versions 12-16. It may be compatible with older versions of either, but it has not been tested.

## CLI

Most users will probably want to use `sqlauthz` via the command line. There are three ways to configure `sqlauthz` via CLI:

- command line arguments
- environment variables
- under the `sqlauthz` key in `package.json`

In order to invoke the `sqlauthz` CLI, just invoke the `sqlauthz` command:
```bash
npm run sqlauthz
# or
npx sqlauthz
```

### CLI Configuration

The configuration options for `sqlauthz` can be found in the table below. Note that the argument name in the `sqlauthz` key of `package.json` is given first, then the CLI argument, then the environment variable:

| Name | Required | Default | Description |
| ---- | -------- | ------- | ----------- |
| `databaseUrl`<br/>`-d`, `--database-url`<br/>`SQLAUTHZ_DATABASE_URL` | Yes | | Database URL to connect to for reading the current schema and executing queries (unless one of the `dryRun` arguments is passed) |
| `rules`<br/>`-r`, `--rules`<br/>`SQLAUTHZ_RULES` | No | `['sqlauthz.polar']` | Path(s) to `.polar` files containing rules. Globs (e.g. `sqlauthz/*.polar`) are supported. Note that only a single path is supported when setting this argument via environment variable |
| `revokeReferenced`<br/>`--revoke-referenced`<br/>`SQLAUTHZ_REVOKE_REFERENCED` | No | `true` | Use the `referenced` user revoke strategy. This is the default strategy. See [User revoke policy](#user-revoke-policy) for details. Conflicts with `revokeAll` and `revokeUsers`. Note that if setting this via environment variable, the value must be `true`. |
| `revokeAll`<br/>`--revoke-all`<br/>`SQLAUTHZ_REVOKE_ALL` | No | `false` | Use the `all` user revoke strategy. See [User revoke policy](#user-revoke-policy) for details. Conflicts with `revokeReferenced` and `revokeUsers`. Note that if setting this via environment variable, the value must be `true`. |
| `revokeUsers`<br/>`--revoke-users`<br/>`SQLAUTHZ_REVOKE_USERS` | No | `false` | Use the `users` revoke strategy, revoking permissions from a list of users explicitly. See [User revoke policy](#user-revoke-policy) for details. Conflicts with `revokeReferenced` and `revokeAll`. Note that if setting this via environment variable, only a single value can be passed. |
| `allowAnyActor`<br/>`--allow-any-actor`<br/>`SQLAUTHZ_ALLOW_ANY_ACTOR` | No | `false` | Allow rules that do not put any limitations on the `actor`, so they apply to all users. This is potentially dangerous, particularly when used with `revokeReferenced` (the default), so it is disabled by default. This argument allows these rules (but make sure that you know what you're doing!). |
| `var`<br/>`--var`<br/>`SQLAUTHZ_VAR` | No | <none> | Inject variables into scope that can be utilized by your rules files. The syntax for variables injected via command line is `<name>=<value>`. The CLI will attempt to parse `<value>` a JSON string, and if that fails it will just be interpreted as a string. Within your rules files, variables can be access with `var.<name>`. This can be used to parametrize your rules files, and separate your configuration from your permissions logic. Also see `--var-file` for more flexibility. |
| `varFile`<br/>`--var-file`<br/>`SQLAUTHZ_VAR_FILE` | No | <none> | Specify script(s) or JSON file(s) that will be loaded, and their exports will be used to inject variables into your rules files. Glob paths are supported e.g. `*.js`. The file(s) must have `.js` or `.json` extensions. Within your rules files, variables can be access with `var.<name>`. `--var` will take priority over variables loaded from file(s) loaded with this argument. This can be used to separate your permissions logic from your configuration. For an example, see the [complete example](#a-complete-example) below. |
| `dryRun`<br/>`--dry-run`<br/>`SQLAUTHZ_DRY_RUN` | No | `false` | Print the full SQL query that would be executed instead of executing it. Note that if setting this via environment variable, the value must be `true`. This conflicts with `dryRunShort` |
| `dryRunShort`<br/>`--dry-run-short`<br/>`SQLAUTHZ_DRY_RUN_SHORT` | No | `false` | Print an abbreviated SQL query, only containing the `GRANT` queries that will be run, instead of executing anything. Note that if setting this via environment variable, the value must be `true`. This conflicts with `dryRun` |
| `debug`<br/>`--debug`<br/>`SQLAUTHZ_DEBUG` | No | `false` | Print more detailed error information for debugging compilation failures. Note that if setting this via environment variable, the value must be `true`. |

_NOTE_: Environment variables will be loaded from your `.env` file and used as arguments where applicable. The order of precedence for configuration arguments is:
- Command line args
- Environment variables
- The `sqlauthz` key in `package.json`
You can disable the loading of environment variables from you `.env` file by setting the `NO_DOTENV` environment variable to any truthy value.

### User revoke strategies

The intent of `sqlauthz` is the after you apply your permission rules, they will define the entire set of permissions for a user. Before `sqlauthz` applies new permissions, it revokes all permissions from a set of users first. It both revokes and grants the permissions as part of the same transaction, however, so in practice this does not lead to any "downtime" where a user has no permissions.

It's possible that you may not want to control the permissions of all of your users. This is particularly true if you're just trying `sqlauthz` out or adopting it incrementally. To allow you to use `sqlauthz` in a way that works for your use-case, there are three different "user revoke strategies" in `sqlauthz`. A "user revoke strategy" determines what users to revoke permissions from before granting permissions. The three strategies are as follows:

- `referenced` (default) - Any user who would be granted a permission by your rules will have all of their permissions revoked beforehand. This has the benefit of only affecting users who reference in your rules, but it can be dangerous when used in conjunction with `allowAnyActor`. By default, this is enabled and `allowAnyActor` is disabled. Another downside of this strategy is that **if you reference a particular user, apply permissions, then remove the rules that grant permissions to that user, the permissions will not be removed the next time you update permissions**.
- `all` - Revoke permissions from all non-superusers users before granting permissions. This has the benefit of being the most secure, as it ensures that your rules define the entire set of permissions for non-superusers in your database. It fixes the issue with the `referenced` strategy that removing rules for a particular user will revoke them the next time you apply your permissions, with the tradeoff that if you choose this strategy, you must manage all of your users' permissions this way.
- `users` - Define a specific list of users whose permissions should be revoked before granting permissions. This is a balance between the `referenced` and `all` strategies if you have a specific set of users who you'd like to manage the permissions for using `sqlauthz`.

_NOTE_: Superuser's permissions cannot be limited using `sqlauthz`, because they cannot be limited by PostgreSQL permissions in general. They are ignored by `sqlauthz` entirely, and will never have permissions granted to or revoked from them.

## Using `sqlauthz` as a library

_NOTE_: This API may change within major version 0

If you want to embed `sqlauthz` within your application, you can also use it as a library. To do this, you must do three things:
- Create an instance of `PostgresBackend`, passing in a `pg.Client` instance.
- Call `compileQuery` to compile your query
- Execute the query

Here's a simple usage example:
```typescript
import pg from 'pg';
import {
  PostgresBackend,
  compileQuery
} from 'sqlauthz';

const client = new pg.Client('my-db-url');
await client.connect();

const result = await compileQuery({
  backend: new PostgresBackend(client),
  paths: ['./my-rules-file.polar']
});
if (result.type === 'success') {
  await client.query(result.query);
} else {
  console.log(result.errors);
}

await client.end();
```
The libary is quite simple, so if you need to do something different you can likely read the source code to figure out how to do it. If you have any issues, feel free to [create an issue](https://github.com/cfeenstra67/sqlauthz/issues/new).

See the [`CompileQueryArgs`](https://github.com/cfeenstra67/sqlauthz/blob/main/src/api.ts#L6) type for a full definition of arguments that can be passed to `compileQuery()`. For the most part they are 1-1 with CLI arguments, with a few minor differences:
- `paths` does not resolve globs
- `--dry-run-short` is equivalent to compiling the query with `includeTransaction: false` and `includeSetupAndTeardown: false`

## Writing Rules

Top-level rules are written via `allow(actor, action, resource)` declarations. Each of the `actor`, `action`, and `resource` variables has different semantics:

- `actor` - Represents a **user** or **group** in PostgreSQL. Will always be a string. Users and groups must be compared directly, via `actor == "some-user"` or `actor in ["some-user", "some-other-user"]`. User/group names must exactly match the values you compare them to.
    - **user** - Can be compared directly with strings e.g. `actor == "my_user"`
        - `actor.type` - Equal to `"user"`
    - **group** - Can be compared directly with strings e.g. `actor == "my_group"`
         - `actor.type` - Equal to `"group"`

- `action` - Will always be a string. Actions must be compared directly, via `action == "some-action"` or `action in ["some-action", "some-other-action"]`. Action names are **case insensitive**, so `SELECT` works exactly the same as `select`. The following privileges are currently supported:
    - Table permissions - `"select"`, `"insert"`, `"update"`, `"delete"`, `"truncate"`, `"references"`, `"trigger"`
        - Row-level security supported for `select`, `insert`, `update`, `delete`
        - Column-level security supported for `select`, `insert`, `update`
    - Schema permissions - `"usage"`, `"create"`
    - View permissions - `"select"`, `"insert"`, `"update"`, `"delete"`, `"trigger"`. Note that only "simple views" are updatable, see the [postgres documentation](https://www.postgresql.org/docs/current/sql-createview.html) for more details.
    - Function and procedure permissions - `"execute"`
    - Sequence permissions - `"select"`, `"update"`, `"usage"`

- `resource` - This can represent either a **table** or a **schema**. The semantics are different for different types of database objects, described below:
    - **tables** - Can be compared directly with strings. When comparing directly table names must be schema-qualified. e.g. `resource == "someschema.sometable"`
        - `resource.type` - Equal to `"table"`, e.g. `resource.type == "table"`
        - `resource.name` - The table name, without schema, e.g. `resource.name == "sometable"`
        - `resource.schema` - The schema name, e.g. `resource.schema == "someschema"`
        - `resource.col` - Filter which columns the permission applies to, e.g. `resource.col in ["col1", "col2"]`
        - `resource.row.<col>` - Filter which rows the permission applies to via row-level security policies, e.g. `resource.row.id == 12`.
    - **schemas** - Can be compared directly with strings, e.g. `resource == "someschema"`
        - `resource.type` - Equal to `"schema"`, e.g. `resource.type == "schema"`
        - `resource.name` - Equal to the schema name, e.g. `resource.name == "someschema"`
        - `resource.schema` - Equal to the schema name, equivalent to `resource.name`. This only exists so that one can simply give permissions across an entire schema including both tables and the schema itself by writing `resource.schema == "someschema"`.
    - **views** - Can be compared directly with strings, e.g. `resource == "myschema.myview"`
        - `resource.type` - Equal to `"view"` e.g. `resource.type == "view"`
        - `resource.name` - The view name, without schema e.g. `resource.name == "someview"`
        - `resource.schema` - The schema name, e.g. `resource.schema == "someschema"`
    - **functions** - Can be compared directly with strings, e.g. `resource == "myschema.myfunction"`
        - `resource.type` - Equal to `"function"` e.g. `resource.type == "function"`
        - `resource.name` - The function name, without schema e.g. `resource.name == "somefunction"`
        - `resource.schema` - The schema name, e.g. `resource.schema == "someschema"`
    - **procedures** - Can be compared directly with strings, e.g. `resource == "myschema.myprocedure"`
         - `resource.type` - Equal to `"procedure"` e.g. `resource.type == "procedure"`
         - `resource.name` - The procedure name, without schema e.g. `resource.name == "someprocedure"`
         - `resource.schema` - The schema name, e.g. `resource.schema == "someschema"`
    - **sequences** - Can be compared directly with strings e.g. `resource == "myschema.mysequence"`
        - `resource.type` - Equal to `"sequence"` e.g. `resource.type == "sequence"`
        - `resource.name` - The sequence name, without schema e.g. `resource.name == "somesequence"`
        - `resource.schema` - The schem aname, e.g. `resource.shcmea == "someschema"`

For a full explanation of polar semantics, you can read the [Polar Documentation](https://www.osohq.com/docs/reference/polar/foundations).

For complete examples of how rules look in practice, consult the [examples](#examples).

### Using SQL functions in row-level security clauses

`sqlauthz` supports using SQL functions in row-level security clauses, though there are some [limitations](#limitations). In order to use `sql` functions, you must use the syntax of `sql.<function_name>`. For example:

```polar
allow("bob", "select", table)
    if table == "my.table"
    and table.row.owner_id == sql.current_setting("my.custom.setting");
```
You can also use SQL functions that take columns as input. For example:
```polar
allow("bob", "select", table)
    if table == "my.table"
    and table.row.created_at == sql.date_trunc("day", table.row.updated_at);
```
You can also nest SQL function calls:
```polar
allow("bob", "select", table)
    if table == "my.table"
    and table.row.created_at == sql.date_trunc("day", sql.now());
```
You should be able to use any SQL function that is available in your database. You can also use schema-qualified functions for those that are not built in:
```polar
allow("bob", "select", table)
    if table == "my.table"
    and table.row.id == sql.my.function(table.row.owner_id);
```

Note that while this should work fine for simple row-level security policies, but if you try to do something arbitrary complex you may run into issues. Please [open an issue](https://github.com/cfeenstra67/sqlauthz/issues/new) if you do. One known limitation is that operating on a literal and a function call with a column on an input will require you to use the `sql.lit` helper function to declare the literal:
```polar
allow("bob", "select", table)
    if table == "my.table"
    and sql.date_trunc("day", table.row.updated_at) == sql.lit("2023-01-01T00:00:00");
```

### Available constants

`sqlauthz` exposes some constants that you can use in your polar rules. Available constants:
    - `sql` - This contains utilities that you can use for writing row-level security rules with SQL functions. For examples see [Using SQL functions in row-level security clauses](#using-sql-functions-in-row-level-security-clauses). Available members:
        - `<sql_function>` - Built-in SQL functions in Postgres such as `date_trunc`. Only functions from the `pg_catalog` schema can be referenced without schema-qualification.
        - `<schema>.<sql_function>` - Schema-qualified SQL functions; typically these would be user-defined functions that you write.
        - `lit` - Due to limitations in `sqlauthz`, when writing row-level security rules that compare the result of a SQL function with a literal, `lit()` must be used to wrap the literal. There is an example in the [previous section](#using-sql-functions-in-row-level-security-clauses).
        - `cast` - corresponds to the SQL `CAST(value AS type)` syntax. This can be called with the `value` being a `resource.row.<col>` or the result of a SQL function, and the `type` should be a string literal. E.g. `sql.cast(resource.row.id, "bigint")`
    - `permissions` - This contains arrays of the available permissions for each object type that can be used in rules if you wish. Available members:
        - `schema` - `["USAGE", "CREATE"]`
        - `table` - `["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]`
        - `view` - `["SELECT", "INSERT", "UPDATE", "DELETE", "TRIGGER"]`
        - `function` - `["EXECUTE"]`
        - `procedure` - `["EXECUTE"]`
        - `sequence` - `["USAGE", "SELECT", "UPDATE"]`

### Permissions that depend on one another

One thing to be careful of when defining permissions with `sqlauthz` is that there are some permissions in Postgres that depend on one another. This list is not exhaustive, but rather meant to highlight some of the most common "gotchas" with respect to dependent permissions. For complete and up-to-date information on PostgreSQL privileges you should consult the [PostgreSQL documentation](https://www.postgresql.org/docs/current/ddl-priv.html).

- **table/view/sequence/function/procedure permissions depend on the schema's usage permission** - If you defined permission on objects within a schema such a `SELECT` on a table or view, you will still get a "permission denied" message with the user attempting to utilize that permission unless you grant `USAGE` on the schema in which the object exists. For example, if you grant a user the `SELECT` permission on a table called `app.users`, you must also grant the user the `USAGE` permission on the `app` schema in order to utilize it.

- **insert permissions for autoincremented primary keys depend on the sequence's usage permission** - If you defined an `INSERT` permission for a table and are using an autoincremented primary key such as a `SERIAL` or `BIGSERIAL` type, you will get a "permission denied" error if you do not also grant access to the underlying sequence that provides values for that column. Sequences created for autoincremented postgres columns are created in the same schema as the table, and are named `<schema>.<table>_<name>_seq`. E.g. for the `id` column of a table called `app.users`, the sequence would be `app.users_id_seq`.

It can often be tricky to get permissions right on the first try; for this reason, it's recommended that you do some testing after applying your permissions to confirm that they're doing what you expect.

## Incremental Adoption

In most cases, you'll be adopting `sqlauthz` into an existing database that already has roles, and possibly permissions, defined. It's a good idea to start by creating new role(s) to be managed by `sqlauthz`, and managing only those roles with `sqlauthz`. To achieve this, you should use the `users` revoke strategy to ensure you don't affect the permissions of any of your existing users. You can achieve this using the `revokeUsers` argument. For example, in your `package.json`:
```json
{
    ...
    "sqlauthz": {
        "revokeUsers": ["user1", "user2", "user3"]
    }
}
```
This can also be specified on the command line. See the [CLI Configuration](#cli-configuration) section for details.

## Examples

These are a limited set of examples on how you can express certain rule sets in `sqlauthz` using polar. Note that the possiblities are nearly endless, and you should learn about the [Polar language](https://www.osohq.com/docs/reference/polar/foundations) if you want to have a firm grasp on everything that's possible. You can also check out the [tests](https://github.com/cfeenstra67/sqlauthz/tree/main/test/rules), which includes many minimal examples of rules. If you're not sure if something's possible or how to do it, always feel free to [open an issue](https://github.com/cfeenstra67/sqlauthz/issues/new) and I'll be happy to help you our and/or augment these examples with what you're looking for.

### A complete example

This example shows how you can effectively segment your permissions into various virtual "roles" that can easily be assigned to new users and/or groups. This is split up into multiple scripts as an example of how you might want to organize your rules into a few different files. This also showcases how you can use the `varFile` argument to parametrize your rules and separate your configuration from your permissions logic. For this example, you would add the following configuration to your `package.json` (alternatively, specify `--var-file roles.json -r permissions.polar roles.polar` on the command line):
```json
{
    ...
    "sqlauthz": {
        "rules": ["permissions.polar", "roles.polar"],
        "varFile": ["roles.json"]
    }
}
```

`permissions.polar`
```polar
# Grant everyone USAGE on all schemas except the `sensitive` one
allow(actor, "usage", resource)
    if isQA(actor)
    and resource.type == "schema"
    and resource != "sensitive";

# Grant devs USAGE on the `sensitive` schema
allow(actor, "usage", "sensitive") if isDev(actor);

# Grant QA read-only access to all tables and views except those in the "sensitive"
# schema. Grant devs read-only access on the `usage` tables as well
allow(actor, "select", resource)
    if isQA(actor)
    and obj_type in ["table", "view"]
    and resource.type == obj_type
    and resource.schema != "sensitive";

# Grant devs full access on all tables and views, and sequences
# except the TRUNCATE permission
allow(actor, permission, resource)
    if isDev(actor)
    and permission != "truncate"
    and obj_type in ["table", "view", "sequence"]
    and resource.type == obj_type;

# Grant app users usage on the app schema
allow(actor, "usage", "app") if isApp(actor);

# Grant app users usage on the app.users_id_seq sequence
allow(actor, "usage", "app.users_id_seq") if isApp(actor);

# Grant app users access to the `app.users` table limited by row-level security
# based on the current user.org_id setting. This would be set in the application
# code via a `SET ` query before running other queries, and queries would fail without
# this set. Do not allow them to access the "internal_notes" column
allow(actor, permission, resource)
    if isApp(actor)
    and permission in ["select", "insert", "update", "delete"]
    and resource == "app.users"
    # Note: for multiple columns this could either be stated
    # as `resource.col != "internal_notes" and resource.col != "other"`
    # or `forall(x in ["internal_notes", "other"], resource.col != x)`
    # `not resource.col in ["internal_notes", "other"] does NOT work`
    and resource.col != "internal_notes"
    and resource.row.org_id == sql.current_setting("user.org_id");
```

`roles.polar`
```polar
# Assign some users as "devs", which will get a certain set of permissions
isDev(actor)
    if name in var.devUsers
    and actor.type == "user"
    and actor == name;

# Assign some users to the QA group, which will get a certain set of permissions
# This is equivalent to the isDev syntax above except these rules don't check that
# the actor is a user and not a group (which usually shouldn't be an issue, but it
# could depend on how your DB is set up. When using `sqlauthz` using postgresql groups
# shouldn't really be necessary)
isQA(actor) if actor in var.qaUsers;

# Devs should have all of the QA permissions
isQA(actor) if isDev(actor);

# Virtual group for DB roles used by apps
isApp(actor) if actor in var.appUsers;
```

`roles.json`
```json
{
    "devUsers": ["bob", "greg", "julie", "marianne"],
    "qaUsers": ["randy", "john", "ariel"],
    "appUsers": ["api_svc", "worker_svc"]
}
```

### Grant a user or group all permissions on all schemas

```polar
allow("bob", _, _);
```

### Grant multiple users or groups all permissions on a schema

```polar
allow(actor, _, resource)
    if isInGroup(actor)
    and resource.schema == "schema1";

isInGroup("bob");
isInGroup(actor) if actor in ["jenny", "james"];
```

### Grant a group read-only access on a schema

```polar
allow(actor, action, resource)
    if actor == "bob"
    and actor.type == "group"
    and action in ["select", "usage"]
    and resource.schema == "schema1";
```

### Grant a user or group read permissions on a limited set of rows and columns in a table

```polar
allow("bob", "select", resource)
    if resource == "api.mytable"
    and (resource.row.mycol == "abc" or resource.row.mycol2 < 12)
    and resource.row.col in ["mycol", "mycol3"];
```

## Motivation

The primary motivation for creating `sqlauthz` was that although PostgreSQL supports fine-grained permissions including row and column-level security, I've always found it difficult to take advantage of these features in real production systems.

The difficult thing about fully making use of fine-grained permissions is mainly maintaining them as the number of roles and database objects grow, which tends to happen at a pretty rapid clip in many actively developed applications. Using most SQL migration tools, either:
- You do define your objects declaratively (e.g. many ORMs) and the tool generates your SQL scripts for you, but typically these tools only support operations tables.
- Your write your SQL scripts yourself, in which case it can be very difficult to understand the current state of your database as the number of scripts grow.

Declarative configuration is an excellent fit for maintaining complex systems as they change over time because the maintainer need only decide the state they want their system to be in, not the steps needed to get there. This is a very popular feature of ORMs, where they inspect models declared in code and generate SQL migrations scripts to update the database to match the state of the declared models. Similarly, infrastructure-as-code tools take a declarative configuration of desired cloud resources and make API calls to update your cloud resources to the desired state.

`sqlauthz` takes the declarative configuration approach and applies it to PostgreSQL permissions. It's designed so that writing simple rules is simple, but it's also easy to scale the complexity of the rules to be as fine-grained as you want them to be. It takes a zero-access-by-default approach, so that all permissions need to be explicitly granted to a user. I chose the polar language because I've had success with it in other projects as a great, clean way to write authorization rules.

## Limitations

`sqlauthz` is still very early in its development and while it should have enough functionality to be usable for a lot of use-cases, there's a lot of functionality missing as well. More or less all of these are on my radar as improvement to make eventually, however if any of these are particularly important to you feel free to [open an issue](https://github.com/cfeenstra67/sqlauthz/issues/new) and let me know. That will help me prioritize what to work on first.

- Currently only supports permissions on tables, views, schemas, functions, procedures, and sequences (not types, languages, large objects, etc.).

- **`sqlauthz` never alters default privileges.** Let me know via opening an issue if this is something you're interested in. In particular, by default all users have EXECUTE privleges on functions and procedures. To change this, you can use the following one-time query:
```sql
ALTER DEFAULT PRIVILEGES
REVOKE ALL PRIVILEGES ON ROUTINES FROM PUBLIC;
```

- Does not support setting permissions on built-in functions or procedures (defined as functions in the `pg_catalog` schema)

- Support for using SQL functions in row-level security clauses is imperfect. It works for most cases, but there are some known limitations (See [Using SQL functions in row-level security clauses](#using-sql-functions-in-row-level-security-clauses) for an explanation of how to use SQL functions in row-level seucurity clauses):
    - You cannot write a clause that compares the results of two function calls e.g. `sql.date_trunc("hour", table.row.created_at) == sql.date_trunc("hour", table.row.updated_at)`. At the moment there is no workaround; this is something that is very difficult to support with the `oso` Polar engine.
    - When writing a clause that operates on the result of a function call and a literal, you will have to use the `sql.lit` helper to declare the literal. E.g. rather than `sql.date_trunc("hour", table.row.created_at) == "2023-01-01T00:00:00"` you would have to write `sql.date_trunc("hour", table.row.created_at) == sql.lit("2023-01-01T00:00:00")`.
        - This includes if you use a SQL function that returns a boolean e.g. rather than `if sql.my_func.is_ok(resource.row.id)` you should write `if sql.my_func.is_ok(resource.row.id) == sql.lit(true)`

- When using SQL functions in row-level security clauses, number and type of arguments are unchecked.

- Currently there is no way to use joins or select from other tables in row-level security queries.

- At the moment will only grant permissions on objects that exist in the database at the time of applying permissions. For example, if you write a rule that allows access to all objects within a schema, `sqlauthz` will generate a `GRANT` query for each one of those objects individual rather than one with `FOR ALL TABLES IN SCHEMA <schema>`.

## Support and Feature Requests

If you encounter a bug with `sqlauthz`, want to request support for another SQL backend, or would like to see more features added to `sqlauthz`, please [open an issue](https://github.com/cfeenstra67/sqlauthz/issues/new) and I'll try to help you out as quickly as possible.
