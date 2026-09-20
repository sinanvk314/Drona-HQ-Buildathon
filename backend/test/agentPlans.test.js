// The Outreach Strategy and Follow-up agents and the Conversation agent's reply drafts, against a fake Gemini
// server (real response shape) and the rule engine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "os";
import path from "path";

process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-plans-${process.pid}.json`);
process.env.EMBEDDINGS = "off";
const { config } = await import("../src/config.js");
const { buildSeed } = await import("../src/db/seed.js");
const engine = await import("../src/services/agentEngine/index.js");
const { ruleStrategy, ruleFollowUp, ruleHandleConversation } = await import("../src/services/agentEngine/ruleEngine.js");

const geminiReply = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }] });
let server, reply, last;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      last = raw ? JSON.parse(raw) : null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(geminiReply(reply)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  config.agentEngine = "gemini";
  config.gemini.baseUrl = `http://127.0.0.1:${server.address().port}/v1beta`;
  config.gemini.apiKey = "test-key";
  config.gemini.rpm = 600000;
  config.gemini.model = "test-model";
  config.gemini.retries = 0;
});
after(() => server.close());

const seed = buildSeed(Date.now());
const campaign = seed.campaigns.find((c) => c.id === "c_us_saas"); // channels: email, linkedin
const founderCampaign = seed.campaigns.find((c) => c.id === "c_ai_founders"); // channels: email, sms
const agent = (id) => seed.agents.find((a) => a.id === id);
const prospect = { name: "Dana Priest", title: "CTO", company: "Fleetwise", industry: "SaaS", size: "240 employees", funding: "Series C", tech: ["AWS"], city: "Austin, TX", history: [], conversation: [{ dir: "out", text: "Hi Dana, opening message" }] };

test("the plan is limited to enabled channels and the touch limit, whatever the model returns", async () => {
  reply = { sequence: ["voice", "linkedin", "email", "linkedin", "email"], wait_hours: 500, reasoning: "Because." };
  const plan = await engine.planOutreach({ campaign, prospect, strategyAgent: agent("strategy"), allowedChannels: ["email", "linkedin"] });
  assert.equal(plan.engine, "gemini");
  assert.deepEqual(plan.sequence, ["linkedin", "email", "linkedin"], "voice was not enabled; capped at max_touches = 3");
  assert.equal(plan.waitHours, 168, "wait is clamped to 24-168 hours");
  // The schema sent to the model already restricts the channels, so a disabled one cannot be produced.
  const enumSent = last.generationConfig.responseSchema.properties.sequence.items.enum;
  assert.deepEqual(enumSent, ["email", "linkedin"]);
  assert.equal(last.generationConfig.responseSchema.properties.sequence.maxItems, 3);
});

test("a plan with no usable channel falls back to the rule engine instead of stalling", async () => {
  reply = { sequence: ["voice"], wait_hours: 72, reasoning: "Call them." };
  const plan = await engine.planOutreach({ campaign, prospect, strategyAgent: agent("strategy"), allowedChannels: ["email", "linkedin"] });
  assert.equal(plan.engine, "rule");
  assert.match(plan.fallbackReason, /no usable channel/);
  assert.ok(plan.sequence.every((c) => ["email", "linkedin"].includes(c)));
});

test("the rule strategy leads on LinkedIn for founders, on email for CTOs, never opens on SMS and puts voice last", () => {
  const args = (title, allowedChannels) => ({ campaign, prospect: { title }, allowedChannels, maxTouches: 3, defaultWait: 72 });
  assert.equal(ruleStrategy(args("Founder", ["email", "linkedin"])).sequence[0], "linkedin");
  assert.equal(ruleStrategy(args("CTO", ["email", "linkedin"])).sequence[0], "email");
  assert.notEqual(ruleStrategy(args("CTO", ["sms", "email"])).sequence[0], "sms");
  const withVoice = ruleStrategy(args("CIO", ["voice", "email"])).sequence;
  assert.equal(withVoice[withVoice.length - 1], "voice");
  assert.deepEqual(ruleStrategy(args("CTO", ["email"])).sequence, ["email", "email", "email"], "one channel: later touches repeat it");
});

test("a follow-up is drafted for the channel it was asked for and the model's fields come through", async () => {
  reply = { subject: "Fleetwise result", body: "Hi Dana, one more thought: a similar team cut spend 23%.", angle: "Customer result", reasoning: "New fact." };
  const r = await engine.draftFollowUp({ campaign, prospect, followupAgent: agent("followup"), channel: "email", touchNumber: 1, isLast: false });
  assert.equal(r.engine, "gemini");
  assert.equal(r.angle, "Customer result");
  assert.equal(last.contents[0].parts[0].text.includes('"channel":"email"'), true, "the channel is passed to the model");
  assert.equal(JSON.parse(last.contents[0].parts[0].text).follow_up.is_last_touch, false);
});

test("the last follow-up closes the loop, and the rule fallback does not repeat the opening", () => {
  const r = ruleFollowUp({ prospect, knowledge: [], channel: "email", touchNumber: 2, isLast: true });
  assert.match(r.body, /last note/i);
  assert.notEqual(r.body, prospect.conversation[0].text);
  assert.equal(r.subject.startsWith("Following up"), true);
});

test("the conversation agent returns a reply draft, and an escalation draft makes no commitments", async () => {
  reply = { action: "escalate", reasoning: "Security question.", reply_draft: "Hi Dana, thanks for asking. A specialist will follow up shortly." };
  const inbound = { ...prospect, conversation: [{ dir: "out", text: "Opening" }, { dir: "in", text: "Can you share your SOC 2 report?" }] };
  const r = await engine.handleConversation({ campaign, prospect: inbound, conversationAgent: agent("conversation") });
  assert.equal(r.action, "escalate");
  assert.match(r.draft, /specialist will follow up/);
  assert.equal(last.generationConfig.responseSchema.required.includes("reply_draft"), true);

  const rule = ruleHandleConversation({ campaign, prospect: inbound, knowledge: [] });
  assert.equal(rule.action, "escalate");
  assert.ok(rule.draft.length > 20 && !/\$\d|SOC 2 Type|certified/i.test(rule.draft));
});

test("a Gemini plan for a campaign with a single channel keeps that channel", async () => {
  reply = { sequence: ["email", "email"], wait_hours: 48, reasoning: "One channel." };
  const plan = await engine.planOutreach({ campaign: founderCampaign, prospect, strategyAgent: agent("strategy"), allowedChannels: ["email"] });
  assert.deepEqual(plan.sequence, ["email", "email"]);
  assert.equal(plan.waitHours, 48);
});
