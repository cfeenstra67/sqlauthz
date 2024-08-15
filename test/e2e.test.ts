import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import {
  dbClientGenerator,
  dbNameGenerator,
  dbUrl,
  setupEnv,
  userNameGenerator,
} from "./utils.js";

for (const tests of ["basic-1", "basic-3"]) {
  describe(tests, async () => {
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const db = dbNameGenerator();
    const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
    const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));

    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("basic", tests, db, { user1, user2 });
    });

    after(async () => {
      await teardown();
    });

    await it("user1: row-level security", async () => {
      await useClient1(async (client) => {
        const result = await client.query(
          "SELECT id, title FROM test.articles",
        );
        assert.equal(result.rowCount, 2);
      });
    });

    await it("user1: column security", async () => {
      await useClient1(async (client) => {
        await assert.rejects(client.query("SELECT * FROM test.articles"), {
          message: "permission denied for table articles",
        });

        await assert.rejects(
          client.query("SELECT content FROM test.articles"),
          {
            message: "permission denied for table articles",
          },
        );
      });
    });

    await it("user2: no access", async () => {
      await useClient2(async (client) => {
        await assert.rejects(client.query("SELECT 1 FROM test.articles"), {
          message: "permission denied for schema test",
        });
      });
    });
  });
}

describe("test-basic-2-no-table-access", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("basic", "basic-2", db, { user1, user2 });
  });

  after(async () => {
    await teardown();
  });

  await it("user: no table access", async () => {
    await useClient(async (client) => {
      await assert.rejects(client.query("SELECT 1 FROM test.articles"), {
        message: "permission denied for table articles",
      });
    });
  });
});

describe("test-basic-4-function-call", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("basic", "basic-4", db, { user1, user2 });
  });

  after(async () => {
    await teardown();
  });

  for (const author of ["Author A", "Author B", "Author C"]) {
    await it(`user1: RLS works with current author of ${author}`, async () => {
      await useClient(async (client) => {
        await client.query(`SET SESSION my.author TO '${author}'`);
        const result = await client.query<{ author: string }>(
          "SELECT author FROM test.articles",
        );
        assert.equal(result.rowCount, 4);
        for (const row of result.rows) {
          assert.equal(row.author, author);
        }
      });
    });
  }

  await it("user1: fails without author set", async () => {
    await useClient(async (client) => {
      await assert.rejects(client.query("SELECT author FROM test.articles"), {
        message: 'unrecognized configuration parameter "my.author"',
      });
    });
  });
});

describe("test-basic-5-function-call", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("basic", "basic-5", db, { user1, user2 });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: can access one row", async () => {
    await useClient(async (client) => {
      const result = await client.query<{ author: string }>(
        "SELECT * FROM test.articles",
      );
      assert.equal(result.rowCount, 1);
    });
  });
});

describe("test-basic-6-function-call", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("basic", "basic-6", db, { user1, user2 });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: can access one row", async () => {
    await useClient(async (client) => {
      const result = await client.query<{ author: string }>(
        "SELECT * FROM test.articles",
      );
      assert.equal(result.rowCount, 1);
    });
  });
});

describe("test-basic-7-type-field", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("basic", "basic-7", db, { user1, user2 });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: can access test.articles", async () => {
    await useClient(async (client) => {
      const result = await client.query<{ author: string }>(
        "SELECT * FROM test.articles",
      );
      assert.equal(result.rowCount, 12);
    });
  });
});

describe("test-basic-8", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("basic", "basic-8", db, { user1, user2 });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: should not be able to select title or author columns", async () => {
    await useClient(async (client) => {
      for (const col of ["author", "title"]) {
        await assert.rejects(client.query(`SELECT ${col} FROM test.articles`), {
          message: "permission denied for table articles",
        });
      }
    });
  });

  await it("user1: should be able to select other columns", async () => {
    await useClient(async (client) => {
      for (const col of ["id", "content", "created_at", "updated_at"]) {
        const result = await client.query(`SELECT ${col} FROM test.articles`);
        assert.equal(result.rowCount, 12);
      }
    });
  });
});

