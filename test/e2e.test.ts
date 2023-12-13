import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import {
  dbClientGenerator,
  dbNameGenerator,
  dbUrl,
  setupEnv,
  userNameGenerator,
} from "./utils.js";

describe("basic-test-1", async () => {
  const user1 = userNameGenerator();
  const user2 = userNameGenerator();
  const db = dbNameGenerator();
  const useClient1 = dbClientGenerator(dbUrl(user1, "blah", db));
  const useClient2 = dbClientGenerator(dbUrl(user2, "blah", db));

  let teardown: () => Promise<void> = async () => {};

  before(async () => {
    teardown = await setupEnv("basic", "basic-1", db, { user1, user2 });
  });

  after(async () => {
    await teardown();
  });

  await it("user1: row-level security", async () => {
    await useClient1(async (client) => {
      const result = await client.query("SELECT id, title FROM test.articles");
      assert.equal(result.rowCount, 2);
    });
  });

  await it("user1: column security", async () => {
    await useClient1(async (client) => {
      await assert.rejects(client.query("SELECT * FROM test.articles"), {
        message: "permission denied for table articles",
      });

      await assert.rejects(client.query("SELECT content FROM test.articles"), {
        message: "permission denied for table articles",
      });
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

describe("test-no-table-access", async () => {
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
