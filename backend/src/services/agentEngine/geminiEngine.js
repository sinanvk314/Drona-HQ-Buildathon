// Google Gemini engine: the same three agents as dronahqEngine.js, but the model call is made
// directly, and Gemini's structured-output mode (responseMimeType + responseSchema) makes the API
// itself return JSON in our exact shape, which is more predictable than hoping a prompt is obeyed.
//
// It reuses dronahqEngine's payload builders and normalisers, so both engines feed the scheduler
// identical shapes, and the same checks apply (for example a drafted channel must be enabled for
// the campaign: it is enforced in the response schema AND again after parsing).
//
// Free tier is roughly 15 requests/minute, so calls are throttled client-side (GEMINI_RPM). Any
// failure (missing key, 429, timeout, blocked or malformed output) throws; agentEngine/index.js
// then moves to the next engine in the AGENT_ENGINE chain, ending at the rule engine.
import { config, geminiModels } from "../../config.js";
import { capReached, recordLlmCall } from "../usage.js";
import {
  campaignBlock,
  dossierFor,
  knowledgePayload,
  normalizeConversation,
  normalizeDraft,
  normalizeICP,
  parseAgentOutput,
  personAndCompany,
} from "./dronahqEngine.js";

export class GeminiError extends Error {
  // retryable: a temporary failure worth retrying on the SAME model ("high demand", or a 429 that carries a
  // Retry-After hint). retryAfterMs: Google's Retry-After. switchModel: this model is the problem (quota used
  // up, retired, or overloaded past the retries), so the NEXT model in GEMINI_MODEL is worth trying.
  constructor(message, { retryable = false, retryAfterMs, switchModel = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.switchModel = switchModel;
  }
}

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- prompts ----------------------------------------------------------------------------------

const ICP_SYSTEM = `You are the ICP Fitment Agent in an autonomous SDR pipeline. You judge whether ONE prospect fits a campaign's Ideal Customer Profile. You do not write messages or contact anyone.

The user message is a JSON object with: person, company, campaign (icp, company_criteria, exclusion_criteria, qualification_prompt, personas, geography), dossier (entries written by earlier agents), knowledge (retrieved documents), and optionally instruction and campaign_override. Follow instruction and campaign_override where they do not contradict the rules below.

Rules:
1. Use ONLY facts present in the input. If a fact is missing, treat it as unknown. Never invent employee counts, funding, titles, tech stack, hiring activity, news, customer status or competitor status.
2. Read the whole dossier first. Do not re-run conflict or suppression checks; use what the dossier says.
3. If ANY campaign.exclusion_criteria is supported by evidence in the input (already a customer, a competitor, contacted by another campaign recently), decision is "Rejected" regardless of score.
4. Score 0-100 as an integer: role and persona match (0-35), company size and industry fit (0-30), buying signals (0-25), dossier corroboration (0-10). Award no points for information that is not present.
5. Follow campaign.qualification_prompt for the qualify threshold. If it states none, 70 or above is "Qualified" and below is "Rejected".
6. Use "Escalate" only when a critical fact is missing or the evidence is genuinely ambiguous. Even then give your best-estimate integer fit_score.
7. qualified is true only when decision is "Qualified". final_action is advance_to_outreach, close_prospect or escalate_to_human for Qualified, Rejected or Escalate. score equals fit_score.
8. evidence lists concrete facts from the input only. reasoning is 2-3 sentences. handoff_note is 1-2 sentences for the next agent. agent_name is "ICP Fitment Agent" and harness_version is "icp-gemini-v1". conflict_check is what the dossier says about conflicts, or "not in dossier". retrieved_knowledge lists labels of any knowledge you used, else [].`;

const PERSONALISATION_SYSTEM = `You are the Personalisation & Outreach Strategy agent in an autonomous SDR pipeline. For ONE qualified prospect you choose the best channel and draft a short, specific first message. You never send anything: a human approves every draft.

The user message is a JSON object with: person, company, campaign (channels, personas, icp, approvals), dossier, knowledge, and optionally instruction and campaign_override (tone or length rules: follow them).

Rules:
1. channel must be one of campaign.channels.
2. Reference exactly one real fact about the prospect or company that appears in the input. Never invent details, numbers, customers or claims. Make product claims only if they appear in knowledge.
3. Unless an override says otherwise: under 90 words, plain and specific, no hype. Give a short subject line.
4. Do not quote prices and do not make security or compliance commitments. Do not propose specific meeting times.
5. reasoning is 1-2 sentences on why this channel and angle.`;

const CONVERSATION_SYSTEM = `You are the Conversation & Follow-up agent in an autonomous SDR pipeline. A prospect has replied; decide the next action.

The user message is a JSON object with: person, company, campaign (approvals), dossier, conversation (messages, dir "in" for the prospect and "out" for us), knowledge, and optionally instruction and campaign_override.

action must be exactly one of:
- "escalate": any pricing, security, compliance, legal or data-residency question or objection; anything you cannot answer from knowledge; a hostile or unclear reply.
- "meeting": the prospect clearly wants a call or a meeting.
- "followup": interest or a question that knowledge lets you answer safely.
Never commit to anything that is not in knowledge. reasoning is 1-2 sentences.`;

// ---- response schemas (Gemini's OpenAPI-subset; upper-case type names) --------------------------

const S = { type: "STRING" };
const strings = { type: "ARRAY", items: S };

const ICP_SCHEMA = {
  type: "OBJECT",
  properties: {
    agent_name: S,
    harness_version: S,
    decision: { type: "STRING", enum: ["Qualified", "Rejected", "Escalate"] },
    qualified: { type: "BOOLEAN" },
    fit_score: { type: "INTEGER" },
    score: { type: "INTEGER" },
    reasoning: S,
    reasons: strings,
    evidence: strings,
    retrieved_knowledge: strings,
    campaign_instruction_excerpt: S,
    conflict_check: S,
    final_action: { type: "STRING", enum: ["advance_to_outreach", "close_prospect", "escalate_to_human"] },
    handoff_note: S,
  },
  required: ["agent_name", "decision", "qualified", "fit_score", "score", "reasoning", "reasons", "evidence", "final_action", "handoff_note"],
};

// The channel enum is built per campaign, so "a disabled channel" cannot even be produced.
const draftSchema = (campaign) => ({
  type: "OBJECT",
  properties: { channel: { type: "STRING", enum: campaign.channels }, subject: S, body: S, reasoning: S },
  required: ["channel", "subject", "body", "reasoning"],
});

const CONVERSATION_SCHEMA = {
  type: "OBJECT",
  properties: { action: { type: "STRING", enum: ["meeting", "escalate", "followup"] }, reasoning: S },
  required: ["action", "reasoning"],
};

// ---- transport --------------------------------------------------------------------------------

let nextSlot = 0; // earliest time the next request may start
async function throttle() {
  const gap = 60000 / Math.max(1, config.gemini.rpm);
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + gap;
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
}

async function generateOnce({ system, input, schema }, model) {
  const g = config.gemini;
  if (!g.apiKey) throw new GeminiError("GEMINI_API_KEY is not set");
  if (capReached()) throw new GeminiError(`daily LLM call cap reached (LLM_DAILY_CALL_CAP=${config.llmDailyCallCap})`);
  await throttle();
  recordLlmCall(model); // every request counts against Google's quota, retries included

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), g.timeoutMs);
  try {
    const res = await fetch(`${g.baseUrl}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": g.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
      }),
      signal: controller.signal,
    });
    if (res.status === 429) {
      const seconds = Number(res.headers.get("retry-after"));
      // Google's own explanation says whether it is the per-minute or the daily quota, which matters.
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
      const hint = Number.isFinite(seconds) && seconds > 0;
      // A 429 with a Retry-After is a per-minute burst: wait and retry this model. Without one it is almost
      // always the model's quota being used up, which waiting won't fix, so move on to the next model.
      throw new GeminiError(`[${model}] rate limited (HTTP 429): ${detail || "slow down or wait for the quota to reset"}`, {
        retryable: hint,
        retryAfterMs: hint ? Math.min(seconds * 1000, 30000) : undefined,
        switchModel: true,
      });
    }
    if (!res.ok) {
      throw new GeminiError(`[${model}] HTTP ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 200)}`, {
        retryable: RETRYABLE_STATUSES.has(res.status),
        // A retired model (404) or a model still overloaded after the retries: try the next one.
        switchModel: res.status === 404 || RETRYABLE_STATUSES.has(res.status),
      });
    }

    const data = await res.json();
    if (data?.promptFeedback?.blockReason) throw new GeminiError(`request blocked: ${data.promptFeedback.blockReason}`);
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text.trim()) throw new GeminiError(`empty response (finishReason: ${data?.candidates?.[0]?.finishReason || "unknown"})`);
    return parseAgentOutput(text);
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (e.name === "AbortError") throw new GeminiError(`timed out after ${g.timeoutMs}ms`);
    if (e.constructor?.name === "DronaHQError") throw e; // a parse problem, already worded clearly
    throw new GeminiError(`request failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Retries temporary failures a few times with a growing pause, so a passing "high demand" blip does not
