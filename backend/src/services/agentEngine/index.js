// Single seam the scheduler and routes call through — dispatches to the real LLM engine
// (PS Section 4's "Agentic AI") when configured, and always falls back to the deterministic
// rule engine so the backend runs end to end with zero setup. See ruleEngine.js / llmEngine.js.
import { config, engineChain, isLlmMode } from "../../config.js";
import * as rule from "./ruleEngine.js";
import * as llm from "./llmEngine.js";
import * as dronahq from "./dronahqEngine.js";
import * as gemini from "./geminiEngine.js";
import { retrieve } from "../rag.js";
import { checkGrounding, describeIssues } from "../grounding.js";
import { composePrompt } from "../prompts.js";
import { capReached, recordAvoided, recordLlmDecision, recordLlmError, recordRuleFallback } from "../usage.js";

// What the agent is given for this campaign: the campaign system prompt + the version the campaign is pinned to.
// See services/prompts.js.
export const activePromptFor = composePrompt;

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

// Every customer-facing draft is checked against the knowledge and prospect data it was written from (grounding.js).
// If the check fails and an LLM wrote it, the agent gets ONE more try with the problems named; the better of the two
// is kept. The result always carries the check, so the scheduler can refuse to auto-send a draft that still fails.
const retryNote = (issues) =>
  `Your previous draft was rejected for unsupported claims: ${describeIssues(issues).join("; ")}. Rewrite it using only facts from the knowledge and the prospect's data, with none of these claims.`;

async function groundedRun(run, check) {
  let result = await run("");
  let grounding = check(result);
  if (!grounding.ok && result.engine !== "rule") {
    try {
      const retry = await run(retryNote(grounding.issues));
      const retryGrounding = check(retry);
      if (retryGrounding.issues.length <= grounding.issues.length) {
        result = { ...retry, regenerated: true };
        grounding = retryGrounding;
      }
    } catch (e) {
      console.warn(`[agentEngine] regeneration after a failed grounding check did not work (${e.message}); keeping the first draft`);
    }
  }
  return { ...result, grounding };
}

