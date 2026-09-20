// Runs the ICP Fitment agent over the golden set (eval/icp-golden.json) and scores it against the human
// labels. Used by scripts/eval-icp.mjs (prints a report) and test/goldenIcp.test.js (guards the rule engine).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import { buildSeed } from "../src/db/seed.js";
import { scoreICP } from "../src/services/agentEngine/index.js";
import { getUsage } from "../src/services/usage.js";

const golden = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "icp-golden.json"), "utf-8"));

/**
 * @param {object} opts
 * @param {string} opts.engine     AGENT_ENGINE chain to use for this run, e.g. "rule" or "gemini"
 * @param {boolean} opts.shortcut  keep the free rule-based rejection shortcut (true) or send every case to the engine (false)
 */
export async function runIcpEval({ engine = config.agentEngine, shortcut = true } = {}) {
  const saved = { agentEngine: config.agentEngine, icpShortcutMargin: config.icpShortcutMargin };
  config.agentEngine = engine;
  if (!shortcut) config.icpShortcutMargin = 0;
  const seed = buildSeed(Date.now());
  const icpAgent = seed.agents.find((a) => a.id === "icp");
  const before = getUsage();
  const results = [];
  try {
    for (const c of golden.cases) {
      const campaign = seed.campaigns.find((x) => x.id === c.campaign);
      const prospect = { conversation: [], reasons: [], evidence: [], ...c.prospect };
      const started = Date.now();
      let got = null, score = null, usedEngine = null, error = null;
      try {
        const r = await scoreICP({ state: seed, campaign, prospect, icpAgent });
        got = r.qualified ? "Qualified" : "Rejected";
        score = r.score;
        usedEngine = r.engine;
      } catch (e) {
        error = e.message;
      }
      results.push({ id: c.id, campaign: c.campaign, expect: c.expect, why: c.why, got, score, engine: usedEngine, ms: Date.now() - started, error, pass: c.expect == null ? null : got === c.expect });
    }
  } finally {
    config.agentEngine = saved.agentEngine;
    config.icpShortcutMargin = saved.icpShortcutMargin;
  }
  const after = getUsage();
  const scored = results.filter((r) => r.pass !== null);
  const correct = scored.filter((r) => r.pass).length;
  return {
    engine,
    shortcut,
    results,
    accuracy: scored.length ? correct / scored.length : 0,
    correct,
    scored: scored.length,
    borderline: results.length - scored.length,
    errors: results.filter((r) => r.error).length,
    llmCalls: after.llmCalls - before.llmCalls,
    tokensIn: after.tokensIn - before.tokensIn,
    tokensOut: after.tokensOut - before.tokensOut,
    avoided: after.avoidedTotal - before.avoidedTotal,
    avgMs: Math.round(results.reduce((n, r) => n + r.ms, 0) / results.length),
  };
}
