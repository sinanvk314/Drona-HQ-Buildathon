// Run: npm test. A fake server stands in for Gemini's generateContent API (real response shape:
// candidates[0].content.parts[0].text holds the JSON string) and for a failing DronaHQ webhook.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { config } from "../src/config.js";
import { buildSeed } from "../src/db/seed.js";
import * as engine from "../src/services/agentEngine/index.js";

const geminiReply = (obj) => ({ candidates: [{ content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] }, finishReason: "STOP" }] });

const GOOD_ICP = {
  agent_name: "ICP Fitment Agent", harness_version: "icp-gemini-v1", decision: "Qualified", qualified: true, fit_score: 86, score: 86,
  reasoning: "CTO at a growing SaaS company.", reasons: ["CTO"], evidence: ["Title is CTO"], retrieved_knowledge: [],
  campaign_instruction_excerpt: "CTO or VP Engineering", conflict_check: "not in dossier", final_action: "advance_to_outreach", handoff_note: "Strong fit.",
};

let server, baseUrl, handler, last;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      last = { url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      handler(req, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  config.agentEngine = "gemini";
  config.gemini.baseUrl = `${baseUrl}/v1beta`;
  config.gemini.apiKey = "test-key";
  config.gemini.rpm = 600000; // no throttling delay in tests
  config.gemini.timeoutMs = 400;
  config.gemini.retries = 2;
  config.gemini.model = "test-model"; // one model unless a test sets a list
  config.gemini.retryDelayMs = 5; // tiny pause so retry tests stay fast
  config.gemini.fallback = "rule";
  config.dronahq.fallback = "rule";
  for (const k of Object.keys(config.dronahq.webhooks)) config.dronahq.webhooks[k] = { url: `${baseUrl}/dronahq/${k}`, apiKey: "dk" };
});

after(() => server.close());

const json = (body, status = 200) => (req, res) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function fixtures() {
  const s = buildSeed(Date.now());
  const campaign = s.campaigns[0];
  return { s, campaign, prospect: s.prospects.find((p) => p.campaignId === campaign.id), agent: (id) => s.agents.find((a) => a.id === id) };
}

test("scoreICP sends a structured-output request and returns the decision", async () => {
  handler = json(geminiReply(GOOD_ICP));
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.deepEqual([r.engine, r.qualified, r.score], ["gemini", true, 86]);

  assert.match(last.url, /\/v1beta\/models\/.+:generateContent$/);
  assert.equal(last.headers["x-goog-api-key"], "test-key");
  assert.equal(last.body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(last.body.generationConfig.responseSchema.properties.decision.enum, ["Qualified", "Rejected", "Escalate"]);
  assert.ok(last.body.systemInstruction.parts[0].text.includes("ICP Fitment Agent"));
  const sent = JSON.parse(last.body.contents[0].parts[0].text);
  assert.equal(sent.person.name, prospect.name);
  assert.equal(sent.campaign.id, campaign.id);
});

test("the draft schema only allows the campaign's enabled channels", async () => {
  const { campaign, prospect, agent } = fixtures();
  handler = json(geminiReply({ channel: campaign.channels[0], subject: "Hi", body: "Hello there", reasoning: "fits" }));
  const r = await engine.draftOutreach({ campaign, prospect, personalisationAgent: agent("personalisation") });
  assert.deepEqual([r.engine, r.body], ["gemini", "Hello there"]);
  assert.deepEqual(last.body.generationConfig.responseSchema.properties.channel.enum, campaign.channels);
});

test("a channel that is not enabled is rejected even if the model returns it", async () => {
  const { campaign, prospect, agent } = fixtures();
  handler = json(geminiReply({ channel: "voice", subject: "Hi", body: "Hello", reasoning: "x" }));
  const r = await engine.draftOutreach({ campaign, prospect, personalisationAgent: agent("personalisation") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /not enabled/);
});

test("handleConversation returns the action and sends the conversation", async () => {
  const { campaign, prospect, agent } = fixtures();
  handler = json(geminiReply({ action: "escalate", reasoning: "security question" }));
  const r = await engine.handleConversation({ campaign, prospect, conversationAgent: agent("conversation") });
  assert.deepEqual([r.engine, r.action], ["gemini", "escalate"]);
  assert.ok("conversation" in JSON.parse(last.body.contents[0].parts[0].text));
});

test("HTTP 429 falls back to the rule engine and says the API was rate limited", async () => {
  handler = json({ error: { message: "quota" } }, 429);
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /rate limited/);
});

test("prose instead of JSON falls back", async () => {
  handler = json(geminiReply("Sorry, I can't help with that."));
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /prose, not JSON/);
});

