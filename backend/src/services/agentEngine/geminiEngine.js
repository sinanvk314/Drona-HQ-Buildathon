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
import { capReached, recordLlmCall, recordLlmUsage } from "../usage.js";
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

const CONVERSATION_SYSTEM = `You are the Conversation & Follow-up agent in an autonomous SDR pipeline. A prospect has replied; decide the next action and draft the reply.

The user message is a JSON object with: person, company, campaign (approvals), dossier, conversation (messages, dir "in" for the prospect and "out" for us), knowledge, and optionally instruction and campaign_override.

action must be exactly one of:
- "escalate": any pricing, security, compliance, legal or data-residency question or objection; anything you cannot answer from knowledge; a hostile or unclear reply.
- "meeting": the prospect clearly wants a call or a meeting.
- "followup": interest or a question that knowledge lets you answer safely.
Never commit to anything that is not in knowledge. reasoning is 1-2 sentences.

reply_draft is the message to send back, in the voice of a helpful SDR, under 90 words, using only facts in knowledge or the prospect data. For "meeting", confirm interest and offer to arrange a time without inventing specific times. For "escalate", write a brief holding reply for a human to edit: acknowledge the question, say a specialist will follow up, and make no commitment, quote no price and claim no certification. Never invent numbers, customers or claims.`;

const STRATEGY_SYSTEM = `You are the Outreach Strategy agent in an autonomous SDR pipeline. For ONE qualified prospect you plan the touch sequence: which channels, in what order, and how many hours to wait between touches. You do not write messages.

The user message is a JSON object with: person, company, campaign (channels, personas, icp), dossier, knowledge, constraints (allowed_channels, max_touches, default_wait_hours), and optionally instruction and campaign_override.

Rules:
1. sequence lists one channel per touch, in order. Every channel must be one of constraints.allowed_channels; never use any other. Use at most constraints.max_touches touches. A channel may repeat (a later email after a LinkedIn message).
2. Lead with the channel this person is most likely to answer on, from their role and seniority: founders and CEOs are reachable on LinkedIn; CTOs, CIOs and risk leaders usually expect a considered email; regulated-industry leaders prefer email over SMS.
3. SMS is never the first touch and is used only as a later, short nudge. Voice, if allowed, is the last touch.
4. wait_hours is the pause between touches, an integer from 24 to 168. Use constraints.default_wait_hours unless the prospect's role or region suggests longer or shorter.
5. reasoning is 1-2 sentences naming the facts you used. Use only facts present in the input.`;

const FOLLOWUP_SYSTEM = `You are the Follow-up agent in an autonomous SDR pipeline. A contacted prospect has not replied. You write ONE follow-up for the next channel in their plan. You never send anything: a human approves it or a policy does.

The user message is a JSON object with: person, company, campaign, dossier, knowledge, conversation (the earlier messages; dir "out" is ours), follow_up (channel, touch_number, is_last_touch), and optionally instruction and campaign_override.

Rules:
1. Write for follow_up.channel. Under 90 words for email, under 60 for LinkedIn, SMS or voice notes. A subject line only for email, otherwise a short label.
2. Add ONE new, relevant fact that is in knowledge or the prospect data, and do not repeat any earlier message or its opening. Do not apologise for writing, guilt-trip, or say "just checking in".
3. Never invent details, numbers, customers or claims; make product claims only if they appear in knowledge. No prices, no security or compliance commitments, no specific meeting times.
4. If is_last_touch is true, close the loop politely: say this is the last note and leave the door open.
5. angle is 2-6 words naming the new fact you used. reasoning is 1-2 sentences.`;

