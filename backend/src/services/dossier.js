// The Prospect Dossier: the one shared memory for a prospect that turns separate agents into one SDR.
//
//   facts  what is known about the person and organisation, each with where it came from
//   notes  a short hand-off note every agent writes after it acts, in plain words, for whoever acts next
//
// Every agent is given the WHOLE dossier before it acts (dossierFor), so the follow-up agent knows why the strategy agent
// chose a channel, and the conversation agent knows what the research found. Nothing here is per-agent private state.

const MAX_NOTES = 40;
const MAX_FACTS = 60;
const clip = (t, n) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);

export function ensureDossier(prospect) {
  if (!prospect.dossier) prospect.dossier = { facts: [], notes: [], hooks: [], gaps: [] };
  if (!Array.isArray(prospect.dossier.facts)) prospect.dossier.facts = [];
  if (!Array.isArray(prospect.dossier.notes)) prospect.dossier.notes = [];
  if (!Array.isArray(prospect.dossier.hooks)) prospect.dossier.hooks = [];
  if (!Array.isArray(prospect.dossier.gaps)) prospect.dossier.gaps = [];
  return prospect.dossier;
}

/**
 * @param fact.kind   "profile" (who they are), "signal" (a reason to reach out now), "context" (background) or "gap" (not known)
 * @param fact.source where it came from: "entered by a person", "simulated search", "campaign research", ...
 */
export function addFact(prospect, { text, source = "unknown", kind = "context", url = null }) {
  const d = ensureDossier(prospect);
  const clean = clip(text, 400);
  if (!clean) return false;
  if (d.facts.some((f) => f.text.toLowerCase() === clean.toLowerCase())) return false;
  d.facts.push({ text: clean, source, kind, url, ts: Date.now() });
  if (d.facts.length > MAX_FACTS) d.facts.shift();
  return true;
}

/** A plain-words reason the rules answered instead of the model, or "" when the model answered or nothing failed. */
export function fallbackWhy(engine, reason) {
  if (engine !== "rule" || !reason || /^clear-cut/.test(reason)) return "";
  const short = String(reason).replace(/\s+/g, " ").slice(0, 220);
  return `The AI did not respond (${short}), so the rule engine decided this step.`;
}

export function addNote(prospect, { agent, harness = "", engine = "", note, fallbackReason = "" }) {
  const d = ensureDossier(prospect);
  const clean = clip(note, 320);
  if (!clean) return;
  const fallback = fallbackWhy(engine, fallbackReason);
  d.notes.push({ agent, harness, engine, note: clean, ...(fallback ? { fallback } : {}), ts: Date.now() });
  if (d.notes.length > MAX_NOTES) d.notes.shift();
}

/** What an agent receives: the qualification, every fact, every hand-off note, and the activity so far. */
export function dossierFor(prospect) {
  const d = ensureDossier(prospect);
  const entries = [];
  if (prospect.qual && prospect.qual.status && prospect.qual.status !== "Pending") {
    entries.push({ agent_name: prospect.qual.agent, harness_version: prospect.qual.harness, decision: prospect.qual.status, handoff_note: prospect.qual.reasoning });
  }
  for (const f of d.facts) entries.push({ agent_name: "research", decision: `${f.kind}: ${f.text}`, source: f.source });
  for (const h of d.hooks) entries.push({ agent_name: "research", decision: `reason they might care: ${h}` });
  for (const g of d.gaps) entries.push({ agent_name: "research", decision: `not known: ${g}` });
  for (const n of d.notes) entries.push({ agent_name: n.agent, harness_version: n.harness, handoff_note: n.note });
  for (const h of prospect.history || []) entries.push({ agent_name: "activity", decision: h.text });
  return entries;
}
