
allow(actor, "usage", "test") if actor == user1;

allow(actor, _, table)
    if actor == user1
    and table == "test.articles"
    and table.row.created_at == sql.date_trunc("hour", table.row.updated_at);
