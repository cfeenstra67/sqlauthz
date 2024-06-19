
allow(actor, "select", resource)
    if actor == user1
    and resource.type == 1
    and resource == "api.articles";
