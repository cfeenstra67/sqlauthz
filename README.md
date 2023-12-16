# sqlauthz - Declarative permissions management for PostgreSQL

> [!WARNING]
> `sqlauthz` is still experimental. Because permissions have such critical security implications, it's very important that you **inspect the SQL queries** that `sqlauthz` will run before running them and **test** that the resulting roles behave how you expect when using it with any important data.

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
    and resource.row.owner = "owner1";

# Give `user2`, `user3`, and `user4` `USAGE` on the `test` schema
# And all permissions on all tables within the `test` schema
allow(actor, _, resource)
    if isInTestGroup(actor)
    and resource.schema = "test";
    
isInTestGroup(user) if user in ["user2", "user3"];
isInTestGroup("user4");
```

Currently `sqlauthz` support PostgreSQL as a backend, and it allows you to define:

- Schema permissions (`USAGE`)
- Table permissions (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), **including column and row-level security**

To get started, check out the [Table of Contents](#table-of-contents) below.

## Table of Contents

- [Installation](#installation)
- [Compatibility](#compatilibity)
- [CLI](#cli)
    - [CLI Configuration](#cli-configuration)
- [Using `sqlauthz` as a library](#using-sqlauthz-as-a-library)
- [Writing rules](#writing-rules)
- [Incremental Adoption](#incremental-adoption)
- [Examples](#examples)
- [Motivation](#motivation)
- [Limitations](#limitations)
- [Support and Feature Requests](#support-and-feature-requests)

## Installation

`sqlauthz` is distributed as an `npm` package, so you can install it via your favorite package manager:
```bash
npm install --save-dev sqlauthz
```
You may not want to install it as a development dependency if you plan on using it as a library within your application.

## Compatilibity

`sqlauthz` is tested and compatible with node 18+.

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

The configuration options for `sqlauthz` can be found in the table below:

| Name | Required | Default | CLI arg | Env Variable | Description |
| ---- | -------- | ------- | ------- | ------------ | ----------- |
| `databaseUrl` | Yes | | `-d`, `--database-url` | `SQLAUTHZ_DATABASE_URL` | Database URL to connect to for reading the current schema and executing queries (unless one of the `dryRun` arguments is passed) |
| `rules` | No | `['sqlauthz.polar']` | `-r`, `--rules` | `SQLAUTHZ_RULE` | Path(s) to `.polar` files containing rules. Note that only a single path is supported when setting this argument via environment variable |
| `dryRun` | No | `false` | `--dry-run` | `SQLAUTHZ_DRY_RUN` | Print the full SQL query that would be executed instead of executing it. Note that if setting this via environment variable, the value must be `true`. This conflicts with `dryRunShort` |
| `dryRunShort` | No | `false` | `--dry-run-short` | `SQLAUTHZ_DRY_RUN_SHORT` | Print an abbreviated SQL query, only containing the `GRANT` queries that will be run, instead of executing anything. Note that if setting this via environment variable, the value must be `true`. This conflicts with `dryRun` |
| `debug` | No | `false` | `--debug` | `SQLAUTHZ_DEBUG` | Print more detailed error information for debugging compilation failures. Note that if setting this via environment variable, the value must be `true`. |

_Note_: The argument names in the `sqlauthz` key in `package.json` match the "Name" column in the table above.

## Using `sqlauthz` as a library

If you want to embed `sqlauthz` within your application, you can also use it as a library. To do this, first you must do three things:
- Create an instance of `PostgresBackend`, passing in a `pg.Client` instance.
- Create an `Oso` instance
- Call `compileQuery` to compile your query
- Execute the query

Here's a simple usage example:
```typescript
import pg from 'pg';
import {
  createOso,
  PostgresBackend,
  compileQuery
} from 'sqlauthz';

const client = new pg.Client('my-db-url');
await client.connect();

const result = compileQuery({
  backend: new PostgresBackend(client),
  oso: await createOso({ paths: ['./my-rules-file.polar'] }),
});
if (result.type === 'success') {
  await client.query(result.query);
} else {
  console.log(result.errors);
}

