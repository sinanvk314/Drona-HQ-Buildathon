// Run: npm test   (uses Node's built-in test runner; no extra dependencies)
// A fake DronaHQ webhook stands in for the real one, returning the real envelope shape:
//   {success, thread_id, run_id, message, response}
import "./_setup.js"; // keep test LLM usage out of the real usage counters
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { config } from "../src/config.js";
import { buildSeed } from "../src/db/seed.js";
import * as engine from "../src/services/agentEngine/index.js";
import { DronaHQError, normalizeConversation, normalizeDraft, normalizeICP, parseAgentOutput } from "../src/services/agentEngine/dronahqEngine.js";

const envelope = (response) => ({ success: true, thread_id: "t", run_id: "r", message: "Agent run completed successfully.", response });

// The exact body returned by the live agent when it answered in prose instead of JSON.
const REAL_PROSE_BODY = envelope(
  "It seems you have provided a JSON object, likely from an API request. However, there is no specific request or action included in your message for me to respond to. \n\nCould you please clarify what you would like me to do with this information?"
);

let server, baseUrl, handler, lastRequest;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastRequest = { headers: req.headers, body: raw ? JSON.parse(raw) : null };
      handler(req, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  config.agentEngine = "dronahq";
  config.dronahq.timeoutMs = 400;
  config.dronahq.fallback = "rule";
  for (const k of Object.keys(config.dronahq.webhooks)) {
    config.dronahq.webhooks[k] = { url: `${baseUrl}/webhook/${k}`, apiKey: `key-${k}` };
  }
});

after(() => server.close());

const reply = (body, status = 200) => (req, res) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function fixtures() {
  const s = buildSeed(Date.now());
  const campaign = s.campaigns[0];
  const prospect = s.prospects.find((p) => p.campaignId === campaign.id);
  const agent = (id) => s.agents.find((a) => a.id === id);
  return { s, campaign, prospect, agent };
}

// ---- parsing ----------------------------------------------------------------------------------

test("parses a JSON object returned inside a ```json fence", () => {
  const out = parseAgentOutput(envelope('```json\n{"decision":"Qualified","fit_score":88}\n```'));
  assert.equal(out.fit_score, 88);
});

test("parses JSON surrounded by a sentence", () => {
  const out = parseAgentOutput(envelope('Here is my answer: {"decision":"Rejected","fit_score":12} Hope that helps.'));
  assert.equal(out.decision, "Rejected");
});

test("finds the output under another usual key when `response` is empty", () => {
  const base = { success: true, thread_id: "t", run_id: "r", message: "Agent run completed successfully." };
  assert.equal(parseAgentOutput({ ...base, response: null, output: { decision: "Qualified", fit_score: 80 } }).fit_score, 80);
  assert.equal(parseAgentOutput({ ...base, response: "", result: '{"decision":"Rejected","fit_score":5}' }).decision, "Rejected");
});

test("finds the output when it is nested one level down (data.response)", () => {
  const out = parseAgentOutput({ success: true, data: { response: '```json\n{"decision":"Escalate","fit_score":40}\n```' } });
  assert.equal(out.decision, "Escalate");
});

test("an envelope with an empty `response` fails with a message that shows what the reply contained", () => {
  const reply = { success: true, thread_id: "t-123", run_id: "r-456", message: "Agent run completed successfully.", response: null };
  assert.throws(
    () => parseAgentOutput(reply),
    (e) => e instanceof DronaHQError && /no agent output found/.test(e.message) && /Reply was:/.test(e.message) && /"response":null/.test(e.message)
  );
});

test("DronaHQ's status `message` is never mistaken for the agent's output", () => {
  assert.throws(() => parseAgentOutput({ success: true, message: "Agent run completed successfully." }), /no agent output found/);
});

test("long strings in the error preview are clipped, so a reply cannot flood the log", () => {
  try {
    parseAgentOutput({ success: true, response: null, note: "x".repeat(5000) });
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.message.length < 900, `message was ${e.message.length} chars`);
  }
});

test("accepts an already-structured response object", () => {
  assert.equal(parseAgentOutput(envelope({ decision: "Qualified", fit_score: 90 })).fit_score, 90);
});

test("the real free-text reply is rejected as prose, not guessed at", () => {
  assert.throws(() => parseAgentOutput(REAL_PROSE_BODY), (e) => e instanceof DronaHQError && /prose, not JSON/.test(e.message));
});

// ---- normalisers ------------------------------------------------------------------------------

test("ICP: shared shape (decision + fit_score) maps to qualified/score", () => {
  const r = normalizeICP({ decision: "Qualified", fit_score: 91, evidence: ["a", "b"], handoff_note: "strong fit" });
  assert.deepEqual([r.qualified, r.score, r.reasons, r.reasoning], [true, 91, ["a", "b"], "strong fit"]);
});

