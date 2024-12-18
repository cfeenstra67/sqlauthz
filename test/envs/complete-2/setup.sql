BEGIN;

CREATE SCHEMA app;

CREATE TABLE app.articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app.articles (title, content, author, created_at, updated_at) VALUES
('Article 1', 'Content for article 1', 'Author A', '2023-01-01 10:00:00', '2023-01-01 10:00:00'),
('Article 2', 'Content for article 2', 'Author B', '2023-01-02 10:00:00', '2023-01-02 11:00:00'),
('Article 3', 'Content for article 3', 'Author C', '2023-01-03 10:00:00', '2023-01-03 12:00:00'),
('Article 4', 'Content for article 4', 'Author A', '2023-01-04 10:00:00', '2023-01-04 13:00:00'),
('Article 5', 'Content for article 5', 'Author B', '2023-01-05 10:00:00', '2023-01-05 14:00:00'),
('Article 6', 'Content for article 6', 'Author C', '2023-01-06 10:00:00', '2023-01-06 15:00:00'),
('Article 7', 'Content for article 7', 'Author A', '2023-01-07 10:00:00', '2023-01-07 16:00:00'),
('Article 8', 'Content for article 8', 'Author B', '2023-01-08 10:00:00', '2023-01-08 17:00:00'),
('Article 9', 'Content for article 9', 'Author C', '2023-01-09 10:00:00', '2023-01-09 18:00:00'),
('Article 10', 'Content for article 10', 'Author A', '2023-01-10 10:00:00', '2023-01-10 19:00:00'),
('Article 11', 'Content for article 11', 'Author B', '2023-01-11 10:00:00', '2023-01-11 20:00:00'),
('Article 12', 'Content for article 12', 'Author C', '2023-01-12 10:00:00', '2023-01-12 21:00:00');

ALTER TABLE app.articles ENABLE ROW LEVEL SECURITY;

CREATE TABLE app.users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    org_id VARCHAR(100),
    internal_notes VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app.users (name, org_id, internal_notes) VALUES
('User 1', '12', 'Notes here'),
('User 2', '32', 'Notes here');

CREATE VIEW app.articles_view AS (
    SELECT * FROM app.articles
);

CREATE SCHEMA sensitive;

CREATE TABLE sensitive.internal (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100)
);

CREATE USER {{user1}} WITH PASSWORD 'blah';

CREATE USER {{user2}} WITH PASSWORD 'blah';

CREATE USER {{user3}} WITH PASSWORD 'blah';

COMMIT;
