# SQLAuthz - Declarative permissions management for PostgreSQL

> [!WARNING]
> `sqlauthz` is still experimental. Because permissions have such critical security implications, it's very important that you **inspect the SQL queries** that `sqlauthz` will run before running them and **test** that the resulting roles behave how you expect when using it with any important data.

SQLAuthz allows you to manage your permissions in PostgresSQL in a **declarative** way using simple rules written in the [Polar](https://www.osohq.com/docs/reference/polar/foundations) language. Polar is a language designed by [Oso](https://www.osohq.com/) specifically for writing authorization rules, so its syntax is a great fit for declaring permissions. As an example of what this might look like, see the examples below:

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
- [CLI](#cli)
- [Using `sqlauthz` as a library](#using-sqlauthz-as-a-library)
- [Examples](#examples)
- [Support and Feature Requests](#support-and-feature-requests)

## Installation

`sqlauthz` is distributed as an `npm` package, so you can install it via your favorite package manager:
```bash
npm install --save-dev sqlauthz
```
You may not want to install it as a development dependency if you plan on using it as a library within your application.

# CLI

TODO

# Using `sqlauthz` as a library

TODO

# Examples

TODO

## Support and Feature Requests

If you encounter a bug with `SQLAuthz`, want to request support for another SQL backend, or would like to see more features added to `sqlauthz`, please [open an issue](https://github.com/cfeenstra67/sqlauthz/issues/new) and I'll try to help you out as quickly as possible.