describe("test-multi-table-1-full-access", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
  const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv(
      "multi-table",
      "multi-table-1",
      db,
      {
        user1,
        user2,
      },
      { allowAnyActor: true },
    );
  });

  after(async () => {
    await teardown();
  });

  for (const [name, useClient] of [
    ["user1", useClient1],
    ["user2", useClient2],
  ] as const) {
    for (const schema of ["test", "test2"]) {
      for (const table of ["articles", "articles2"]) {
        await it(`${name}: can access ${schema}.${table}`, async () => {
          await useClient(async (client) => {
            const result = await client.query<{ ct: number }>(
              `SELECT COUNT(1) as ct FROM ${schema}.${table}`,
            );
            assert.equal(result.rowCount, 1);
            assert.equal(result.rows[0]!.ct, 12);
            const col = table.endsWith("2") ? "author2" : "author";
            await assert.doesNotReject(
              client.query(`UPDATE ${schema}.${table} SET ${col} = 'ABC'`),
            );
          });
        });
      }
    }
  }
});

describe("test-multi-table-1-fails-without-any-user", async () => {
  await it("fails without allowAnyUser", async () => {
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const db = dbNameGenerator();

    await assert.rejects(
      setupEnv("multi-table", "multi-table-1", db, {
        user1,
        user2,
      }),
      {
        message: `Parse error: ${JSON.stringify(
          ["rule does not specify a user"],
          null,
          2,
        )}`,
      },
    );
  });
});

describe("test-multi-table-2-selective-access", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
  const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("multi-table", "multi-table-2", db, {
      user1,
      user2,
    });
  });

  after(async () => {
    await teardown();
  });

  for (const table of ["articles", "articles2"]) {
    await it(`user1: can access test.${table}`, async () => {
      await useClient1(async (client) => {
        const result = await client.query<{ ct: number }>(
          `SELECT COUNT(1) as ct FROM test.${table}`,
        );
        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0]!.ct, 12);
      });
    });

    await it(`user2: can't access test.${table}`, async () => {
      await useClient2(async (client) => {
        await assert.rejects(
          client.query<{ ct: number }>(
            `SELECT COUNT(1) as ct FROM test.${table}`,
          ),
          {
            message: "permission denied for schema test",
          },
        );
      });
    });

    for (const [name, useClient] of [
      ["user1", useClient1],
      ["user2", useClient2],
    ] as const) {
      await it(`${name}: can't access test2.${table}`, async () => {
        await useClient(async (client) => {
          await assert.rejects(
            client.query(`SELECT COUNT(1) as ct FROM test2.${table}`),
            {
              message: "permission denied for schema test2",
            },
          );
        });
      });
    }
  }
});

describe("test-multi-table-3-read-only", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
  const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv(
      "multi-table",
      "multi-table-3",
      db,
      {
        user1,
        user2,
      },
      { allowAnyActor: true },
    );
  });

  after(async () => {
    await teardown();
  });

  for (const [name, useClient] of [
    ["user1", useClient1],
    ["user2", useClient2],
  ] as const) {
    for (const schema of ["test", "test2"]) {
      for (const table of ["articles", "articles2"]) {
        await it(`${name}: can access ${schema}.${table}`, async () => {
          await useClient(async (client) => {
            const result = await client.query<{ ct: number }>(
              `SELECT COUNT(1) as ct FROM ${schema}.${table}`,
            );
            assert.equal(result.rowCount, 1);
            assert.equal(result.rows[0]!.ct, 12);
            const col = table.endsWith("2") ? "author2" : "author";
            await assert.rejects(
              client.query(`UPDATE ${schema}.${table} SET ${col} = 'ABC'`),
              {
                message: `permission denied for table ${table}`,
              },
            );
          });
        });
      }
    }
  }
});

describe("test-multi-table-3-fails-without-any-user", async () => {
  await it("fails without allowAnyUser", async () => {
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const db = dbNameGenerator();
    await assert.rejects(
      setupEnv("multi-table", "multi-table-3", db, {
        user1,
        user2,
      }),
      {
        message: `Parse error: ${JSON.stringify(
          ["rule does not specify a user"],
          null,
          2,
        )}`,
      },
    );
  });
});

