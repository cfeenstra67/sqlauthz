
allow(actor, "usage", "test") if actor == user1;

allow(actor, _, table)
    if actor == user1
    and table == "test.articles"
    and table.col in ["author"]
    and table.row.author == sql.current_setting("my.author");
