// Agent success rates by campaign and prompt version, and the campaign health verdict.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `perf-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-perf-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.EMBEDDINGS = "off";
delete process.env.DATABASE_URL;
const { initDb, getState } = await import("../src/db/index.js");
const { getPerformance } = await import("../src/services/performance.js");
const { newProspect } = await import("../src/services/prospects.js");
const { addNote } = await import("../src/services/dossier.js");
await initDb();

const live = () => getState().campaigns.filter((c) => c.status === "live" && !c.sandbox);
const campaign = (i = 0) => live()[i];

function prospect(c, { harness, replied, sentTouch = true }) {
  const p = newProspect(c, { name: `P${Math.random()}`, title: "Founder", company: "Co" }, { provider: "test", real: false });
  p.qual = { status: "Qualified", reasoning: "", agent: "ICP Fitment Agent", harness, ts: 1 };
  addNote(p, { agent: "Personalisation Agent", harness, engine: "gemini", note: "Drafted the opening." });
  if (sentTouch) p.touches.push({ n: 1, channel: "email", kind: "first", ts: 1 });
  if (replied) p.conversation.push({ dir: "in", text: "Sounds good", when: "Today" });
  getState().prospects.push(p);
  return p;
}

test("success is measured per prompt version so a prompt change can be compared with the one before it", () => {
  const c = campaign();
  for (let i = 0; i < 4; i++) prospect(c, { harness: "v1 + campaign prompt v1", replied: i === 0 });
  for (let i = 0; i < 4; i++) prospect(c, { harness: "v1 + campaign prompt v2", replied: i < 3 });
  const perf = getPerformance();
  const pers = perf.agents.find((a) => a.id === "personalisation");
  const rows = pers.rows.filter((r) => r.campaignId === c.id);
  const v1 = rows.find((r) => r.brief === "v1");
  const v2 = rows.find((r) => r.brief === "v2");
  assert.equal(v1.successRate, 25);
  assert.equal(v2.successRate, 75);
  assert.equal(v1.llmShare, 100);
  assert.match(pers.how, /prospects it wrote to/i);
});

test("a campaign whose messages are not landing is flagged with what to try", () => {
  const c = campaign(1);
  getState().prospects = getState().prospects.filter((p) => p.campaignId !== c.id);
  for (let i = 0; i < 8; i++) prospect(c, { harness: "v1 + campaign prompt v9", replied: false });
  const h = getPerformance().campaigns.find((x) => x.id === c.id);
  assert.equal(h.status, "struggling");
  assert.ok(h.reasons.some((r) => /replies from/.test(r)));
  assert.match(h.suggestion, /brief|offer/i);
});

test("sandbox and draft campaigns are not part of the analytics", () => {
  const perf = getPerformance();
  assert.ok(perf.campaigns.every((c) => !/Sandbox/.test(c.name)));
});
