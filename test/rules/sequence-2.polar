
allow(actor, "usage", "test") if actor == user1;

allow(actor, _, resource)
    if actor == user1
    and name in ["test.seq1", "test.seq2"]
    and resource == name;
