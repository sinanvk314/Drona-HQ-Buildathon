// Checks a customer-facing draft against what the agent was actually given, after the model has written it.
// Prompt rules say "never invent a number, customer or claim"; this is the check that they held. It is deliberately
// narrow and deterministic (no LLM): it looks for the kinds of claim that do damage when made up.
//
//   - a figure (23%, $0.02/GB, 60 days) that appears in neither the retrieved knowledge nor the prospect's own data
//   - a compliance or certification claim (SOC 2, ISO 27001, HIPAA, "RBI compliant", "guaranteed") that the knowledge
//     does not make
//   - a price quoted in a draft at all (pricing goes through a human)
//   - a specific meeting time in a message that is not confirming a meeting
//
// A draft that fails cannot be auto-sent: it goes to the Approvals queue with the issues listed.

const CERT_TERMS = [
  /\bsoc\s?2(?:\s+type\s+(?:i{1,2}|1|2))?\b/i,
  /\biso\s?27001\b/i,
  /\bhipaa\b/i,
  /\bgdpr\b/i,
  /\bpci(?:[-\s]?dss)?\b/i,
  /\bfedramp\b/i,
  /\b(?:rbi|irdai|sebi)[-\s]?(?:certified|compliant|approved|regulated)\b/i,
  /\bcertified\b/i,
  /\bguarantee[sd]?\b/i,
];

const FIGURE = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?\/\s?\w+)?|\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?(?:x|days?|weeks?|months?)\b/gi;
const PRICE = /\$\s?\d/;
const MEETING_TIME = /\b(?:mon|tues|wednes|thurs|fri)day\b[^.]{0,30}\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\bat\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;

const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ");
const compact = (t) => norm(t).replace(/\s/g, "");

/** The text the agent was entitled to draw facts from. */
function allowedText({ knowledge = [], prospect = {}, campaign = {} }) {
  const parts = [
    ...knowledge.map((k) => k.text),
    prospect.name, prospect.title, prospect.company, prospect.industry, prospect.size, prospect.funding, prospect.city,
    ...(prospect.tech || []), ...(prospect.reasons || []), ...(prospect.evidence || []),
    ...(prospect.history || []).map((h) => h.text),
    ...(prospect.conversation || []).map((m) => m.text),
    campaign.icpText, campaign.description, campaign.companyCriteria, campaign.offer,
  ];
  return parts.filter(Boolean).join(" \n ");
}

/**
 * @param text                the draft (subject and body)
 * @param opts.confirmsMeeting true for a reply that confirms a meeting: a time may then be mentioned
 * @returns {{ ok: boolean, issues: {type: string, text: string, why: string}[] }}
 */
export function checkGrounding({ text, knowledge = [], prospect = {}, campaign = {}, confirmsMeeting = false }) {
  const issues = [];
  const allowed = allowedText({ knowledge, prospect, campaign });
  const allowedNorm = norm(allowed);
  const allowedCompact = compact(allowed);
  const knowledgeNorm = norm(knowledge.map((k) => k.text).join(" \n "));
  const draft = String(text || "");

  for (const match of draft.match(FIGURE) || []) {
    if (PRICE.test(match)) continue; // prices are reported once, below
    if (!allowedCompact.includes(compact(match))) {
      issues.push({ type: "figure", text: match.trim(), why: "This figure is not in the retrieved knowledge or the prospect's data" });
    }
  }
  if (PRICE.test(draft)) {
    issues.push({ type: "pricing", text: (draft.match(/\$\s?\d[\d,.]*(?:\s?\/\s?\w+)?/) || ["a price"])[0], why: "Drafts must not quote a price; pricing goes through a human" });
  }
  for (const term of CERT_TERMS) {
    const m = draft.match(term);
    if (m && !term.test(knowledgeNorm)) {
      issues.push({ type: "claim", text: m[0], why: "The knowledge base does not make this compliance or certification claim" });
    }
  }
  if (!confirmsMeeting && MEETING_TIME.test(draft)) {
    issues.push({ type: "meeting-time", text: (draft.match(MEETING_TIME) || [""])[0], why: "A specific meeting time must not be proposed in this message" });
  }

  // De-duplicate identical claims (a figure repeated twice is one issue).
  const seen = new Set();
  const unique = issues.filter((i) => (seen.has(`${i.type}:${norm(i.text)}`) ? false : (seen.add(`${i.type}:${norm(i.text)}`), true)));
  return { ok: unique.length === 0, issues: unique };
}

export const describeIssues = (issues) => issues.map((i) => `"${i.text}": ${i.why}`);
