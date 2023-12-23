isDev(actor)
    if name in [user1]
    and actor.type == "user"
    and actor == name;

isQA(actor) if actor == user2;

isQA(actor) if isDev(actor);

isApp(actor) if actor == user3;

allow(actor, "usage", resource)
    if isQA(actor)
    and resource.type == "schema"
    and resource != "sensitive";

allow(actor, "usage", "sensitive") if isDev(actor);

allow(actor, "select", resource)
    if isQA(actor)
    and obj_type in ["table", "view"]
    and resource.type == obj_type
    and resource.schema != "sensitive";

allow(actor, permission, resource)
    if isDev(actor)
    and permission != "truncate"
    and obj_type in ["table", "view", "sequence"]
    and resource.type == obj_type;

allow(actor, "usage", "app") if isApp(actor);

allow(actor, "usage", "app.users_id_seq") if isApp(actor);

allow(actor, permission, resource)
    if isApp(actor)
    and permission in ["select", "insert", "update", "delete"]
    and resource == "app.users"
    and resource.col != "internal_notes"
    and resource.row.org_id == sql.current_setting("user.org_id");
