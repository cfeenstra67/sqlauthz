CREATE FUNCTION {{tmpSchema}}.revoke_all_from_role(username TEXT) RETURNS TEXT AS $$
declare
    role_row record;
    schema_row record;
begin
    -- Revoke all existing roles
    FOR role_row IN
        SELECT
            m.roleid::regrole::text as rolename
        FROM
            pg_roles r
            JOIN pg_auth_members m ON r.oid = m.member
        WHERE
            r.rolname = username
    LOOP
        execute format('REVOKE %I FROM %I', role_row.rolename, username);
    END LOOP;
    -- Revoke all existing privileges
    FOR schema_row IN 
        SELECT DISTINCT schema_name FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
    LOOP
        execute format(
            'REVOKE USAGE ON SCHEMA %I FROM %I CASCADE',
            schema_row.schema_name,
            username
        );
        execute format(
            'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM %I CASCADE',
            schema_row.schema_name,
            username
        );
        -- execute format(
        --     'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM %I CASCADE',
        --     schema_row.schema_name,
        --     username
        -- );
        execute format(
            'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %I CASCADE',
            schema_row.schema_name,
            username
        );
        execute format(
            'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM %I CASCADE',
            schema_row.schema_name,
            username
        );
        execute format(
            'REVOKE ALL PRIVILEGES ON ALL PROCEDURES IN SCHEMA %I FROM %I CASCADE',
            schema_row.schema_name,
            username
        );
    END LOOP;

    return username;
end;
$$ LANGUAGE plpgsql STRICT SECURITY INVOKER;
