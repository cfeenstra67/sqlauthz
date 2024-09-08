
allow(actor, "usage", "test") if isAppUser(actor);

allow(user, action, table)
    if isAppUser(user)
    and action in ["select", "insert", "update", "delete"]
    and table_name in [
        "test.articles_but_with_an_extremely_long_table_name",
        "test.articles_but_with_an_extremely_long_table_name_2"
    ]
    and table == table_name
    and table.row.author = "Author A";

isAppUser(actor) if actor in [user1, user2];
