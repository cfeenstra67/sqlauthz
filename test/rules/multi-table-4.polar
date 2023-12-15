
allow(user, "usage", resource)
    if user in [user1, user2]
    and resource in ["test", "test2"];

allow(user, _, resource)
    if user == user1
    and resource == "test.articles"
    and resource.row.id = 5;
