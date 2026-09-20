// Cost and quota accounting for the intelligence layer (PS: "Cost & Performance" and
// "Measurement & Optimisation"). Counts, per day: LLM calls actually made, decisions settled without
// an LLM (rule shortcut, embedding reply routing, cap fallback), and errors. Persisted to
// data/usage.json so a restart mid-demo does not reset the daily cap.
//
// Two jobs:
//   1. Guard: canCallLlm() turns false once LLM_DAILY_CALL_CAP calls are made today, so the agent
//      chain skips LLM engines and the rule engine decides. The demo keeps running on free quota.
//   2. Report: getUsage() feeds the dashboard's "AI efficiency" panel.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.USAGE_FILE || path.join(__dirname, "..", "..", "data", "usage.json");

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({
  day: today(),
  llmCalls: 0, // requests sent to an LLM provider, retries included (they count against quota)
  llmDecisions: 0, // decisions an LLM actually made
  llmErrors: 0,
  byModel: {},
  byAgent: {}, // per agent: successful decisions, tokens and latency of the LLM calls behind them
  avoided: { icpShortcut: 0, replyRouting: 0, capFallback: 0 }, // decisions that needed no LLM call
  ruleFallbacks: 0, // an LLM engine failed and the rule engine decided
  totals: { llmCalls: 0, avoided: 0 }, // all-time
});

let usage = load();

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return { ...blank(), ...parsed, avoided: { ...blank().avoided, ...(parsed.avoided || {}) }, totals: { ...blank().totals, ...(parsed.totals || {}) } };
  } catch {
    return blank();
  }
}

let dirty = false;
function save() {
  dirty = true;
}
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(usage));
  } catch {
    /* usage tracking must never break the app */
  }
}, 5000).unref();

function rollDay() {
  if (usage.day !== today()) usage = { ...blank(), totals: usage.totals };
}

/** Called once per request sent to an LLM provider (retries included). */
export function recordLlmCall(model) {
  rollDay();
  usage.llmCalls += 1;
  usage.totals.llmCalls += 1;
  if (model) usage.byModel[model] = (usage.byModel[model] || 0) + 1;
  save();
}

/** A request that produced usable agent output: counts the decision and its tokens and latency. */
export function recordLlmUsage({ agent = "other", tokensIn, tokensOut, ms }) {
  rollDay();
  const a = (usage.byAgent[agent] ||= { decisions: 0, tokensIn: 0, tokensOut: 0, ms: 0 });
  a.decisions += 1;
  a.tokensIn += Number(tokensIn) || 0;
  a.tokensOut += Number(tokensOut) || 0;
  a.ms += Number(ms) || 0;
  save();
}

export function recordLlmDecision() {
  rollDay();
  usage.llmDecisions += 1;
  save();
}

export function recordLlmError() {
  rollDay();
  usage.llmErrors += 1;
  save();
}

/** reason: "icpShortcut" | "replyRouting" | "capFallback" — a decision made without an LLM call. */
export function recordAvoided(reason) {
  rollDay();
  usage.avoided[reason] = (usage.avoided[reason] || 0) + 1;
  usage.totals.avoided += 1;
  save();
}

export function recordRuleFallback() {
  rollDay();
  usage.ruleFallbacks += 1;
  save();
}

export function capReached() {
  rollDay();
  return config.llmDailyCallCap > 0 && usage.llmCalls >= config.llmDailyCallCap;
}

const tokenCost = (tokensIn, tokensOut) =>
  (tokensIn * config.estCostPerMTokIn + tokensOut * config.estCostPerMTokOut) / 1e6;

export function getUsage() {
  rollDay();
  const avoided = Object.values(usage.avoided).reduce((a, b) => a + b, 0);
  const decisions = usage.llmDecisions + avoided + usage.ruleFallbacks;

  const agents = Object.entries(usage.byAgent).map(([agent, a]) => ({
    agent,
    decisions: a.decisions,
    tokensIn: a.tokensIn,
    tokensOut: a.tokensOut,
    avgLatencyMs: a.decisions ? Math.round(a.ms / a.decisions) : 0,
    estCostUsd: Number(tokenCost(a.tokensIn, a.tokensOut).toFixed(6)),
  }));
  const tokensIn = agents.reduce((n, a) => n + a.tokensIn, 0);
  const tokensOut = agents.reduce((n, a) => n + a.tokensOut, 0);
  const measured = agents.reduce((n, a) => n + a.decisions, 0);
  const totalMs = Object.values(usage.byAgent).reduce((n, a) => n + a.ms, 0);
  // Real token counts when the provider reports them; otherwise a flat per-call estimate.
  const estCostUsd = tokensIn + tokensOut > 0 ? tokenCost(tokensIn, tokensOut) : usage.llmCalls * config.estCostPerLlmCall;
  const costPerLlmDecision = usage.llmDecisions ? estCostUsd / usage.llmDecisions : config.estCostPerLlmCall;

  return {
    day: usage.day,
    llmCalls: usage.llmCalls,
    llmDecisions: usage.llmDecisions,
    llmErrors: usage.llmErrors,
    byModel: { ...usage.byModel },
    byAgent: agents,
    tokensIn,
    tokensOut,
    avgLatencyMs: measured ? Math.round(totalMs / measured) : 0,
    avoided: { ...usage.avoided },
    avoidedTotal: avoided,
    ruleFallbacks: usage.ruleFallbacks,
    dailyCap: config.llmDailyCallCap,
    capReached: capReached(),
    avoidedPct: decisions ? Math.round((avoided / decisions) * 100) : 0,
    estCostUsd: Number(estCostUsd.toFixed(6)),
    estSavedUsd: Number((avoided * costPerLlmDecision).toFixed(6)),
    allTime: { ...usage.totals },
  };
}
