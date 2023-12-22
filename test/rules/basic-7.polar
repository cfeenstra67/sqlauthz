
allow(actor, _, resource)
    if actor == user1
    and resource.type == "schema";

allow(actor, _, resource)
    if actor == user1
    and resource.type == "table"
    and resource.name == "articles";