export async function scoreICP({ state, campaign, prospect, icpAgent }) {
  const { text, harness, override } = activePromptFor(icpAgent, campaign);
  const knowledge = await retrieve(campaign, `${campaign.icpText} ${campaign.qualificationPrompt}`, 2);

  // Matching before judgment: when the deterministic score is nowhere near the threshold (or a hard
  // exclusion fired) the answer is not in doubt, so an LLM would only confirm it. Only clear REJECTIONS
  // are settled here. A qualification starts real outreach, so it always gets the LLM's read.
  const ruleResult = rule.ruleScoreICP({ campaign, prospect });
  const margin = config.icpShortcutMargin;
  // ...and only when the research notes hold no buying signal that could outweigh a weak profile (the rule
  // engine reads the profile fields, not the notes, so a small company that is hiring must reach the LLM).
  const hasBuyingSignal = (prospect.history || []).some((h) => /hiring|raised|announced|migrat|launch/i.test(h.text || ""));
  const clearCut = margin > 0 && !ruleResult.qualified && ruleResult.score <= ruleResult.threshold - margin && !hasBuyingSignal;
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

export async function draftOutreach({ campaign, prospect, personalisationAgent, channel }) {
  const { text, harness, override } = activePromptFor(personalisationAgent, campaign);
  const knowledge = await retrieve(campaign, `${prospect.company} ${prospect.industry} ${(prospect.reasons || []).join(" ")}`, 2);
  const run = (feedback) => {
    const guided = feedback ? `${override || ""} ${feedback}`.trim() : override;
    return withFallback(
      () => llm.llmDraftOutreach({ campaign, prospect, promptText: text, override: guided, knowledge }),
      () => rule.ruleDraftOutreach({ campaign, prospect, knowledge, override: guided, channel }),
      () => dronahq.dronahqDraftOutreach({ campaign, prospect, promptText: text, override: guided, knowledge }),
      () => gemini.geminiDraftOutreach({ campaign, prospect, promptText: text, override: guided, knowledge, channel })
    );
  };
  const result = await groundedRun(run, (r) => checkGrounding({ text: `${r.subject} ${r.body}`, knowledge, prospect, campaign }));
  return { ...result, harness, retrieved: [...new Set(knowledge.map((k) => k.label))], instruction: override || text };
}

/** Outreach Strategy Agent: the prospect's touch plan. `allowedChannels` are the campaign's channels that are enabled right now. */
export async function planOutreach({ campaign, prospect, strategyAgent, allowedChannels }) {
  const { text, harness, override } = activePromptFor(strategyAgent, campaign);
  const maxTouches = (campaign.cadence && campaign.cadence.maxTouches) || 3;
  const defaultWait = (campaign.cadence && campaign.cadence.waitHours) || 72;
  const args = { campaign, prospect, allowedChannels, maxTouches, defaultWait };
  const result = await withFallback(
    null,
    () => rule.ruleStrategy(args),
    null,
    () => gemini.geminiPlanOutreach({ ...args, promptText: text, override })
  );
  return { ...result, harness, instruction: override || text };
}

// A different angle on each follow-up, so the retrieved fact is new rather than a repeat of the opening message.
const FOLLOWUP_TOPICS = ["customer case study results", "works with existing tools no migration", "security compliance data residency"];

/** Follow-up Agent: the next message for a prospect who has not replied. */
export async function draftFollowUp({ campaign, prospect, followupAgent, channel, touchNumber, isLast }) {
  const { text, harness, override } = activePromptFor(followupAgent, campaign);
  const topic = FOLLOWUP_TOPICS[(touchNumber - 1) % FOLLOWUP_TOPICS.length];
  const knowledge = await retrieve(campaign, `${prospect.industry} ${topic}`, 2);
  const args = { campaign, prospect, knowledge, channel, touchNumber, isLast };
  const run = (feedback) => {
    const guided = feedback ? `${override || ""} ${feedback}`.trim() : override;
    return withFallback(
      null,
      () => rule.ruleFollowUp(args),
      null,
      () => gemini.geminiDraftFollowUp({ ...args, promptText: text, override: guided })
    );
  };
  const result = await groundedRun(run, (r) => checkGrounding({ text: `${r.subject} ${r.body}`, knowledge, prospect, campaign }));
  return { ...result, harness, retrieved: [...new Set(knowledge.map((k) => k.label))], instruction: override || text };
}

export async function handleConversation({ campaign, prospect, conversationAgent }) {
  const { text, harness, override } = activePromptFor(conversationAgent, campaign);
  const lastIn = (prospect.conversation || []).filter((c) => c.dir === "in").slice(-1)[0];
  const knowledge = await retrieve(campaign, lastIn ? lastIn.text : campaign.objective, 2);
  const run = (feedback) => {
    const guided = feedback ? `${override || ""} ${feedback}`.trim() : override;
    return withFallback(
      () => llm.llmHandleConversation({ campaign, prospect, promptText: text, override: guided, knowledge }),
      () => rule.ruleHandleConversation({ campaign, prospect, knowledge }),
      () => dronahq.dronahqHandleConversation({ campaign, prospect, promptText: text, override: guided, knowledge }),
      () => gemini.geminiHandleConversation({ campaign, prospect, promptText: text, override: guided, knowledge })
    );
  };
  const result = await groundedRun(run, (r) => checkGrounding({ text: r.draft || "", knowledge, prospect, campaign, confirmsMeeting: r.action === "meeting" }));
  return { ...result, harness, retrieved: [...new Set(knowledge.map((k) => k.label))], instruction: override || text };
}

export function enrich({ prospect }) {
  return rule.ruleEnrich({ prospect }); // enrichment stays rule-based: it's data lookup, not judgment
}
