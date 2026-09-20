// Single seam the scheduler and routes call through — dispatches to the real LLM engine
// (PS Section 4's "Agentic AI") when configured, and always falls back to the deterministic
// rule engine so the backend runs end to end with zero setup. See ruleEngine.js / llmEngine.js.
import { config, engineChain, isLlmMode } from "../../config.js";
import * as rule from "./ruleEngine.js";
import * as llm from "./llmEngine.js";
import * as dronahq from "./dronahqEngine.js";
import * as gemini from "./geminiEngine.js";
import { retrieve } from "../rag.js";
import { capReached, recordAvoided, recordLlmDecision, recordLlmError, recordRuleFallback } from "../usage.js";

function activePromptFor(agent, campaignId) {
  const active = agent.versions.find((v) => v.status === "active") || agent.versions[0];
  const override = agent.overrides.find((o) => o.campaignId === campaignId);
  return { text: active ? active.text : "", harness: active ? active.version : "v0", override: override ? override.text : null };
}

// AGENT_ENGINE is a chain of engines tried in order: "dronahq", "gemini", "llm" (Anthropic), for
// example "dronahq,gemini". The first that succeeds decides. The deterministic rule engine is always
// the last resort, so the backend never stalls. `engine` on the result names who actually decided,
// and `fallbackReason` lists why earlier engines were skipped. Strict mode (DRONAHQ_FALLBACK=none or
// GEMINI_FALLBACK=none) makes that engine's failure throw instead of moving on, so it can't be masked.
const isStrict = (name) =>
  (name === "dronahq" && config.dronahq.fallback === "none") || (name === "gemini" && config.gemini.fallback === "none");

async function withFallback(llmCall, ruleCall, dronahqCall, geminiCall) {
  const failures = [];
  const capped = capReached();
  for (const name of engineChain()) {
    const call = name === "dronahq" ? dronahqCall : name === "gemini" ? geminiCall : name === "llm" && isLlmMode() ? llmCall : null;
    if (!call) continue;
    if (capped) {
      // Daily LLM budget used up (LLM_DAILY_CALL_CAP): don't touch the provider, let the rule engine decide.
      if (!failures.length) failures.push(`daily LLM call cap reached (${config.llmDailyCallCap})`);
      continue;
    }
    try {
      const result = { ...(await call()), engine: name };
      recordLlmDecision();
      return result;
    } catch (e) {
      recordLlmError();
      if (isStrict(name)) throw e;
      failures.push(`${name}: ${e.message}`);
      console.warn(`[agentEngine] ${name} failed (${e.message}); trying the next engine`);
    }
  }
  if (failures.length) capped ? recordAvoided("capFallback") : recordRuleFallback();
  return { ...ruleCall(), engine: "rule", ...(failures.length ? { fallbackReason: failures.join(" | ") } : {}) };
}

export async function scoreICP({ state, campaign, prospect, icpAgent }) {
  const { text, harness, override } = activePromptFor(icpAgent, campaign.id);
  const knowledge = await retrieve(campaign, `${campaign.icpText} ${campaign.qualificationPrompt}`, 2);

  // Matching before judgment: when the deterministic score is nowhere near the threshold (or a hard
  // exclusion fired) the answer is not in doubt, so an LLM would only confirm it. Only clear REJECTIONS
  // are settled here. A qualification starts real outreach, so it always gets the LLM's read.
  const ruleResult = rule.ruleScoreICP({ campaign, prospect });
  const margin = config.icpShortcutMargin;
  const clearCut = margin > 0 && !ruleResult.qualified && ruleResult.score <= ruleResult.threshold - margin;
  if (clearCut) {
    recordAvoided("icpShortcut");
    return {
      ...ruleResult,
      engine: "rule-shortcut",
      fallbackReason: `clear-cut (rule score ${ruleResult.score} vs threshold ${ruleResult.threshold}); no LLM call needed`,
      harness, retrieved: [...new Set(knowledge.map((k) => k.label))], instruction: override || text,
    };
  }

  const result = await withFallback(
    () => llm.llmScoreICP({ campaign, prospect, promptText: text, knowledge }),
    () => rule.ruleScoreICP({ campaign, prospect }),
    () => dronahq.dronahqScoreICP({ campaign, prospect, promptText: text, knowledge }),
    () => gemini.geminiScoreICP({ campaign, prospect, promptText: text, knowledge })
  );
  return { ...result, harness, retrieved: [...new Set(knowledge.map((k) => k.label))], instruction: override || text };
}

export async function draftOutreach({ campaign, prospect, personalisationAgent }) {
  const { text, harness, override } = activePromptFor(personalisationAgent, campaign.id);
  const knowledge = await retrieve(campaign, `${prospect.company} ${prospect.industry} ${(prospect.reasons || []).join(" ")}`, 2);
  const result = await withFallback(
    () => llm.llmDraftOutreach({ campaign, prospect, promptText: text, override, knowledge }),
    () => rule.ruleDraftOutreach({ campaign, prospect, knowledge, override }),
    () => dronahq.dronahqDraftOutreach({ campaign, prospect, promptText: text, override, knowledge }),
    () => gemini.geminiDraftOutreach({ campaign, prospect, promptText: text, override, knowledge })
  );
  return { ...result, harness, retrieved: [...new Set(knowledge.map((k) => k.label))], instruction: override || text };
}

export async function handleConversation({ campaign, prospect, conversationAgent }) {
  const { text, harness, override } = activePromptFor(conversationAgent, campaign.id);
  const lastIn = (prospect.conversation || []).filter((c) => c.dir === "in").slice(-1)[0];
  const knowledge = await retrieve(campaign, lastIn ? lastIn.text : campaign.objective, 2);
  const result = await withFallback(
    () => llm.llmHandleConversation({ campaign, prospect, promptText: text, override, knowledge }),
    () => rule.ruleHandleConversation({ campaign, prospect }),
    () => dronahq.dronahqHandleConversation({ campaign, prospect, promptText: text, override, knowledge }),
    () => gemini.geminiHandleConversation({ campaign, prospect, promptText: text, override, knowledge })
  );
  return { ...result, harness, retrieved: [...new Set(knowledge.map((k) => k.label))], instruction: override || text };
}

export function enrich({ prospect }) {
  return rule.ruleEnrich({ prospect }); // enrichment stays rule-based: it's data lookup, not judgment
}