describe("test-multi-table-4", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
  const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("multi-table", "multi-table-4", db, {
      user1,
      user2,
    });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: can access test.articles", async () => {
    await useClient1(async (client) => {
      const result = await client.query<{ ct: number }>(
        "SELECT COUNT(1) as ct FROM test.articles",
      );
      assert.equal(result.rowCount, 1);
      assert.equal(result.rows[0]!.ct, 1);
    });
  });

  for (const [user, useClient, schema, table] of [
    ["user1", useClient1, "test", "articles2"],
    ["user1", useClient1, "test2", "articles"],
    ["user1", useClient1, "test2", "articles2"],
    ["user2", useClient2, "test", "articles"],
    ["user2", useClient2, "test", "articles2"],
    ["user2", useClient2, "test2", "articles"],
    ["user2", useClient2, "test2", "articles2"],
  ] as const) {
    await it(`${user}: cannot access ${schema}.${table}`, async () => {
      await useClient(async (client) => {
        await assert.rejects(
          client.query(`SELECT COUNT(1) as ct FROM ${schema}.${table}`),
          {
            message: `permission denied for table ${table}`,
          },
        );
      });
    });
  }
});

describe("test-group-1", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const user3 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
  const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("group", "group-1", db, {
      user1,
      user2,
      user3,
    });
  });

  after(async () => {
    await teardown();
  });

  for (const [user, useClient] of [
    ["user1", useClient1],
    ["user2", useClient2],
  ] as const) {
    await it(`${user}: can access test.articles`, async () => {
      await useClient(async (client) => {
        const result = await client.query("SELECT * FROM test.articles");
        assert.equal(result.rowCount, 12);
      });
    });
  }
});

for (const rules of ["view-1", "view-2"]) {
  describe(`test-${rules}`, async () => {
    const user1 = userNameGenerator();
    const db = dbNameGenerator();
    const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("view", rules, db, {
        user1,
      });
    });

    after(async () => {
      await teardown();
    });

    await it("user1: should be able to access test.author_a_articles", async () => {
      await useClient(async (client) => {
        const result = await client.query(
          "SELECT * FROM test.author_a_articles",
        );
        assert.equal(result.rowCount, 4);
      });
    });

    await it("user1: should not be able to access test.articles", async () => {
      await useClient(async (client) => {
        await assert.rejects(client.query("SELECT * FROM test.articles"), {
          message: "permission denied for table articles",
        });
      });
    });
  });
}

for (const rules of ["view-3", "view-4"]) {
  describe(`test-${rules}`, async () => {
    const user1 = userNameGenerator();
    const db = dbNameGenerator();
    const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("view", rules, db, {
        user1,
      });
    });

    after(async () => {
      await teardown();
    });

    await it("user1: should be able to access test.articles", async () => {
      await useClient(async (client) => {
        const result = await client.query("SELECT * FROM test.articles");
        assert.equal(result.rowCount, 12);
      });
    });

    await it("user1: should not be able to access test.author_a_articles", async () => {
      await useClient(async (client) => {
        await assert.rejects(
          client.query("SELECT * FROM test.author_a_articles"),
          {
            message: "permission denied for view author_a_articles",
          },
        );
      });
    });
  });
}

for (const rules of [
  "functions-and-procedures-1",
  "functions-and-procedures-2",
]) {
  describe(`test-${rules}`, async () => {
    const user1 = userNameGenerator();
    const db = dbNameGenerator();
    const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("functions-and-procedures", rules, db, {
        user1,
      });
    });

    after(async () => {
      await teardown();
    });

    await it("user1: can access test.test_func", async () => {
      await useClient(async (client) => {
        const result = await client.query<{ r: number }>(
          "SELECT test.test_func() as r",
        );
        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0]?.r, 1);
      });
    });

    await it("user1: cannot access test.insert_articles", async () => {
      await useClient(async (client) => {
        await assert.rejects(
          client.query("CALL test.insert_article('Test');"),
          {
            message: "permission denied for procedure insert_article",
          },
        );
      });
    });
  });
}

for (const rules of [
  "functions-and-procedures-3",
  "functions-and-procedures-4",
]) {
  describe(`test-${rules}`, async () => {
    const user1 = userNameGenerator();
    const db = dbNameGenerator();
    const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("functions-and-procedures", rules, db, {
        user1,
      });
    });

    after(async () => {
      await teardown();
    });

    await it("user1: cannot access test.test_func", async () => {
      await useClient(async (client) => {
        await assert.rejects(client.query("SELECT test.test_func()"), {
          message: "permission denied for function test_func",
        });
      });
    });

    await it("user1: can access test.insert_articles", async () => {
      await useClient(async (client) => {
        const result = await client.query("CALL test.insert_article('Test')");
        assert.equal(result.rowCount, null);
      });
    });
  });
}

