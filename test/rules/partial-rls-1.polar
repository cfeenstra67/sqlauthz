
allow(user, "usage", "test") if user in [user1, user2];

allow(user, "select", resource)
    if user in [user1, user2]
    and table_name in ["test.articles", "test.articles2"]
    and table_name == resource
    and resource.row.author == "Author A";
