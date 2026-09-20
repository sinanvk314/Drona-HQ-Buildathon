// DronaHQ Agentic AI engine. Calls each agent through its Webhook Trigger and returns the same
// shapes llmEngine.js returns, so the scheduler and agentEngine/index.js need no other changes.
//
// How the call works (confirmed by hand against a live agent):
//   POST <webhook url>   header  api-key: <that trigger's key>   body  <JSON payload below>
//   -> 200 {success, thread_id, run_id, message, response}
// KNOWN LIMITATION (found in testing): for our ICP agent the reply did NOT carry the output. With
// the trigger's Response = Standard, `response` came back null even though the run's trace shows
// the correct JSON was produced (Agent End result had only a summary); with Response = None the reply
// was just "Agent run started in background". Your very first call did return text in `response`
// as a STRING (the agent's final message). Where the output does arrive, it is parsed as JSON here,
// tolerating a ```json fence or a sentence around the object. If the agent answered in prose
// instead of JSON, parsing throws, and index.js records the fallback rather than inventing a
// decision.
//
// The agent must return the shared output shape (agent_name, decision, fit_score, evidence,
// handoff_note, ...). Each normaliser below also accepts the backend's native fields
// (qualified/score/action/...) so either style works.
import { config } from "../../config.js";

export class DronaHQError extends Error {}

function webhookFor(agentKey) {
  const w = config.dronahq.webhooks[agentKey];
  if (!w || !w.url) {
    throw new DronaHQError(`no DronaHQ webhook configured for "${agentKey}" (set DRONAHQ_WEBHOOK_${agentKey.toUpperCase()})`);
  }
  return { url: w.url, apiKey: w.apiKey || config.dronahq.apiKey };
}