test("a blocked request falls back with the block reason", async () => {
  handler = json({ promptFeedback: { blockReason: "SAFETY" } });
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.match(r.fallbackReason, /blocked: SAFETY/);
});

test("an empty candidate list falls back", async () => {
  handler = json({ candidates: [] });
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.match(r.fallbackReason, /empty response/);
});

test("a slow Gemini falls back instead of hanging", async () => {
  handler = () => {};
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.match(r.fallbackReason, /timed out/);
});

test("a missing API key is a clear error in strict mode", async () => {
  const saved = config.gemini.apiKey;
  config.gemini.apiKey = "";
  config.gemini.fallback = "none";
  try {
    const { s, campaign, prospect, agent } = fixtures();
    await assert.rejects(() => engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") }), /GEMINI_API_KEY is not set/);
  } finally {
    config.gemini.apiKey = saved;
    config.gemini.fallback = "rule";
  }
});

test("chain dronahq,gemini: a failing DronaHQ hands over to Gemini", async () => {
  handler = (req, res) => (req.url.startsWith("/dronahq") ? json({ error: "boom" }, 500)(req, res) : json(geminiReply(GOOD_ICP))(req, res));
  config.agentEngine = "dronahq,gemini";
  try {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.deepEqual([r.engine, r.score], ["gemini", 86]);
  } finally {
    config.agentEngine = "gemini";
  }
});

test("chain dronahq,gemini: DronaHQ wins when it answers, and Gemini is never called", async () => {
  let geminiCalls = 0;
  handler = (req, res) => {
    if (req.url.startsWith("/dronahq")) return json({ success: true, response: JSON.stringify({ decision: "Qualified", fit_score: 91 }) })(req, res);
    geminiCalls++;
    return json(geminiReply(GOOD_ICP))(req, res);
  };
  config.agentEngine = "dronahq,gemini";
  try {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.deepEqual([r.engine, r.score, geminiCalls], ["dronahq", 91, 0]);
  } finally {
    config.agentEngine = "gemini";
  }
});

test("chain: when every engine fails the rule engine decides and both reasons are listed", async () => {
  handler = json({ error: "down" }, 500);
  config.agentEngine = "dronahq,gemini";
  try {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.equal(r.engine, "rule");
    assert.match(r.fallbackReason, /dronahq: .*\| gemini: /);
  } finally {
    config.agentEngine = "gemini";
  }
});

test("requests are spaced out to respect the rate limit", async () => {
  handler = json(geminiReply(GOOD_ICP));
  config.gemini.rpm = 600; // one request per 100 ms
  try {
    const { s, campaign, prospect, agent } = fixtures();
    const started = Date.now();
    for (let i = 0; i < 3; i++) await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.ok(Date.now() - started >= 180, `3 calls finished in ${Date.now() - started}ms; expected >= 180`);
  } finally {
    config.gemini.rpm = 600000;
  }
});

// ---- temporary failures are retried -----------------------------------------------------------

test("a passing 503 'high demand' is retried and the decision still comes from Gemini", async () => {
  let calls = 0;
  handler = (req, res) => (++calls <= 2 ? json({ error: { status: "UNAVAILABLE" } }, 503)(req, res) : json(geminiReply(GOOD_ICP))(req, res));
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.deepEqual([r.engine, r.score, calls], ["gemini", 86, 3]);
});

test("a 503 that never clears gives up after the configured retries and falls back", async () => {
  let calls = 0;
  handler = (req, res) => { calls++; return json({ error: { status: "UNAVAILABLE" } }, 503)(req, res); };
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /HTTP 503/);
  assert.equal(calls, 3); // 1 try + 2 retries
});

