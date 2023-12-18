
allow(actor, _, schema)
    if actor == user3
    and schema == "test";

allow(actor, _, table)
    if actor == user3
    and table == "test.articles";
