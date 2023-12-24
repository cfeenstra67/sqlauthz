
allow(actor, "usage", "test") if actor == user1;

allow(actor, "select", resource)
    if actor == user1
    and resource == "test.articles"
    and forall(x in ["author", "title"], resource.col != x);
