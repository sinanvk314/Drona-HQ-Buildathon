// The draft grounding check, and what the agent layer does when a draft fails it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "os";
import path from "path";

process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-grounding-${process.pid}.json`);
process.env.EMBEDDINGS = "off";
const { config } = await import("../src/config.js");
const { buildSeed } = await import("../src/db/seed.js");
const { checkGrounding } = await import("../src/services/grounding.js");
const engine = await import("../src/services/agentEngine/index.js");

const knowledge = [
  { label: "Case study", text: "Fleetwise cut cloud spend 23% in 60 days. Pricing starts at $0.02/GB monitored." },
  { label: "Product", text: "NimbusGuard is SOC 2 Type II certified and reads usage through read-only APIs." },
];
const prospect = { name: "Dana Priest", title: "CTO", company: "Fleetwise", industry: "SaaS", size: "240 employees", funding: "Series C, $65M raised", tech: ["AWS"], history: [{ text: "Research: hiring a Cloud FinOps Engineer" }] };
const check = (text, extra = {}) => checkGrounding({ text, knowledge, prospect, campaign: {}, ...extra });

test("figures and claims that the knowledge supports pass", () => {
  const r = check("Hi Dana, a team like Fleetwise cut cloud spend 23% in 60 days, and we are SOC 2 Type II certified.");
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
});

test("a figure that is nowhere in the knowledge or the prospect's data is flagged", () => {
  const r = check("We typically cut spend 40% within 30 days.");
  assert.deepEqual(r.issues.map((i) => i.type).sort(), ["figure", "figure"]);
  assert.ok(r.issues.some((i) => i.text === "40%"));
});

test("a figure from the prospect's own data is allowed", () => {
  assert.equal(check("Congrats on the $65M round.").issues.some((i) => i.type === "figure"), false);
});

test("a certification the knowledge does not make is flagged, one it does make is not", () => {
  assert.ok(check("We are ISO 27001 certified.").issues.some((i) => i.type === "claim" && /ISO/i.test(i.text)));
  assert.ok(check("We guarantee results.").issues.some((i) => i.type === "claim"));
  assert.equal(check("We are SOC 2 Type II certified.").issues.length, 0);
});

test("a quoted price is always flagged, even when it is in the knowledge", () => {
  const r = check("It costs $0.02/GB.");
  assert.ok(r.issues.some((i) => i.type === "pricing"));
});

test("a specific meeting time is flagged unless the message is confirming a meeting", () => {
  assert.ok(check("Are you free Thursday at 3pm?").issues.some((i) => i.type === "meeting-time"));
  assert.equal(check("Confirming Thursday at 3pm.", { confirmsMeeting: true }).issues.some((i) => i.type === "meeting-time"), false);
});

test("a repeated unsupported claim is one issue", () => {
  assert.equal(check("40% savings, really 40% savings.").issues.length, 1);
});

// ---- the agent layer ----------------------------------------------------------------------------
let server, replies, requests;
before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      const next = replies.shift() || replies[replies.length - 1];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(next) }] }, finishReason: "STOP" }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  config.gemini.baseUrl = `http://127.0.0.1:${server.address().port}/v1beta`;
  config.gemini.apiKey = "test-key";
  config.gemini.rpm = 600000;
  config.gemini.model = "test-model";
  config.gemini.retries = 0;
});
after(() => server.close());

const seed = buildSeed(Date.now());
const agent = (id) => seed.agents.find((a) => a.id === id);
const saas = seed.campaigns.find((c) => c.id === "c_us_saas");
const p = seed.prospects.find((x) => x.campaignId === "c_us_saas");

test("a draft that fails the check gets one rewrite, with the problems named, and the clean rewrite is used", async () => {
  config.agentEngine = "gemini";
  requests = [];
  replies = [
    { channel: "email", subject: "Save 90%", body: "Hi, we are ISO 27001 certified and cut spend 90%.", reasoning: "r" },
    { channel: "email", subject: "Cloud spend", body: "Hi, would a short look at your cloud spend be useful?", reasoning: "r" },
  ];
  const r = await engine.draftOutreach({ campaign: saas, prospect: p, personalisationAgent: agent("personalisation"), channel: "email" });
  assert.equal(requests.length, 2, "exactly one rewrite");
  assert.match(requests[1].contents[0].parts[0].text, /rejected for unsupported claims/);
  assert.equal(r.regenerated, true);
  assert.equal(r.grounding.ok, true);
  assert.match(r.body, /short look/);
});

test("if the rewrite is no better, the result still reports the failed check", async () => {
  config.agentEngine = "gemini";
  requests = [];
  const bad = { channel: "email", subject: "Save 90%", body: "We cut spend 90% and are HIPAA certified.", reasoning: "r" };
  replies = [bad, bad]; // the rewrite makes the same claims
  const r = await engine.draftOutreach({ campaign: saas, prospect: p, personalisationAgent: agent("personalisation"), channel: "email" });
  assert.equal(requests.length, 2);
  assert.equal(r.grounding.ok, false);
  assert.ok(r.grounding.issues.length > 0);
});

test("the rule engine's own drafts are grounded for every seeded campaign", async () => {
  config.agentEngine = "rule";
  for (const campaign of seed.campaigns) {
    const prospectOf = seed.prospects.find((x) => x.campaignId === campaign.id);
    const r = await engine.draftOutreach({ campaign, prospect: prospectOf, personalisationAgent: agent("personalisation"), channel: campaign.channels[0] });
    assert.equal(r.grounding.ok, true, `${campaign.name}: ${JSON.stringify(r.grounding.issues)} in "${r.body}"`);
  }
});