test("a permanent error (retired model, HTTP 404) is NOT retried", async () => {
  let calls = 0;
  handler = (req, res) => { calls++; return json({ error: { message: "model retired" } }, 404)(req, res); };
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.equal(r.engine, "rule");
  assert.match(r.fallbackReason, /HTTP 404/);
  assert.equal(calls, 1);
});

test("a 429 that carries a Retry-After (a per-minute burst) is waited out and retried on the same model", async () => {
  let calls = 0;
  handler = (req, res) => {
    if (++calls === 1) { res.writeHead(429, { "content-type": "application/json", "retry-after": "1" }); return res.end("{}"); }
    return json(geminiReply(GOOD_ICP))(req, res);
  };
  const { s, campaign, prospect, agent } = fixtures();
  const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
  assert.deepEqual([r.engine, calls], ["gemini", 2]);
});


// ---- several models: quotas are per model, so the next one takes over --------------------------------

const seenModels = [];
const modelOf = (req) => decodeURIComponent(req.url.match(/models\/([^:]+):/)[1]);
async function withModels(list, fn) {
  const saved = config.gemini.model; config.gemini.model = list; seenModels.length = 0;
  try { return await fn(); } finally { config.gemini.model = saved; }
}

test("a model whose quota is used up (429, no Retry-After) hands over to the next model at once", async () => {
  handler = (req, res) => { seenModels.push(modelOf(req)); return (modelOf(req) === "m1" ? json({ error: { message: "You exceeded your current quota" } }, 429) : json(geminiReply(GOOD_ICP)))(req, res); };
  await withModels("m1,m2", async () => {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.deepEqual([r.engine, r.score], ["gemini", 86]);
    assert.deepEqual(seenModels, ["m1", "m2"]); // m1 tried once (not retried), then m2
  });
});

test("a retired model (404) hands over to the next model", async () => {
  handler = (req, res) => { seenModels.push(modelOf(req)); return (modelOf(req) === "old" ? json({ error: { message: "no longer available" } }, 404) : json(geminiReply(GOOD_ICP)))(req, res); };
  await withModels("old,new", async () => {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.equal(r.engine, "gemini");
    assert.deepEqual(seenModels, ["old", "new"]);
  });
});

test("a model still overloaded (503) after its retries hands over to the next model", async () => {
  handler = (req, res) => { seenModels.push(modelOf(req)); return (modelOf(req) === "busy" ? json({ error: "UNAVAILABLE" }, 503) : json(geminiReply(GOOD_ICP)))(req, res); };
  await withModels("busy,ok", async () => {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.equal(r.engine, "gemini");
    assert.deepEqual(seenModels, ["busy", "busy", "busy", "ok"]); // 1 try + 2 retries, then the next model
  });
});

test("when every model is unavailable the rule engine decides and every model's reason is listed", async () => {
  handler = json({ error: { message: "You exceeded your current quota" } }, 429);
  await withModels("m1,m2", async () => {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.equal(r.engine, "rule");
    assert.match(r.fallbackReason, /\[m1\].*\[m2\]/);
  });
});

test("a problem that is not about the model (a blocked request) does NOT try other models", async () => {
  handler = (req, res) => { seenModels.push(modelOf(req)); return json({ promptFeedback: { blockReason: "SAFETY" } })(req, res); };
  await withModels("m1,m2", async () => {
    const { s, campaign, prospect, agent } = fixtures();
    const r = await engine.scoreICP({ state: s, campaign, prospect, icpAgent: agent("icp") });
    assert.match(r.fallbackReason, /blocked: SAFETY/);
    assert.deepEqual(seenModels, ["m1"]);
  });
});
