
allow(actor, "usage", "test") if actor == user1;

allow(actor, _, table)
    if actor == user1
    and table == "test.articles"
    and sql.lit("2023-01-01 10:00:00") == sql.date_trunc("hour", table.row.updated_at);
