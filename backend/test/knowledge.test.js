// The knowledge library across campaigns: one view of every source, attach to many, and a retrieval tester.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `knowledge-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-knowledge-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.EMBEDDINGS = "off";
delete process.env.DATABASE_URL;
const { initDb, getState } = await import("../src/db/index.js");
const k = await import("../src/services/knowledge.js");
await initDb();

const live = () => getState().campaigns.filter((c) => !c.sandbox && c.status !== "archived");

test("a source added once can be given to several campaigns, and the library shows who uses it", () => {
  const [a, b, c] = live();
  k.addKnowledge({ name: "Pricing sheet", category: "Pricing", content: "Starter costs 49 dollars a month. Team costs 199 dollars a month with unlimited seats.", campaignIds: [a.id, b.id] });
  const item = k.getKnowledgeLibrary().items.find((i) => i.name === "Pricing sheet");
  assert.equal(item.campaigns.length, 2);

  const from = item.campaigns[0];
  const r = k.attachKnowledge({ fromCampaignId: from.id, sourceId: from.sourceId, toCampaignIds: [a.id, b.id, c.id] });
  assert.equal(r.added, 1, "only the campaign that lacked it gets a copy");
  assert.equal(k.getKnowledgeLibrary().items.find((i) => i.name === "Pricing sheet").campaigns.length, 3);
});

test("taking a source out of one campaign leaves the others alone", () => {
  const item = k.getKnowledgeLibrary().items.find((i) => i.name === "Pricing sheet");
  k.detachKnowledge(item.campaigns[0].id, item.campaigns[0].sourceId);
  assert.equal(k.getKnowledgeLibrary().items.find((i) => i.name === "Pricing sheet").campaigns.length, 2);
});

test("invalid input is explained", () => {
  assert.throws(() => k.addKnowledge({ name: "x", content: "short", campaignIds: [] }), (e) => Boolean(e.fields.name && e.fields.content && e.fields.campaignIds));
  assert.throws(() => k.attachKnowledge({ fromCampaignId: "nope", sourceId: "x", toCampaignIds: ["y"] }), /not found/);
});

test("the retrieval tester returns the passages an agent would see, only from that campaign", async () => {
  const item = k.getKnowledgeLibrary().items.find((i) => i.name === "Pricing sheet");
  const withIt = item.campaigns[0].id;
  const r = await k.testRetrieval({ campaignId: withIt, query: "Team costs 199 dollars a month with unlimited seats", k: 5 });
  assert.ok(r.passages.length >= 1);
  assert.ok(r.passages.some((p) => /199|Team/.test(p.text)));
  await assert.rejects(() => k.testRetrieval({ campaignId: withIt, query: "  " }), /Type a question/);
  const without = live().find((c) => !item.campaigns.some((x) => x.id === c.id));
  const other = await k.testRetrieval({ campaignId: without.id, query: "How much does the team plan cost?" });
  assert.ok(!other.passages.some((p) => p.label === "Pricing sheet"), "another campaign's copy is not searched");
});