const RESEARCH_SYSTEM = `You are the Research agent in an autonomous SDR pipeline. You turn what is KNOWN about ONE prospect into a structured brief for the agents that write to them. You do NOT search and you do NOT know anything beyond the input.

The user message is a JSON object with: person, company (the organisation), attributes, campaign (objective, offer, icp), dossier (facts and notes already recorded), knowledge, and optionally instruction.

Rules:
1. Use ONLY facts present in the input. Never invent a fact, number, event, achievement or connection. If something is not in the input, it is unknown.
2. facts: restate the important known facts, each classified as profile (who they are), signal (a reason to reach out now) or context (background). Each fact must be traceable to the input.
3. hooks: up to 3 reasons this person might care about the campaign's offer, each grounded in a fact from the input. If nothing in the input gives a reason, return fewer hooks rather than inventing one.
4. gaps: up to 4 important things we do not know that would help (for example whether they decide on this, or recent activity).
5. summary is 2 sentences. confidence is low, medium or high, by how much is actually known. reasoning is 1 sentence.`;

const SOURCE_SYSTEM = `You are a people-search tool, imitating a search of a professional network or lead database. Given a description of a target audience, you return candidate people who match it. This tool is a stand-in used before real data sources are connected.

IMPORTANT: every person and organisation you return must be FICTIONAL. Invent plausible names. Never return a real, famous or identifiable person, and never a real small organisation. Email addresses must end in ".example".

The user message is a JSON object with: campaign (name, objective, offer, icp, personas, geography, company_criteria, exclusion_criteria), count, and avoid (names already returned).

Rules:
1. Return exactly count candidates. Most should match the audience closely; one or two should be near misses (a different seniority, size or region), as a real search would return.
2. Vary them: different seniority, organisation size, region and situation. Do not repeat names or organisations, and do not use anything in avoid.
3. Fit the audience even when it is not a company: if it is students, return students with their college and club; if it is doctors, clinics; and so on. organisation is the college, club, clinic or company.
4. facts: 2 to 4 short, specific, plausible facts about each person (a role held, an activity, something recent). attributes: any other useful key/value details (for example college, year, club).
5. size describes the organisation in plain words (for example "120 employees" or "about 3,000 students").`;

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

// The channel enum is built per campaign (and narrowed to the planned channel), so "a disabled channel" cannot even
// be produced.
const draftSchema = (campaign, channel) => ({
  type: "OBJECT",
  properties: { channel: { type: "STRING", enum: channel ? [channel] : campaign.channels }, subject: S, body: S, reasoning: S },
  required: ["channel", "subject", "body", "reasoning"],
});

const CONVERSATION_SCHEMA = {
  type: "OBJECT",
  properties: { action: { type: "STRING", enum: ["meeting", "escalate", "followup"] }, reasoning: S, reply_draft: S },
  required: ["action", "reasoning", "reply_draft"],
};

const RESEARCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: S,
    facts: { type: "ARRAY", items: { type: "OBJECT", properties: { text: S, kind: { type: "STRING", enum: ["profile", "signal", "context"] } }, required: ["text", "kind"] } },
    hooks: strings,
    gaps: strings,
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    reasoning: S,
  },
  required: ["summary", "facts", "hooks", "gaps", "confidence", "reasoning"],
};

const SOURCE_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: S, title: S, organisation: S, email: S, industry: S, size: S, location: S, facts: strings,
          attributes: { type: "ARRAY", items: { type: "OBJECT", properties: { key: S, value: S }, required: ["key", "value"] } },
        },
        required: ["name", "title", "organisation", "email", "industry", "size", "location", "facts"],
      },
    },
  },
  required: ["candidates"],
};

const strategySchema = (allowed, maxTouches) => ({
  type: "OBJECT",
  properties: {
    sequence: { type: "ARRAY", items: { type: "STRING", enum: allowed }, minItems: 1, maxItems: maxTouches },
    wait_hours: { type: "INTEGER" },
    reasoning: S,
  },
  required: ["sequence", "wait_hours", "reasoning"],
});

const FOLLOWUP_SCHEMA = {
  type: "OBJECT",
  properties: { subject: S, body: S, angle: S, reasoning: S },
  required: ["subject", "body", "angle", "reasoning"],
};

