
allow(actor, "usage", "test") if actor == user1;

allow(actor, "select", table)
    if actor == user1
    and table == "test.articles"
    and sql.test.is_1(table.row.id) == sql.lit(true);
