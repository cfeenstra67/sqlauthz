
allow(actor, _, resource)
    if actor == user1
    and resource.type == "schema";

allow(actor, "select", resource)
    if actor == user1
    and resource == "test.author_a_articles";
