BEGIN;

CREATE SCHEMA test;

CREATE TABLE test.articles (
    id SERIAL PRIMARY KEY,
    author VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL
);

INSERT INTO test.articles (author, title)
VALUES
('Author A', 'Unique Title 1'),
('Author A', 'Unique Title 2'),
('Author A', 'Unique Title 3'),
('Author A', 'Unique Title 4'),
('Author A', 'Unique Title 5'),
('Author B', 'Unique Title 6'),
('Author B', 'Unique Title 7'),
('Author B', 'Unique Title 8'),
('Author B', 'Unique Title 9'),
('Author B', 'Unique Title 10');

ALTER TABLE test.articles ENABLE ROW LEVEL SECURITY;

CREATE USER {{user1}} WITH PASSWORD 'blah';

CREATE USER {{user2}} WITH PASSWORD 'blah';

CREATE POLICY "limit_user_1_update" ON test.articles AS PERMISSIVE FOR UPDATE TO {{user1}} USING ("author" = 'Author A') WITH CHECK ("author" = 'Author A');

CREATE POLICY "limit_user_2_delete" ON test.articles AS PERMISSIVE FOR DELETE TO {{user2}} USING ("author" = 'Author B');

COMMIT;