/** Turns the model's plan into a safe one: only allowed channels, within the touch limit, sane wait. */
export function normalizePlan(o, { allowed, maxTouches, defaultWait }) {
  const sequence = (Array.isArray(o.sequence) ? o.sequence : [])
    .map((c) => String(c).trim().toLowerCase())
    .filter((c) => allowed.includes(c))
    .slice(0, maxTouches);
  if (!sequence.length) throw new GeminiError("strategy output has no usable channel in its sequence");
  const wait = Math.round(Number(o.wait_hours));
  const waitHours = Number.isFinite(wait) ? Math.min(168, Math.max(24, wait)) : defaultWait;
  return { sequence, waitHours, reasoning: o.reasoning || "" };
}

export function normalizeFollowUp(o) {
  if (!o.body || typeof o.body !== "string") throw new GeminiError("follow-up output has no message body");
  return { subject: o.subject || "Following up", body: o.body, angle: o.angle || "", reasoning: o.reasoning || "" };
}

// ---- transport --------------------------------------------------------------------------------

let nextSlot = 0; // earliest time the next request may start
async function throttle() {
  const gap = 60000 / Math.max(1, config.gemini.rpm);
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + gap;
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
}

async function generateOnce({ system, input, schema, agent, campaignId }, model) {
  const g = config.gemini;
  if (!g.apiKey) throw new GeminiError("GEMINI_API_KEY is not set");
  if (capReached()) throw new GeminiError(`daily LLM call cap reached (LLM_DAILY_CALL_CAP=${config.llmDailyCallCap})`);
  await throttle();
  recordLlmCall(model); // every request counts against Google's quota, retries included
  const startedAt = Date.now();

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
    const output = parseAgentOutput(text);
    // Only a request that produced usable output counts as an agent decision; tokens and latency feed the cost figures.
    recordLlmUsage({ agent, campaignId, tokensIn: data?.usageMetadata?.promptTokenCount, tokensOut: data?.usageMetadata?.candidatesTokenCount, ms: Date.now() - startedAt });
    return output;
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

const slug = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "unknown";

/** A research brief made safe to store: bounded, and only strings. */
export function normalizeResearch(o) {
  const strs = (a, n) => (Array.isArray(a) ? a : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, n);
  const facts = (Array.isArray(o.facts) ? o.facts : [])
    .map((f) => ({ text: String((f && f.text) || "").trim(), kind: ["profile", "signal", "context"].includes(f && f.kind) ? f.kind : "context" }))
    .filter((f) => f.text)
    .slice(0, 10);
  if (!facts.length && !o.summary) throw new GeminiError("research output has no facts and no summary");
  return { summary: String(o.summary || "").trim(), facts, hooks: strs(o.hooks, 3), gaps: strs(o.gaps, 4), confidence: ["low", "medium", "high"].includes(o.confidence) ? o.confidence : "low", reasoning: String(o.reasoning || "").trim() };
}

/** Candidates from the imitated search: fictional by construction, so emails are forced onto the reserved .example domain. */
export function normalizeCandidates(o, { count, avoid = [] }) {
  const seen = new Set(avoid.map((n) => String(n).toLowerCase()));
  const out = [];
  for (const c of Array.isArray(o.candidates) ? o.candidates : []) {
    const name = String((c && c.name) || "").trim();
    const org = String((c && c.organisation) || "").trim();
    if (!name || !org || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const [first, ...rest] = name.split(/\s+/);
    const email = /@[^\s]+\.example$/i.test(c.email || "") ? c.email.trim().toLowerCase() : `${slug(first)}.${slug(rest.join("")) || "x"}@${slug(org)}.example`;
    out.push({
      name, title: String(c.title || "").trim(), company: org, email, industry: String(c.industry || "").trim(), size: String(c.size || "").trim(), city: String(c.location || "").trim(),
      facts: (Array.isArray(c.facts) ? c.facts : []).map((f) => String(f || "").trim()).filter(Boolean).slice(0, 4),
      attributes: Object.fromEntries((Array.isArray(c.attributes) ? c.attributes : []).filter((a) => a && a.key && a.value).slice(0, 6).map((a) => [String(a.key).trim(), String(a.value).trim()])),
    });
    if (out.length >= count) break;
  }
  if (!out.length) throw new GeminiError("the search returned no usable candidates");
  return out;
}

// ---- the agents -------------------------------------------------------------------------

const baseInput = (campaign, prospect, promptText, knowledge) => ({
  ...personAndCompany(prospect),
  attributes: prospect.attributes || {},
  campaign: campaignBlock(campaign),
  dossier: dossierFor(prospect),
  instruction: promptText,
  knowledge: knowledgePayload(knowledge),
});

export async function geminiScoreICP({ campaign, prospect, promptText, knowledge }) {
  const out = await generate({ agent: "icp", campaignId: campaign.id, system: ICP_SYSTEM, input: baseInput(campaign, prospect, promptText, knowledge), schema: ICP_SCHEMA });
  return normalizeICP(out);
}

export async function geminiDraftOutreach({ campaign, prospect, promptText, override, knowledge, channel }) {
  const input = { ...baseInput(campaign, prospect, promptText, knowledge), campaign_override: override || null };
  const out = await generate({ agent: "personalisation", campaignId: campaign.id, system: PERSONALISATION_SYSTEM, input, schema: draftSchema(campaign, channel) });
  return normalizeDraft(out, campaign);
}

export async function geminiPlanOutreach({ campaign, prospect, promptText, override, allowedChannels, maxTouches, defaultWait }) {
  const input = {
    ...baseInput(campaign, prospect, promptText, []),
    constraints: { allowed_channels: allowedChannels, max_touches: maxTouches, default_wait_hours: defaultWait },
    campaign_override: override || null,
  };
  const out = await generate({ agent: "strategy", campaignId: campaign.id, system: STRATEGY_SYSTEM, input, schema: strategySchema(allowedChannels, maxTouches) });
  return normalizePlan(out, { allowed: allowedChannels, maxTouches, defaultWait });
}

export async function geminiDraftFollowUp({ campaign, prospect, promptText, override, knowledge, channel, touchNumber, isLast }) {
  const input = {
    ...baseInput(campaign, prospect, promptText, knowledge),
    conversation: prospect.conversation || [],
    follow_up: { channel, touch_number: touchNumber, is_last_touch: !!isLast },
    campaign_override: override || null,
  };
  const out = await generate({ agent: "followup", campaignId: campaign.id, system: FOLLOWUP_SYSTEM, input, schema: FOLLOWUP_SCHEMA });
  return normalizeFollowUp(out);
}

export async function geminiHandleConversation({ campaign, prospect, promptText, override, knowledge }) {
  const input = {
    ...baseInput(campaign, prospect, promptText, knowledge),
    conversation: prospect.conversation || [],
    campaign_override: override || null,
  };
  const out = await generate({ agent: "conversation", campaignId: campaign.id, system: CONVERSATION_SYSTEM, input, schema: CONVERSATION_SCHEMA });
  return normalizeConversation(out);
}

export async function geminiResearch({ campaign, prospect, promptText, override, knowledge }) {
  const input = { ...baseInput(campaign, prospect, promptText, knowledge), campaign_override: override || null };
  const out = await generate({ agent: "research", campaignId: campaign.id, system: RESEARCH_SYSTEM, input, schema: RESEARCH_SCHEMA });
  return normalizeResearch(out);
}

export async function geminiSourceProspects({ campaign, count, avoid = [] }) {
  const input = { campaign: { ...campaignBlock(campaign), company_criteria: campaign.companyCriteria, exclusion_criteria: campaign.exclusionCriteria }, count, avoid };
  const out = await generate({ agent: "lead", campaignId: campaign.id, system: SOURCE_SYSTEM, input, schema: SOURCE_SCHEMA });
  return normalizeCandidates(out, { count, avoid });
}