async function callWebhook(agentKey, body) {
  const { url, apiKey } = webhookFor(agentKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.dronahq.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { "api-key": apiKey } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new DronaHQError(`webhook returned HTTP ${res.status}`);
    let envelope;
    try {
      envelope = await res.json();
    } catch {
      throw new DronaHQError("webhook response was not JSON");
    }
    if (envelope && envelope.success === false) throw new DronaHQError(`webhook reported failure: ${envelope.message || "no message"}`);
    return envelope;
  } catch (e) {
    if (e instanceof DronaHQError) throw e;
    if (e.name === "AbortError") throw new DronaHQError(`timed out after ${config.dronahq.timeoutMs}ms`);
    throw new DronaHQError(`request failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the agent's JSON object out of the webhook envelope. Exported for tests. */
// `text` is the field of DronaHQ's own "Text Response" schema template ({type: "text", text: "..."}).
const OUTPUT_KEYS = ["response", "output", "result", "data", "answer", "text"];
const looksLikeAgentOutput = (o) =>
  o && typeof o === "object" && ["decision", "fit_score", "score", "qualified", "action", "channel", "draft_message"].some((k) => k in o);

// Finds the agent's output inside the webhook reply. Normally it is `response`, but a Standard-schema
// trigger may nest it or use another key, so look in the usual places before giving up. (`message` is
// deliberately not searched: it is DronaHQ's status text, e.g. "Agent run completed successfully".)
function locateOutput(node, depth = 0) {
  if (typeof node === "string") return node.trim() ? node : undefined;
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  if (looksLikeAgentOutput(node)) return node;
  if (depth > 2) return undefined;
  for (const key of OUTPUT_KEYS) {
    if (key in node) {
      const found = locateOutput(node[key], depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

// A short, safe description of a reply (long strings clipped) for error messages, so a failure says
// what the webhook actually returned instead of guessing.
function describe(value, depth = 0) {
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  if (Array.isArray(value)) return depth > 2 ? "[…]" : value.slice(0, 3).map((v) => describe(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 2) return "{…}";
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, describe(v, depth + 1)]));
  }
  return value;
}

export function parseAgentOutput(envelope) {
  const out = locateOutput(envelope);
  if (out === undefined) {
    throw new DronaHQError(`no agent output found in the webhook reply. Reply was: ${JSON.stringify(describe(envelope)).slice(0, 700)}`);
  }
  if (typeof out === "object") return out;
  const text = out.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new DronaHQError(`agent answered in prose, not JSON: "${out.slice(0, 120).replace(/\s+/g, " ")}"`);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new DronaHQError(`agent JSON did not parse: ${e.message}`);
  }
}

const toInt = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);
const toArray = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

/** Shared shape (decision/fit_score) or native shape (qualified/score) -> scheduler's ICP result. */
export function normalizeICP(o) {
  const score = toInt(o.score ?? o.fit_score);
  if (score === null) throw new DronaHQError("ICP output has no score/fit_score");
  const decision = typeof o.decision === "string" ? o.decision.trim() : "";
  let qualified;
  if (typeof o.qualified === "boolean") qualified = o.qualified;
  else if (decision) qualified = /^qualif/i.test(decision);
  else throw new DronaHQError("ICP output has neither `qualified` nor `decision`");
  // The scheduler has no "escalate" path for ICP, so an Escalate is recorded as not-qualified but
  // labelled, so a human reading the Decision Journal can see the agent wanted a human.
  const escalated = /^escalat/i.test(decision);
  const reasoning = o.reasoning || o.handoff_note || "";
  return {
    qualified,
    score,
    reasoning: escalated ? `[Agent escalated] ${reasoning}`.trim() : reasoning,
    reasons: toArray(o.reasons ?? o.evidence),
    evidence: toArray(o.evidence),
  };
}

/** -> {channel, subject, body, reasoning}. Enforces enabled channels: a hard constraint, not an agent choice. */
export function normalizeDraft(o, campaign) {
  const draft = o.draft_message ?? o.draft;
  let subject = o.subject;
  let body = o.body;
  if (typeof draft === "string") body = body ?? draft;
  else if (draft && typeof draft === "object") {
    subject = subject ?? draft.subject;
    body = body ?? draft.body ?? draft.message;
  }
  if (!body || typeof body !== "string") throw new DronaHQError("draft output has no message body");
  const channel = String(o.channel || "").trim().toLowerCase();
  if (!channel) throw new DronaHQError("draft output has no channel");
  if (!(campaign.channels || []).includes(channel)) {
    throw new DronaHQError(`agent chose channel "${channel}", which is not enabled for this campaign`);
  }
  return { channel, subject: subject || "(no subject)", body, reasoning: o.reasoning || o.handoff_note || "" };
}

/** -> {action: meeting|escalate|followup, reasoning}. */
export function normalizeConversation(o) {
  let action = typeof o.action === "string" ? o.action.trim().toLowerCase() : "";
  if (!["meeting", "escalate", "followup"].includes(action)) {
    const text = `${o.decision || ""} ${o.final_action || ""}`.toLowerCase();
    action = /escalat/.test(text) ? "escalate" : /meeting|book|schedul/.test(text) ? "meeting" : /follow/.test(text) ? "followup" : "";
  }
  if (!action) throw new DronaHQError("conversation output has no recognisable action");
  return { action, reasoning: o.reasoning || o.handoff_note || "" };
}

// ---- payloads ---------------------------------------------------------------------------------
// The agent reads its whole input as {{body}}, so these keys are what its Instructions can reference
// (e.g. {{body.person.title}}, {{body.campaign.icp}}, {{body.dossier}}).

export const personAndCompany = (p) => ({
  person: { name: p.name, title: p.title, email: p.email },
  company: { name: p.company, industry: p.industry, size: p.size, funding: p.funding, tech: p.tech, city: p.city },
});

export const campaignBlock = (c) => ({
  id: c.id,
  name: c.name,
  icp: c.icpText,
  company_criteria: c.companyCriteria,
  exclusion_criteria: c.exclusionCriteria,
  qualification_prompt: c.qualificationPrompt,
  personas: c.personas,
  geography: c.geography,
  channels: c.channels,
  approvals: c.approvals,
});

// Best-effort dossier from what the backend keeps on the prospect (its prior qualification and
// activity history), in the shared entry shape.
export function dossierFor(p) {
  const entries = [];
  if (p.qual && p.qual.status && p.qual.status !== "Pending") {
    entries.push({ agent_name: p.qual.agent, harness_version: p.qual.harness, decision: p.qual.status, handoff_note: p.qual.reasoning });
  }
  for (const h of p.history || []) entries.push({ agent_name: "activity", decision: h.text });
  return entries;
}

export const knowledgePayload = (knowledge) => (knowledge || []).map((k) => ({ label: k.label, text: k.text }));

export async function dronahqScoreICP({ campaign, prospect, promptText, knowledge }) {
  const envelope = await callWebhook("icp", {
    ...personAndCompany(prospect),
    campaign: campaignBlock(campaign),
    dossier: dossierFor(prospect),
    instruction: promptText,
    knowledge: knowledgePayload(knowledge),
  });
  return normalizeICP(parseAgentOutput(envelope));
}

export async function dronahqDraftOutreach({ campaign, prospect, promptText, override, knowledge }) {
  const envelope = await callWebhook("personalisation", {
    ...personAndCompany(prospect),
    campaign: campaignBlock(campaign),
    dossier: dossierFor(prospect),
    instruction: promptText,
    campaign_override: override || null,
    knowledge: knowledgePayload(knowledge),
  });
  return normalizeDraft(parseAgentOutput(envelope), campaign);
}

export async function dronahqHandleConversation({ campaign, prospect, promptText, override, knowledge }) {
  const envelope = await callWebhook("conversation", {
    ...personAndCompany(prospect),
    campaign: campaignBlock(campaign),
    dossier: dossierFor(prospect),
    conversation: prospect.conversation || [],
    instruction: promptText,
    campaign_override: override || null,
    knowledge: knowledgePayload(knowledge),
  });
  return normalizeConversation(parseAgentOutput(envelope));
}
