
allow(actor, "usage", "app") if actor == user1;

allow(actor, "select", table)
    if actor == user1
    and table == "app.users"
    and table.row.org_id == sql.cast(sql.current_setting("user.org_id"), "bigint");
