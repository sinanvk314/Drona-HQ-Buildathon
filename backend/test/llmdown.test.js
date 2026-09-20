// When the model is down (quota, key, network) a campaign must not invent people or reject people the rules cannot judge.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `llmdown-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-llmdown-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.EMBEDDINGS = "off";
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const dev = await import("../src/services/dev.js");
const { tickCampaign } = await import("../src/services/scheduler.js");
const { newProspect } = await import("../src/services/prospects.js");
const { getUsage } = await import("../src/services/usage.js");
await initDb();
config.enforceLimits = false;
config.simReplyChance = 0;

let server;
before(async () => {
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => { res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "You exceeded your current quota" } })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  config.gemini.baseUrl = `http://127.0.0.1:${server.address().port}/v1beta`;
  config.gemini.apiKey = "test-key";
  config.gemini.rpm = 600000;
  config.gemini.model = "only-model";
  config.gemini.retries = 0;
});
after(() => server.close());

const campaign = (name) => {
  const { id } = data.createCampaign(
    { name, description: "d", owner: "t", objective: "Book a call", offer: "A workshop.", icpText: "Engineering leaders at software companies", geography: ["India"], personas: ["CTO"], companyCriteria: "B2B software company", channels: ["email"], sourcing: "simulated-search", qualificationPrompt: "Qualify engineering leaders. Score 75 or above qualifies.", dailyLimit: 50, workingHours: "9:00 AM - 6:00 PM", approvals: { firstOutreach: true, level: "manual" }, sources: [] },
    { launch: true }
  );
  data.setCampaignReps(id, ["r_jd"]);
  return getState().campaigns.find((c) => c.id === id);
};

test("the reason a model call failed is remembered and shown", async () => {
  config.agentEngine = "gemini";
  await assert.rejects(() => dev.testGemini(), /quota/i);
  assert.match(getUsage().lastError.message, /quota/i);
  config.agentEngine = "rule";
});

test("with the model down, the AI search adds nobody instead of inventing people from name lists", async () => {
  config.agentEngine = "gemini";
  const c = campaign("Model down search");
  await tickCampaign(c);
  assert.equal(getState().prospects.filter((p) => p.campaignId === c.id).length, 0, "no invented prospects");
  assert.ok(c.failures && c.failures.total >= 1, "the failure is visible on the campaign");
  config.agentEngine = "rule";
});

test("with no model configured at all, the free generator still keeps a campaign moving", async () => {
  config.agentEngine = "rule";
  const c = campaign("No model at all");
  await tickCampaign(c);
  assert.ok(getState().prospects.filter((p) => p.campaignId === c.id).length >= 1);
});

test("with the model down, a prospect the rules cannot judge waits instead of being rejected, and is retried later", async () => {
  config.agentEngine = "gemini";
  const c = campaign("Model down icp");
  const p = newProspect(c, { name: "Some Person", title: "CTO", company: "Someco", size: "" }, { provider: "test", real: false });
  p.stage = "researched";
  getState().prospects.push(p);
  await tickCampaign(c);
  assert.equal(p.stage, "researched", "not rejected");
  assert.equal(p.fit, null);
  assert.ok(p.icpRetryAt > Date.now(), "tried again later");
  assert.match(p.nextStep, /Waiting for the AI/);
  config.agentEngine = "rule";
});
