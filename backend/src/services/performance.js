// How well is each agent doing, and did a prompt change help? Computed from what actually happened to each prospect
// (nothing here is asked of a model). Every agent leaves a hand-off note in the dossier stating which prompt version it
// ran with (its "harness"), so each prospect can be traced back to the prompts that handled it. An agent's success is the
// share of the prospects it handled that then reached the next real milestone, measured per campaign and per prompt version.
import { getState } from "../db/index.js";

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

// What "success" means for each agent, and how it is measured.
const AGENTS = [
  { note: "Research Agent", id: "research", title: "Research", success: "Found a reason to reach out", how: "Of the prospects it researched, the share where it found at least one specific reason to get in touch.", ok: (p) => p.dossier && p.dossier.hooks.length > 0, of: () => true },
  { note: "ICP Fitment Agent", id: "icp", title: "ICP Fitment", success: "Its qualified prospects replied", how: "Of the prospects it qualified and that were then contacted, the share that replied. People it rejects are never contacted, so this measures the false-positive side.", ok: (p) => replied(p), of: (p) => p.qual && p.qual.status === "Qualified" && contacted(p) },
  { note: "Outreach Strategy Agent", id: "strategy", title: "Outreach Strategy", success: "Its plan led to a message being sent", how: "Of the prospects it planned, the share that were actually contacted.", ok: (p) => contacted(p), of: () => true },
  { note: "Personalisation Agent", id: "personalisation", title: "Personalisation", success: "Its opening message got a reply", how: "Of the prospects it wrote to, the share that replied.", ok: (p) => replied(p), of: (p) => contacted(p) },
  { note: "Conversation Agent", id: "conversation", title: "Conversation", success: "A reply led to a meeting", how: "Of the prospects that replied and whose reply it handled, the share that ended with a booked meeting.", ok: (p) => booked(p), of: (p) => replied(p) },
  { note: "Follow-up Agent", id: "followup", title: "Follow-up", success: "A follow-up got a reply", how: "Of the prospects it followed up with, the share that replied.", ok: (p) => replied(p), of: () => true },
];

const contacted = (p) => (p.touches || []).length > 0;
const replied = (p) => (p.conversation || []).some((m) => m.dir === "in");
const booked = (p) => p.meeting && p.meeting.status === "confirmed";

/** "v2 + campaign prompt v3" -> { agentVersion: "v2", brief: "v3" }. */
function parseHarness(h) {
  const m = /^(\S+?)(?: \+ campaign prompt (v\d+))?$/.exec(String(h || "").trim());
  return { agentVersion: (m && m[1]) || String(h || "n/a"), brief: (m && m[2]) || null };
}

/** The prompt version each agent used for a prospect: its most recent hand-off note wins. */
function versionsFor(prospect) {
  const out = {};
  for (const n of (prospect.dossier && prospect.dossier.notes) || []) out[n.agent] = n;
  return out;
}