await client.end();
```
The libary is quite simple, so if you need to do something different you can likely read the source code to figure out how to do it. If you have any issues, feel free to [create an issue](https://github.com/cfeenstra67/sqlauthz/issues/new).

## Writing Rules

Top-level rules are written via `allow(actor, action, resource)` declarations. Each of the `actor`, `action`, and `resource` variables has different semantics:

- `actor` - Represents a role in PostgreSQL. Will always be a string. Users must be compared directly, via `actor == "some-user"` or `actor in ["some-user", "some-other-user"]`. User names must exactly match the values you compare them to.

- `action` - Will always be a string. Actions must be compared directly, via `action == "some-action"` or `action in ["some-action", "some-other-action"]`. Action names are **case insensitive**, so `SELECT` works exactly the same as `select`. The following privileges are currently supported:
    - Table permissions - `"select"`, `"insert"`, `"update"`, `"delete"`
    - Schema permissions - `"usage"`

- `resource` - This can represent either a **table** or a **schema**. The semantics are different for tables and schema, described below:
    - **table** - Can be compared directly with strings. When comparing directly table names must be fully qualified. e.g. `resource == "someschema.sometable"`
        - `resource.type` - Equal to `"table"`, e.g. `resource.type == "table"`
        - `resource.name` - The table name, without schema, e.g. `resource.name == "sometable"`
        - `resource.schema` - The schema name, e.g. `resource.schema == "someschema"`
        - `resource.col` - Filter which columns the permission applies to, e.g. `resource.col in ["col1", "col2"]`
        - `resource.row.<col>` - Filter which rows the permission applies to via row-level security policies, e.g. `resource.row.id = 12`.
    - **schema** - Cab be compared directly with strings, e.g. `resource == "someschema"`
        - `resource.type` - Equal to `"schema"`, e.g. `resource.type == "schema"`
        - `resource.name` - Equal to the schema name, e.g. `resource.name == "someschema"`
        - `resource.schema` - Equal to the schema name, equivalent to `resource.name`. This only exists so that one can simply give permissions across an entire schema including both tables and the schema itself by writing `resource.schema == "someschema"`.

For a full explanation of polar semantics, you can read the [Polar Documentation](https://www.osohq.com/docs/reference/polar/foundations).

For complete examples of how rules look in practice, consult the [examples](#examples).

## Incremental Adoption

TODO

## Examples

TODO

## Motivation

The primary motivation for creating `sqlauthz` was that although PostgreSQL supports fine-grained permissions including row and column-level security, I've always found it difficult to take advantage of these features in real production systems.

The difficult thing about fully making use of fine-grained permissions is mainly maintaining them as the number of roles and database objects grow, which tends to happen at a pretty rapid clip in many actively developed applications.

Declarative configuration is an excellent fit for maintaining complex systems as they change over time because the maintainer need only decide the state they want their system to be in, not the steps needed to get there. This is a very popular feature of ORMs, where they inspect models declared in code and generate SQL migrations scripts to update the database to match the state of the declared models. Similarly, infrastructure-as-code tools take a declarative configuration of desired cloud resources and make API calls to update your cloud resources to the desired state.

`sqlauthz` takes the declarative configuration approach and applies it to PostgreSQL permissions. It's designed so that writing simple rules is simple, but it's also easy to scale the complexity of the rules to be as fine-grained as you want them to be. It takes a zero-access-by-default approach, so that all permissions need to be explicitly granted to a user. I chose the polar language because I've had success with it in other projects as a great, clean way to write authorization rules. And at the day, the difference between 

## Limitations

TODO

## Support and Feature Requests

If you encounter a bug with `sqlauthz`, want to request support for another SQL backend, or would like to see more features added to `sqlauthz`, please [open an issue](https://github.com/cfeenstra67/sqlauthz/issues/new) and I'll try to help you out as quickly as possible.
