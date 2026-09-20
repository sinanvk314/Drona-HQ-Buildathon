// Cost/quota controls and local matching: the daily LLM cap, embedding reply routing, campaign-scoped
// semantic retrieval, and the ICP rejection shortcut. The embedding tests load the real model
// (first run downloads ~130MB into data/.embedding-cache; later runs are offline).
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

// Counters go to a temp file so running the tests never touches the real dashboard numbers.
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-test-${process.pid}.json`);
const { config } = await import("../src/config.js");
const { capReached, getUsage, recordAvoided, recordLlmCall, recordLlmUsage } = await import("../src/services/usage.js");
const { classifyReply } = await import("../src/services/replyRouter.js");
const { retrieve } = await import("../src/services/rag.js");
const { scoreICP } = await import("../src/services/agentEngine/index.js");

test("the daily LLM cap flips once enough calls are counted, and 0 disables it", () => {
  const before = getUsage().llmCalls;
  const saved = config.llmDailyCallCap;
  try {
    config.llmDailyCallCap = before + 2;
    assert.equal(capReached(), false);
    recordLlmCall("test-model");
    recordLlmCall("test-model");
    assert.equal(capReached(), true);
    config.llmDailyCallCap = 0;
    assert.equal(capReached(), false);
  } finally {
    config.llmDailyCallCap = saved;
  }
});

test("avoided decisions are counted by reason and priced", () => {
  const before = getUsage();
  recordAvoided("replyRouting");
  const after = getUsage();
  assert.equal(after.avoided.replyRouting, before.avoided.replyRouting + 1);
  assert.equal(after.avoidedTotal, before.avoidedTotal + 1);
  assert.ok(after.estSavedUsd >= before.estSavedUsd);
});

test("tokens and latency are tracked per agent and priced", () => {
  const before = getUsage();
  recordLlmUsage({ agent: "icp", tokensIn: 2000, tokensOut: 300, ms: 1200 });
  recordLlmUsage({ agent: "icp", tokensIn: 1000, tokensOut: 100, ms: 800 });
  const after = getUsage();
  const icp = after.byAgent.find((a) => a.agent === "icp");
  const icpBefore = before.byAgent.find((a) => a.agent === "icp") || { tokensIn: 0, tokensOut: 0, decisions: 0 };
  assert.equal(icp.tokensIn - icpBefore.tokensIn, 3000);
  assert.equal(icp.tokensOut - icpBefore.tokensOut, 400);
  assert.equal(icp.decisions - icpBefore.decisions, 2);
  assert.ok(icp.avgLatencyMs > 0);
  // With real token counts, cost is tokens x price (not the flat per-call fallback).
  const expected = (after.tokensIn * config.estCostPerMTokIn + after.tokensOut * config.estCostPerMTokOut) / 1e6;
  assert.ok(Math.abs(after.estCostUsd - expected) < 1e-6, `${after.estCostUsd} vs ${expected}`);
});

test("clear-cut replies are routed without an LLM; judgment replies are not", async () => {
  for (const text of ["Please remove me from your list.", "I am out of the office until Monday.", "Stop spamming me, this is unsolicited."]) {
    const r = await classifyReply(text);
    assert.equal(r.deterministic, true, `${text} -> ${r.category} ${r.score}/${r.margin}`);
  }
  for (const text of [
    "Interesting, could we do a quick call this week?",
    "Can you share your SOC 2 report and where data is stored?",
    "Thanks for reaching out, tell me more about pricing.",
    "Please stop calling my assistant and email me instead.", // a channel preference, not an opt-out
  ]) {
    const r = await classifyReply(text);
    assert.equal(r.deterministic, false, `${text} -> ${r.category} ${r.score}/${r.margin}`);
  }
});

test("retrieval searches only the campaign's own knowledge sources", async () => {
  const sources = (docIds) => docIds.map((docId, i) => ({ id: `s${i}`, name: docId, category: "x", docId }));
  const bfsi = { sources: sources(["playbook-bfsi-cio", "objection-handling-bfsi"]) };
  const founders = { sources: sources(["playbook-ai-founders", "objection-handling-founders"]) };

  const a = await retrieve(bfsi, "does our data leave India and are you RBI certified", 2);
  assert.ok(a.length > 0 && a.every((k) => /bfsi/i.test(k.label)), JSON.stringify(a.map((k) => k.label)));
  const b = await retrieve(founders, "does our data leave India and are you RBI certified", 2);
  assert.ok(b.every((k) => /founders/i.test(k.label)), JSON.stringify(b.map((k) => k.label)));
});

test("a source typed into the UI (content, no docId) is retrievable", async () => {
  const campaign = { sources: [{ id: "u1", name: "Refund policy", category: "Other", content: "Refunds are issued within 14 days of a written request.\n\nSupport hours are 9am to 5pm IST." }] };
  const hits = await retrieve(campaign, "how long do refunds take", 1);
  assert.equal(hits[0].label, "Refund policy");
  assert.match(hits[0].text, /Refunds/);
});

test("a clearly unfit prospect is rejected by the rule shortcut with no LLM call", async () => {
  const campaign = {
    id: "c", qualificationPrompt: "Qualify at 70 or above.", companyCriteria: "50–500 employees", personas: ["CTO"],
    exclusionCriteria: "", icpText: "SaaS CTOs", channels: ["email"], sources: [],
  };
  const prospect = { id: "p", name: "A B", title: "Office Manager", company: "Tiny Co", size: "5 employees", tech: [], reasons: [] };
  const icpAgent = { versions: [{ status: "active", version: "v1", text: "t" }], overrides: [] };
  const before = getUsage().avoided.icpShortcut;
  const r = await scoreICP({ state: {}, campaign, prospect, icpAgent });
  assert.equal(r.qualified, false);
  assert.equal(r.engine, "rule-shortcut");
  assert.equal(getUsage().avoided.icpShortcut, before + 1);
});
