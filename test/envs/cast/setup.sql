BEGIN;

CREATE SCHEMA app;

CREATE TABLE app.users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    org_id BIGINT,
    internal_notes VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app.users (name, org_id, internal_notes) VALUES
('User 1', 12, 'Notes here'),
('User 2', 32, 'Notes here');

CREATE USER {{user1}} WITH PASSWORD 'blah';

COMMIT;
