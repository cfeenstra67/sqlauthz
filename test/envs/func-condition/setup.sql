BEGIN;

CREATE SCHEMA test;

CREATE FUNCTION test.is_1(value INT) RETURNS boolean
    AS $$ SELECT value = 1 $$
    LANGUAGE SQL;

CREATE TABLE test.articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL
);

INSERT INTO test.articles (id, title) VALUES
    (1, 'Title 1'),
    (2, 'Title 2');

CREATE USER {{user1}} WITH PASSWORD 'blah';

COMMIT;
