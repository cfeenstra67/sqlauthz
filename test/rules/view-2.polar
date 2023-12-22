
allow(actor, _, resource)
    if actor == user1
    and resource == "test";

allow(actor, "select", resource)
    if actor == user1
    and resource.type == "view";