test("ICP: native shape (qualified + score) is accepted too", () => {
  const r = normalizeICP({ qualified: false, score: 40, reasoning: "too small", reasons: ["size"] });
  assert.deepEqual([r.qualified, r.score], [false, 40]);
});

test("ICP: Escalate is not qualified and is labelled so a human can see it", () => {
  const r = normalizeICP({ decision: "Escalate", fit_score: 60, handoff_note: "ambiguous" });
  assert.equal(r.qualified, false);
  assert.match(r.reasoning, /^\[Agent escalated\]/);
});

test("ICP: missing score is an error, not a default", () => {
  assert.throws(() => normalizeICP({ decision: "Qualified" }), DronaHQError);
});

test("draft: draft_message string is the body; channel must be enabled for the campaign", () => {
  const campaign = { channels: ["email", "linkedin"] };
  const ok = normalizeDraft({ channel: "Email", subject: "Hi", draft_message: "Hello there" }, campaign);
  assert.deepEqual([ok.channel, ok.body], ["email", "Hello there"]);
  assert.throws(() => normalizeDraft({ channel: "voice", draft_message: "x" }, campaign), /not enabled/);
});

test("conversation: explicit action, or inferred from decision text", () => {
  assert.equal(normalizeConversation({ action: "meeting" }).action, "meeting");
  assert.equal(normalizeConversation({ decision: "Escalate to human", final_action: "x" }).action, "escalate");
  assert.throws(() => normalizeConversation({ decision: "???" }), DronaHQError);
});

// ---- end to end through agentEngine/index.js --------------------------------------------------

test("scoreICP calls the webhook with the api-key header and a person/company/campaign payload", async () => {
  handler = reply(envelope('```json\n{"agent_name":"ICP Fitment","decision":"Qualified","fit_score":91,"evidence":["VP buyer"],"handoff_note":"good"}\n```'));
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "dronahq");
  assert.equal(r.score, 91);
  assert.equal(r.qualified, true);
  assert.equal(lastRequest.headers["api-key"], "key-icp");
  assert.equal(lastRequest.body.person.name, prospect.name);
  assert.equal(lastRequest.body.company.name, prospect.company);
  assert.equal(lastRequest.body.campaign.id, campaign.id);
  assert.ok(Array.isArray(lastRequest.body.dossier));
});

test("draftOutreach returns the agent's draft", async () => {
  const { campaign, prospect, agent } = fixtures();
  handler = reply(envelope(JSON.stringify({ decision: "Draft ready", channel: campaign.channels[0], subject: "S", draft_message: "B" })));
  const r = await engine.draftOutreach({ campaign, prospect, personalisationAgent: agent("personalisation") });
  assert.deepEqual([r.engine, r.body], ["dronahq", "B"]);
});

test("handleConversation returns the agent's action", async () => {
  const { campaign, prospect, agent } = fixtures();
  handler = reply(envelope(JSON.stringify({ action: "escalate", reasoning: "security question" })));
  const r = await engine.handleConversation({ campaign, prospect, conversationAgent: agent("conversation") });
  assert.deepEqual([r.engine, r.action], ["dronahq", "escalate"]);
});

test("the real prose reply falls back to the rule engine and says why", async () => {
  handler = reply(REAL_PROSE_BODY);
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /prose, not JSON/);
  assert.equal(typeof r.score, "number");
});

test("HTTP 500 falls back to the rule engine", async () => {
  handler = reply({ error: "boom" }, 500);
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /HTTP 500/);
});

test("a webhook slower than the timeout falls back instead of hanging", async () => {
  handler = () => {}; // never responds
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /timed out/);
});

test("strict mode (DRONAHQ_FALLBACK=none) rethrows so failures are visible", async () => {
  handler = reply(REAL_PROSE_BODY);
  config.dronahq.fallback = "none";
  try {
    const { s, campaign, prospect, agent } = fixtures();
    await assert.rejects(() => engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") }), /prose, not JSON/);
  } finally {
    config.dronahq.fallback = "rule";
  }
});

test("an unconfigured agent webhook is a clear error", async () => {
  const saved = config.dronahq.webhooks.icp.url;
  config.dronahq.webhooks.icp.url = "";
  config.dronahq.fallback = "none";
  try {
    const { s, campaign, prospect, agent } = fixtures();
    await assert.rejects(() => engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") }), /no DronaHQ webhook configured/);
  } finally {
    config.dronahq.webhooks.icp.url = saved;
    config.dronahq.fallback = "rule";
  }
});

test("finds the agent's JSON inside DronaHQ's Text Response shape ({type:'text', text:'...'})", () => {
  const out = parseAgentOutput({
    success: true,
    response: { type: "text", text: '```json\n{"decision":"Qualified","fit_score":88}\n```' },
  });
  assert.equal(out.fit_score, 88);
});