export function getPerformance() {
  const s = getState();
  const campaigns = s.campaigns.filter((c) => !c.sandbox && c.status !== "archived" && c.status !== "draft");
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const prospects = s.prospects.filter((p) => byId.has(p.campaignId));
  const needsHuman = new Set(s.approvals.filter((a) => a.type === "escalation" || a.status === "rejected").map((a) => a.prospectId));

  const agents = AGENTS.map((a) => {
    const rows = new Map();
    for (const p of prospects) {
      const note = versionsFor(p)[a.note];
      if (!note || note.harness === "policy") continue;
      const { agentVersion, brief } = parseHarness(note.harness);
      const key = `${p.campaignId}|${agentVersion}|${brief || ""}`;
      if (!rows.has(key)) rows.set(key, { campaignId: p.campaignId, campaign: byId.get(p.campaignId).name, agentVersion, brief, handled: 0, measured: 0, succeeded: 0, llm: 0, human: 0 });
      const r = rows.get(key);
      r.handled += 1;
      if (note.engine && note.engine !== "rule" && note.engine !== "policy") r.llm += 1;
      if (needsHuman.has(p.id)) r.human += 1;
      if (a.of(p)) {
        r.measured += 1;
        if (a.ok(p)) r.succeeded += 1;
      }
    }
    const list = [...rows.values()].map((r) => ({ ...r, successRate: pct(r.succeeded, r.measured), humanRate: pct(r.human, r.handled), llmShare: pct(r.llm, r.handled) }));
    const total = list.reduce((t, r) => ({ measured: t.measured + r.measured, succeeded: t.succeeded + r.succeeded, handled: t.handled + r.handled }), { measured: 0, succeeded: 0, handled: 0 });
    return { id: a.id, title: a.title, success: a.success, how: a.how, handled: total.handled, measured: total.measured, successRate: pct(total.succeeded, total.measured), rows: list.sort((x, y) => x.campaign.localeCompare(y.campaign) || x.agentVersion.localeCompare(y.agentVersion)) };
  });

  return { agents, campaigns: campaigns.map((c) => health(s, c, prospects.filter((p) => p.campaignId === c.id))), note: "Measured from what happened to each prospect. Small samples move a lot: read a rate only once several prospects back it." };
}

/** Is a campaign doing what it should? A verdict, the reasons, and what to try. */
function health(s, c, ps) {
  const n = ps.length;
  const qualified = ps.filter((p) => p.qual && p.qual.status === "Qualified").length;
  const judged = ps.filter((p) => p.qual && p.qual.status !== "Pending").length;
  const sent = ps.filter(contacted).length;
  const replies = ps.filter(replied).length;
  const meetings = ps.filter(booked).length;
  const approvals = s.approvals.filter((a) => a.campaignId === c.id && a.status !== "pending" && a.type === "first");
  const rejected = approvals.filter((a) => a.status === "rejected").length;
  const brief = c.systemPrompt ? c.systemPrompt.versions.find((v) => v.version === c.systemPrompt.active) : null;

  const reasons = [];
  let suggestion = "";
  if (judged >= 6 && qualified / judged < 0.15) {
    reasons.push(`Only ${qualified} of ${judged} prospects qualified (${pct(qualified, judged)}%).`);
    suggestion = "Loosen the qualification criteria or widen the audience, or check that the search is finding the right people.";
  }
  if (sent >= 6 && replies / sent < 0.05) {
    reasons.push(`${replies} replies from ${sent} people contacted (${pct(replies, sent)}%).`);
    suggestion = "Change the campaign brief or the offer: the messages are not landing. Compare the reply rate by prompt version below.";
  }
  if (replies >= 4 && meetings === 0) {
    reasons.push(`${replies} people replied but none has booked a meeting.`);
    suggestion = suggestion || "Look at the conversations in the journal: the Conversation agent may not be moving replies toward a meeting.";
  }
  if (approvals.length >= 4 && rejected / approvals.length > 0.4) {
    reasons.push(`People rejected ${rejected} of ${approvals.length} drafts.`);
    suggestion = suggestion || "Read the rejection reasons and put them into the campaign brief.";
  }
  if (c.failures && c.failures.total > 0) reasons.push(`${c.failures.total} agent step${c.failures.total === 1 ? "" : "s"} failed.`);

  const enough = n >= 6 && sent >= 3;
  const status = !enough ? "new" : reasons.some((r) => !/failed/.test(r)) ? "struggling" : reasons.length ? "watch" : "healthy";
  return {
    id: c.id, name: c.name, status, prospects: n, qualified, contacted: sent, replies, meetings,
    replyRate: pct(replies, sent), meetingRate: pct(meetings, sent),
    brief: brief ? { version: brief.version, changedBy: brief.by || null } : null,
    reasons, suggestion: status === "healthy" || status === "new" ? "" : suggestion || "Review the campaign brief and the agents' recent decisions.",
  };
}