for (const rules of ["sequence-1", "sequence-2"]) {
  describe(`test-${rules}`, async () => {
    const user1 = userNameGenerator();
    const db = dbNameGenerator();
    const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("sequence", rules, db, {
        user1,
      });
    });

    after(async () => {
      await teardown();
    });

    for (const [seq, num] of [
      ["test.seq1", 99],
      ["test.seq2", 72],
    ] as const) {
      await it(`user1: can access ${seq}`, async () => {
        await useClient(async (client) => {
          const result = await client.query<{ val: string }>(
            `SELECT nextval('${seq}') as val`,
          );
          assert.equal(result.rowCount, 1);
          assert.equal(result.rows[0]?.val, num);
        });
      });
    }
  });
}

for (const rules of ["sequence-3", "sequence-4"]) {
  describe(`test-${rules}`, async () => {
    const user1 = userNameGenerator();
    const db = dbNameGenerator();
    const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("sequence", rules, db, {
        user1,
      });
    });

    after(async () => {
      await teardown();
    });

    await it("user1: can access test.seq1", async () => {
      await useClient(async (client) => {
        const result = await client.query<{ val: string }>(
          `SELECT nextval('test.seq1') as val`,
        );
        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0]?.val, 99);
      });
    });

    await it("user1: cannot access test.seq2", async () => {
      await useClient(async (client) => {
        await assert.rejects(client.query("SELECT nextval('test.seq2')"), {
          message: "permission denied for sequence seq2",
        });
      });
    });
  });
}

