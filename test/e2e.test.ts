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
