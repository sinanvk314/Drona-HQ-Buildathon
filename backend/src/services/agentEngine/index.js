// Single seam the scheduler and routes call through — dispatches to the real LLM engine
// (PS Section 4's "Agentic AI") when configured, and always falls back to the deterministic
// rule engine so the backend runs end to end with zero setup. See ruleEngine.js / llmEngine.js.
import { isLlmMode } from "../../config.js";
import * as rule from "./ruleEngine.js";
import * as llm from "./llmEngine.js";
import { retrieve } from "../rag.js";

function activePromptFor(agent, campaignId) {
  const active = agent.versions.find((v) => v.status === "active") || agent.versions[0];
  const override = agent.overrides.find((o) => o.campaignId === campaignId);
  return { text: active ? active.text : "", harness: active ? active.version : "v0", override: override ? override.text : null };
}

async function withFallback(llmCall, ruleCall) {
  if (isLlmMode()) {
    try {
      return { ...(await llmCall()), engine: "llm" };
    } catch (e) {
      console.warn("[agentEngine] LLM call failed, falling back to rule engine:", e.message);
    }
  }
  return { ...ruleCall(), engine: "rule" };
}

export async function scoreICP({ state, campaign, prospect, icpAgent }) {
  const { text, harness, override } = activePromptFor(icpAgent, campaign.id);
  const knowledge = retrieve(campaign, `${campaign.icpText} ${campaign.qualificationPrompt}`, 2);
  const result = await withFallback(
    () => llm.llmScoreICP({ campaign, prospect, promptText: text, knowledge }),
    () => rule.ruleScoreICP({ campaign, prospect })
  );
  return { ...result, harness, retrieved: knowledge.map((k) => k.label), instruction: override || text };
}

export async function draftOutreach({ campaign, prospect, personalisationAgent }) {
  const { text, harness, override } = activePromptFor(personalisationAgent, campaign.id);
  const knowledge = retrieve(campaign, `${prospect.company} ${prospect.industry} ${(prospect.reasons || []).join(" ")}`, 2);
  const result = await withFallback(
    () => llm.llmDraftOutreach({ campaign, prospect, promptText: text, override, knowledge }),
    () => rule.ruleDraftOutreach({ campaign, prospect, knowledge, override })
  );
  return { ...result, harness, retrieved: knowledge.map((k) => k.label), instruction: override || text };
}

export async function handleConversation({ campaign, prospect, conversationAgent }) {
  const { text, harness, override } = activePromptFor(conversationAgent, campaign.id);
  const lastIn = (prospect.conversation || []).filter((c) => c.dir === "in").slice(-1)[0];
  const knowledge = retrieve(campaign, lastIn ? lastIn.text : campaign.objective, 2);
  const result = await withFallback(
    () => llm.llmHandleConversation({ campaign, prospect, promptText: text, override, knowledge }),
    () => rule.ruleHandleConversation({ campaign, prospect })
  );
  return { ...result, harness, retrieved: knowledge.map((k) => k.label), instruction: override || text };
}

export function enrich({ prospect }) {
  return rule.ruleEnrich({ prospect }); // enrichment stays rule-based: it's data lookup, not judgment
}
