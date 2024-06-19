
allow(actor, "select", resource)
    if actor == user1
    and resource.type == "does_not_exist"
    and resource == "api.articles";
