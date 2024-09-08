
allow(user1, "usage", "test");
allow(user2, "usage", "test");
allow(user1, "usage", "test.articles_id_seq");
allow(user2, "usage", "test.articles_id_seq");
allow(user1, "select", "test.articles");
allow(user2, "select", "test.articles");
allow(user1, "update", "test.articles");
allow(user2, "delete", "test.articles");

allow(user2, perm, resource)
    if resource == "test.articles"
    and perm in ["update", "insert"]
    and resource.row.author == "Author B";

allow(user1, perm, resource)
    if resource == "test.articles"
    and perm in ["delete", "insert"]
    and resource.row.author == "Author A";
