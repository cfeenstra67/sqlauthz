
allow(actor, "select", "test.articles")
    if actor.type == "user"
    and actor.name == "does_not_exist";
