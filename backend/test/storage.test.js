// The Postgres snapshot store, run against an in-memory fake of the one table it uses. This proves the
// logic (create table, save, load, coalesced writes, backup on schema change, never touching other tables);
// it does not prove the connection to a real Neon database.
import test from "node:test";
import assert from "node:assert/strict";
import { setPoolForTests } from "../src/db/pg.js";
import { loadStateFromPg, saveStateToPg } from "../src/db/postgresAdapter.js";
import { SCHEMA_VERSION } from "../src/db/seed.js";

function fakePool() {
  const rows = new Map();
  const log = [];
  return {
    rows,
    log,
    async query(sql, params = []) {
      log.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (/^\s*CREATE TABLE IF NOT EXISTS sdr_app_state/i.test(sql)) return { rows: [] };
      if (/^\s*SELECT state FROM sdr_app_state/i.test(sql)) {
        return { rows: rows.has(params[0]) ? [{ state: JSON.parse(rows.get(params[0])) }] : [] };
      }
      if (/^\s*INSERT INTO sdr_app_state/i.test(sql)) {
        if (/ON CONFLICT/i.test(sql) || !rows.has(params[0])) rows.set(params[0], params[1]);
        else throw new Error("duplicate key");
        return { rows: [] };
      }
      throw new Error(`the storage layer ran an unexpected statement: ${sql}`);
    },
  };
}

test("saves the whole state, including newer fields, and loads it back", async () => {
  const pool = fakePool();
  setPoolForTests(pool);
  assert.equal(await loadStateFromPg(), null); // empty database: the app seeds itself

  const state = {
    version: SCHEMA_VERSION,
    campaigns: [{ id: "c1", approvals: { level: "assisted", autoMinScore: 90 }, sources: [{ id: "s1", name: "FAQ", content: "typed text" }] }],
  };
  await saveStateToPg(state);
  const loaded = await loadStateFromPg();
  assert.equal(loaded.campaigns[0].approvals.level, "assisted");
  assert.equal(loaded.campaigns[0].sources[0].content, "typed text");
});

test("a burst of saves is coalesced and the last change wins", async () => {
  const pool = fakePool();
  setPoolForTests(pool);
  const state = { version: SCHEMA_VERSION, n: 0 };
  const writes = [];
  for (let i = 1; i <= 10; i++) {
    state.n = i; // the app mutates one object in place
    writes.push(saveStateToPg(state));
  }
  await Promise.all(writes);
  assert.equal((await loadStateFromPg()).n, 10);
  const inserts = pool.log.filter((l) => l.startsWith("INSERT INTO")).length;
  assert.ok(inserts <= 3, `expected the burst to collapse into a few writes, saw ${inserts}`);
});

test("state from an older schema is backed up, not overwritten", async () => {
  const pool = fakePool();
  setPoolForTests(pool);
  pool.rows.set("current", JSON.stringify({ version: SCHEMA_VERSION - 1, campaigns: [{ id: "mine" }] }));

  assert.equal(await loadStateFromPg(), null); // caller reseeds
  const backups = [...pool.rows.keys()].filter((k) => k.startsWith("backup-"));
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(pool.rows.get(backups[0])).campaigns[0].id, "mine");
});