describe("test-complete-1", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const user3 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
  const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));
  const useClient3 = dbClientGenerator(dbUrl(user3, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("complete", "complete-1", db, {
      user1,
      user2,
      user3,
    });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: should be able to access the sensitive schema", async () => {
    await useClient1(async (client) => {
      const result = await client.query("SELECT * FROM sensitive.internal");
      assert.equal(result.rowCount, 0);
    });
  });

  await it("user1: should not be able to truncate sensitive.internal", async () => {
    await useClient1(async (client) => {
      await assert.rejects(client.query("TRUNCATE TABLE sensitive.internal"), {
        message: "permission denied for table internal",
      });
    });
  });

  for (const [user, useClient] of [
    ["user2", useClient2],
    ["user3", useClient3],
  ] as const) {
    await it(`${user}: should not be able to access the sensitive schema`, async () => {
      await useClient(async (client) => {
        await assert.rejects(client.query("SELECT * FROM sensitive.internal"), {
          message: "permission denied for schema sensitive",
        });
      });
    });
  }

  for (const [user, useClient] of [
    ["user1", useClient1],
    ["user2", useClient2],
  ] as const) {
    await it(`${user}: should be able to read from app.articles`, async () => {
      await useClient(async (client) => {
        const result = await client.query("SELECT * FROM app.articles");
        assert.equal(result.rowCount, 12);
      });
    });

    await it(`${user}: should be able to read from app.articles_view`, async () => {
      await useClient(async (client) => {
        const result = await client.query("SELECT * FROM app.articles_view");
        assert.equal(result.rowCount, 12);
      });
    });
  }

  await it("user3: should not be able to read from app.articles", async () => {
    await useClient3(async (client) => {
      await assert.rejects(client.query("SELECT * FROM app.articles"), {
        message: "permission denied for table articles",
      });
    });
  });

  await it("user3: should not be able to read from app.articles_view", async () => {
    await useClient3(async (client) => {
      await assert.rejects(client.query("SELECT * FROM app.articles_view"), {
        message: "permission denied for view articles_view",
      });
    });
  });

  for (const [user, useClient] of [
    ["user1", useClient1],
    ["user2", useClient2],
  ] as const) {
    await it(`${user}: should be able to read from app.users`, async () => {
      await useClient(async (client) => {
        const result = await client.query("SELECT * FROM app.users");
        assert.equal(result.rowCount, 2);
      });
    });
  }

  await it("user3: should not be able to read from app.users without user.org_id set", async () => {
    await useClient3(async (client) => {
      await assert.rejects(client.query("SELECT id FROM app.users"), {
        message: 'unrecognized configuration parameter "user.org_id"',
      });
    });
  });

  await it("user3: should not be able to read internal_notes from app.users", async () => {
    await useClient3(async (client) => {
      await client.query("SET SESSION \"user.org_id\" TO '12'");
      await assert.rejects(
        client.query("SELECT internal_notes FROM app.users"),
        {
          message: "permission denied for table users",
        },
      );
    });
  });

  await it("user3: should be able to read from app.users with user.org_id set", async () => {
    await useClient3(async (client) => {
      await client.query("SET SESSION \"user.org_id\" TO '12'");
      const result = await client.query("SELECT id FROM app.users");
      assert.equal(result.rowCount, 1);
    });
  });

  await it("user1: should be able to insert into app.users", async () => {
    await useClient1(async (client) => {
      const result = await client.query(
        "INSERT INTO app.users (name, org_id, internal_notes) VALUES ('cam', '42', 'Notes')",
      );
      assert.equal(result.rowCount, 1);
    });
  });

  await it("user2: should not be able to insert into app.users", async () => {
    await useClient2(async (client) => {
      await assert.rejects(
        client.query(
          "INSERT INTO app.users (name, org_id, internal_notes) VALUES ('cam', '42', 'Notes')",
        ),
        {
          message: "permission denied for table users",
        },
      );
    });
  });

  await it("user3: should not be able to insert into app.users without user.org_id set", async () => {
    await useClient3(async (client) => {
      await assert.rejects(
        client.query(
          "INSERT INTO app.users (name, org_id) VALUES ('cam', '42')",
        ),
        {
          message: 'unrecognized configuration parameter "user.org_id"',
        },
      );
    });
  });

  await it("user3: should be able to insert into app.users with user.org_id set", async () => {
    await useClient3(async (client) => {
      await client.query("SET \"user.org_id\" TO '32'");
      const result = await client.query(
        "INSERT INTO app.users (name, org_id) VALUES ('cam', '32');",
      );
      assert.equal(result.rowCount, 1);
    });
  });

  await it("user3: should not be able to insert into app.users with user.org_id set to a different value than org_id", async () => {
    await useClient3(async (client) => {
      await client.query("SET \"user.org_id\" TO '32'");
      await assert.rejects(
        client.query(
          "INSERT INTO app.users (name, org_id) VALUES ('cam', '42');",
        ),
        {
          message: `new row violates row-level security policy "insert_${user3}" for table "users"`,
        },
      );
    });
  });

  await it("user3: should not be able to insert into the internal_notes column", async () => {
    await useClient3(async (client) => {
      await client.query("SET \"user.org_id\" TO '32'");
      await assert.rejects(
        client.query(
          "INSERT INTO app.users (name, org_id, internal_notes) VALUES ('cam', '42', 'Notes');",
        ),
        {
          message: "permission denied for table users",
        },
      );
    });
  });
});

describe("test-cast-1", async () => {
  const user1 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("cast", "cast-1", db, {
      user1,
    });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: should not be able to select from app.users without user.org_id set", async () => {
    await useClient(async (client) => {
      await assert.rejects(client.query("SELECT * FROM app.users"), {
        message: 'unrecognized configuration parameter "user.org_id"',
      });
    });
  });

  await it("user1: should be able to select from app.users with user.org_id set", async () => {
    await useClient(async (client) => {
      await client.query("SET \"user.org_id\" TO '12'");
      const result = await client.query("SELECT * FROM app.users");
      assert.equal(result.rowCount, 1);
    });
  });
});

describe("test-func-condition-1", async () => {
  const user1 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient = dbClientGenerator(dbUrl(user1, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("func-condition", "func-condition-1", db, {
      user1,
    });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: should be able to access 1 row", async () => {
    await useClient(async (client) => {
      const result = await client.query("SELECT * FROM test.articles");
      assert.equal(result.rowCount, 1);
    });
  });
});

