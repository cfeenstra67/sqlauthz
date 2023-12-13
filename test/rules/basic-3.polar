
allow(actor, "usage", "test") if isAppUser(actor);

allow(user, _, table)
    if isAppUser(user)
    and table == "test.articles"
    and table.col in ["id", "title"]
    and table.row.author = "Author A"
    and table.row.id < 5;

isAppUser(actor) if actor in [user1];