// push a decision to the next engine. Permanent failures (bad key, 404 model, blocked, bad JSON) throw at once.
async function generateWithRetries(args, model) {
  const g = config.gemini;
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateOnce(args, model);
    } catch (e) {
      if (!(e instanceof GeminiError) || !e.retryable || attempt >= g.retries) throw e;
      await sleep(e.retryAfterMs ?? g.retryDelayMs * (attempt + 1));
    }
  }
}

// GEMINI_MODEL can list several models ("a,b"): free-tier quotas are PER MODEL, so when one is used up,
// retired or overloaded the next still works. Only failures that are about the model move on; a bad key,
// a blocked request or unparseable output would fail the same way everywhere, so they throw at once.
async function generate(args) {
  const models = geminiModels();
  const failures = [];
  for (let i = 0; i < models.length; i++) {
    try {
      return await generateWithRetries(args, models[i]);
    } catch (e) {
      if (!(e instanceof GeminiError) || !e.switchModel) throw e;
      failures.push(e.message);
      if (i === models.length - 1) throw new GeminiError(failures.join(" | "));
    }
  }
  throw new GeminiError("no Gemini model configured (set GEMINI_MODEL)");
}

// ---- the three agents -------------------------------------------------------------------------

const baseInput = (campaign, prospect, promptText, knowledge) => ({
  ...personAndCompany(prospect),
  campaign: campaignBlock(campaign),
  dossier: dossierFor(prospect),
  instruction: promptText,
  knowledge: knowledgePayload(knowledge),
});

export async function geminiScoreICP({ campaign, prospect, promptText, knowledge }) {
  const out = await generate({ system: ICP_SYSTEM, input: baseInput(campaign, prospect, promptText, knowledge), schema: ICP_SCHEMA });
  return normalizeICP(out);
}

export async function geminiDraftOutreach({ campaign, prospect, promptText, override, knowledge }) {
  const input = { ...baseInput(campaign, prospect, promptText, knowledge), campaign_override: override || null };
  const out = await generate({ system: PERSONALISATION_SYSTEM, input, schema: draftSchema(campaign) });
  return normalizeDraft(out, campaign);
}

export async function geminiHandleConversation({ campaign, prospect, promptText, override, knowledge }) {
  const input = {
    ...baseInput(campaign, prospect, promptText, knowledge),
    conversation: prospect.conversation || [],
    campaign_override: override || null,
  };
  const out = await generate({ system: CONVERSATION_SYSTEM, input, schema: CONVERSATION_SCHEMA });
  return normalizeConversation(out);
}