describe("actor strictness", async () => {
  await it("should fail with an empty clause and allowAnyActor=false", async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const errors = ["rule does not specify a user"];

    await assert.rejects(
      setupEnv("basic", "basic-all-actors-1", db, {
        user1,
        user2,
      }),
      {
        message: `Parse error: ${JSON.stringify(errors, null, 2)}`,
      },
    );
  });

  await it("should succeed with an empty clause and allowAnyActor=true", async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();

    const teardown = await setupEnv(
      "basic",
      "basic-all-actors-1",
      db,
      {
        user1,
        user2,
      },
      { allowAnyActor: true },
    );

    await teardown();
  });

  for (const rules of [
    "basic-non-existant-actor-1",
    "basic-non-existant-actor-2",
  ]) {
    await it(`${rules}: should fail if a non-existant actor is referenced`, async () => {
      const db = dbNameGenerator();
      const user1 = userNameGenerator();
      const user2 = userNameGenerator();
      const errors = ["Invalid user or group name: does_not_exist"];

      await assert.rejects(
        setupEnv("basic", rules, db, {
          user1,
          user2,
        }),
        {
          message: `Parse error: ${JSON.stringify(errors, null, 2)}`,
        },
      );
    });
  }

  await it(`should fail if including a user that doesn't exist in userRevokePolicy`, async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const errors = [
      "Invalid user or group in user revoke policy: does_not_exist",
    ];

    await assert.rejects(
      setupEnv(
        "basic",
        "basic-1",
        db,
        {
          user1,
          user2,
        },
        {
          userRevokePolicy: {
            type: "users",
            users: [user1, user2, "does_not_exist"],
          },
        },
      ),
      {
        message: `Parse error: ${JSON.stringify(errors, null, 2)}`,
      },
    );
  });

  await it("should fail if attempting to grant permissions outside of the userRevokePolicy", async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const user3 = userNameGenerator();
    const errors = [
      `Permission granted to user outside of revoke policy: ${user1}`,
      `Permission granted to user outside of revoke policy: ${user2}`,
      `Permission granted to group outside of revoke policy: ${user3}`,
    ];

    await assert.rejects(
      setupEnv(
        "group",
        "basic-all-actors-1",
        db,
        {
          user1,
          user2,
          user3,
        },
        {
          allowAnyActor: true,
          userRevokePolicy: {
            type: "users",
            users: [],
          },
        },
      ),
      {
        message: `Parse error: ${JSON.stringify(errors, null, 2)}`,
      },
    );
  });
});

describe("privilege strictness", async () => {
  await it("should fail when referencing an invalid privilege", async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const errors = ["Invalid privilege name: 'does_not_exist'"];

    await assert.rejects(
      setupEnv("basic", "basic-invalid-privilege-1", db, {
        user1,
        user2,
      }),
      {
        message: `Parse error: ${JSON.stringify(errors, null, 2)}`,
      },
    );
  });
});

describe("object type strictness", async () => {
  await it("basic-invalid-object-type-1: should fail when referencing an invalid object type", async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const errors = ["Invalid object type: 'does_not_exist'"];

    await assert.rejects(
      setupEnv("basic", "basic-invalid-object-type-1", db, {
        user1,
        user2,
      }),
      {
        message: `Parse error: ${JSON.stringify(errors, null, 2)}`,
      },
    );
  });

  await it("basic-invalid-object-type-2: should fail when referencing an invalid object type", async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const errors = ["Invalid object type: '1'"];

    await assert.rejects(
      setupEnv("basic", "basic-invalid-object-type-2", db, {
        user1,
        user2,
      }),
      {
        message: `Parse error: ${JSON.stringify(errors, null, 2)}`,
      },
    );
  });
});

describe("long table names", async () => {
  await it("should work with long table names and multiple users", async () => {
    const db = dbNameGenerator();
    const user1 = userNameGenerator();
    const user2 = userNameGenerator();
    const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
    const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));
    
    let teardown: () => Promise<void> = async () => {};

    before(async () => {
      teardown = await setupEnv("long-table-name", "long-table-name", db, {
        user1,
        user2
      });
    });

    after(async () => {
      await teardown();
    });

    for (const [user, useClient] of [
      ["user1", useClient1],
      ["user2", useClient2],
    ] as const) {
      await it(`${user}: can access test.articles_but_with_an_extremely_long_table_name`, async () => {
        await useClient(async (client) => {
          const result = await client.query("SELECT * FROM test.articles_but_with_an_extremely_long_table_name");
          assert.equal(result.rowCount, 4);
        });
      });
    }
  })
})
  

  