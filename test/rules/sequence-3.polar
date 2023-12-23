
allow(actor, "usage", "test") if actor == user1;

allow(actor, _, resource)
    if actor == user1
    and resource.schema == "test"
    and resource.name == "seq1";
