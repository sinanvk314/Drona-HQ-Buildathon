// The real service layer behind every function the frontend's src/services/api.js mocks.
// Function names and return shapes are kept identical to that file on purpose (see the
// frontend README: "Backend swap: reimplement functions in src/services/api.js with fetch();
// keep names and return shapes") — only the storage (JSON file via src/db/index.js instead of
// sessionStorage) and the fact that campaign/prospect/agent data is real and mutable server-side
// have changed.
import { getState, withState } from "../db/index.js";
import { addEvent, canTransition, effectiveStatus, isRunning, pct, zeroFunnel, agentStatus } from "./logic.js";
import { STAGE_KEYS, STAGE_LABELS, CARD_CHANNEL_LABELS } from "./constants.js";
import { validateCampaign, validateSuppression } from "../utils/validation.js";
import { shortDate } from "../utils/format.js";
import { checkConflict } from "./conflict.js";
import { getUsage } from "./usage.js";
import { docLength } from "./rag.js";
import { recordTouch } from "./outreach.js";
import { sentToday } from "./limits.js";
import { simClockLabel, withinWorkingHours } from "./simTime.js";
import { config } from "../config.js";
import { currentUser } from "./auth.js";
import { activeSystemPrompt, activeVersionOf, initCampaignPrompts, logPromptChange, pinnedVersion } from "./prompts.js";

function campaignOf(s, id) {
  const c = s.campaigns.find((x) => x.id === id);
  if (!c) throw new Error("Campaign not found.");
  return c;
}

function cardActionOf(c) {
  if (c.status === "live") return "pause";
  if (c.status === "paused") return "resume";
  if (c.status === "draft") return "launch";
  return null;
}

function cardOf(s, c) {
  const eff = effectiveStatus(s, c);
  return {
    id: c.id,
    name: c.name,
    status: eff,
    rawStatus: c.status,
    owner: c.owner,
    icpSummary: c.icpSummary,
    channels: c.channels.map((k) => ({ key: k, label: CARD_CHANNEL_LABELS[k] })),
    metrics: { contacted: c.funnel.contacted, engaged: c.funnel.engaged, meetings: c.funnel.meeting },
    action: cardActionOf(c),
    locked: eff === "stopped",
  };
}

// What the UI needs to list a knowledge source. The text itself is never sent back, only its size.
function sourceView(x) {
  return { id: x.id, name: x.name, category: x.category, chars: x.content ? x.content.length : x.docId ? docLength(x.docId) : 0, custom: !!x.content };
}

// What the campaign page needs to manage this campaign's prompts: its own system prompt (versioned), which library
// version it is pinned to for each agent, its overrides, and who changed what.
function promptsView(s, c) {
  const sp = c.systemPrompt;
  return {
    system: sp ? { active: sp.active, versions: sp.versions.map((v) => ({ ...v })) } : null,
    agents: s.agents.map((a) => {
      const override = a.overrides.find((o) => o.campaignId === c.id);
      return {
        agentId: a.id, title: a.title, pinned: pinnedVersion(a, c).version, latest: activeVersionOf(a).version,
        versions: a.versions.map((v) => ({ version: v.version, changedBy: v.changedBy, date: v.date })),
        override: override ? { text: override.text, by: override.by || null, ts: override.ts } : null,
      };
    }),
    log: (c.promptLog || []).slice(0, 12),
  };
}

function prospectRow(s, p) {
  const c = s.campaigns.find((x) => x.id === p.campaignId);
  return {
    id: p.id, name: p.name, company: p.company, contact: `${p.name}, ${p.title}`,
    stage: p.stage, fit: p.fit, channel: p.channel, lastAction: p.lastAction, lastTs: p.lastTs,
    nextStep: p.nextStep, campaignId: p.campaignId, campaignName: c ? c.name : "",
  };
}

const pendingApprovals = (s) => s.approvals.filter((a) => a.status === "pending").sort((a, b) => b.requestedTs - a.requestedTs);

function approvalQueueItem(a) {
  return { id: a.id, text: a.summary, tag: a.tag, tone: a.tagTone, ts: a.requestedTs };
}

function transition(s, id, to, eventText) {
  const c = campaignOf(s, id);
  if (!canTransition(c.status, to)) throw new Error(`A ${c.status} campaign cannot move to ${to}.`);
  c.status = to;
  c.modifiedTs = Date.now();
  if (eventText) addEvent(s, { campaignId: id, type: to === "live" ? "resume" : to, text: eventText(c) });
  return { id: c.id, status: c.status };
}

// ---------------------------------------------------------------- reads

// Today's LLM usage plus what it cost per unit of work. Only decisions made by the running system count
// (they carry an `engine` field); seeded demo history does not.
function efficiencyFor(s) {
  const usage = getUsage();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const today = s.decisions.filter((d) => d.engine && d.ts >= startOfDay.getTime());
  const qualified = today.filter((d) => d.kind === "qualified").length;
  const scored = today.filter((d) => d.kind === "qualified" || d.kind === "rejected").length;
  const conversation = usage.byAgent.find((a) => a.agent === "conversation");
  const per = (cost, n) => (n ? Number((cost / n).toFixed(6)) : null);
  return {
    ...usage,
    unitCosts: {
      perProspectScored: per(usage.estCostUsd, scored),
      perQualifiedLead: per(usage.estCostUsd, qualified),
      perConversation: conversation ? per(conversation.estCostUsd, conversation.decisions) : null,
    },
    counts: { prospectsScored: scored, qualified },
  };
}

export function getShellState() {
  const s = getState();
  return { killSwitch: s.killSwitch.active, pendingApprovals: pendingApprovals(s).length };
}

export function getCommandCenter() {
  const s = getState();
  const cs = s.campaigns;
  const sum = (k) => cs.reduce((a, c) => a + c.funnel[k], 0);
  const live = cs.filter((c) => c.status === "live").length;
  const paused = cs.filter((c) => c.status === "paused").length;
  const draft = cs.filter((c) => c.status === "draft").length;
  const totalDiscovered = sum("discovered");
  const pending = pendingApprovals(s);
  const activeSub = [`${live} Live`, `${paused} Paused`];
  if (draft) activeSub.push(`${draft} Draft`);

  return {
    now: Date.now(),
    simClock: simClockLabel(),
    killSwitch: s.killSwitch.active,
    summary: { configured: cs.length, running: cs.filter((c) => isRunning(s, c)).length },
    kpis: [
      { label: "Total Prospects", value: totalDiscovered, sub: `+${s.weekly.prospects} this week`, tone: "success" },
      { label: "Qualified Leads", value: sum("qualified"), sub: `${pct(sum("qualified"), totalDiscovered)}% qualify rate`, tone: "success" },
      { label: "Meetings Booked", value: sum("meeting"), sub: `+${s.weekly.meetings} this week`, tone: "success" },
      { label: "Active Campaigns", value: live + paused, sub: s.killSwitch.active ? "Kill Switch active" : activeSub.join(" · "), tone: "neutral", dot: !s.killSwitch.active },
    ],
    approvals: { count: pending.length, escalated: pending.filter((a) => a.type === "escalation").length },
    efficiency: efficiencyFor(s),
    campaigns: cs.map((c) => cardOf(s, c)),
    funnel: STAGE_KEYS.map((k) => ({ key: k, label: STAGE_LABELS[k], value: sum(k) })),
    feed: s.events
      .filter((e) => e.featured)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6)
      .map((e) => {
        const c = s.campaigns.find((x) => x.id === e.campaignId);
        return { id: e.id, type: e.type, text: e.text, ts: e.ts, campaignTag: c ? c.shortName : "All campaigns" };
      }),
  };
}

export function getCampaign(id) {
  const s = getState();
  const c = campaignOf(s, id);
  const draft = c.status === "draft";
  const f = draft ? zeroFunnel() : c.funnel;
  const o = draft ? { emails: 0, linkedin: 0, replies: 0, followups: 0, costPerQualified: 0 } : c.outreach;
  const pending = pendingApprovals(s).filter((a) => a.campaignId === id);
  const card = cardOf(s, c);
  return {
    id: c.id, name: c.name, status: card.status, rawStatus: c.status, action: card.action, locked: card.locked,
    icpSummary: c.icpSummary, objective: c.objective, owner: c.owner, modifiedTs: c.modifiedTs,
    metrics: { pipeline: f.discovered, qualifyRate: pct(f.qualified, f.discovered), responseRate: draft ? 0 : c.responseRate, meetings: f.meeting },
    funnel: STAGE_KEYS.map((k) => ({ key: k, label: STAGE_LABELS[k], value: f[k] })),
    timeline: draft ? [] : s.events.filter((e) => e.campaignId === id).sort((a, b) => b.ts - a.ts).slice(0, 4).map((e) => ({ id: e.id, type: e.type, text: e.text, ts: e.ts })),
    outreach: o,
    approvals: { count: pending.length, items: pending.slice(0, 2).map(approvalQueueItem) },
    prompts: promptsView(s, c),
    approvalPolicy: { ...c.approvals },
    cadence: { ...(c.cadence || { maxTouches: 3, waitHours: 72 }) },
    limits: {
      sentToday: sentToday(s, c), dailyLimit: c.dailyLimit, workingHours: c.workingHours,
      withinHours: withinWorkingHours(c), simClock: simClockLabel(), enforced: config.enforceLimits,
    },
    knowledge: c.sources.map(sourceView),
    prospects: draft ? [] : s.prospects.filter((p) => p.campaignId === id).map((p) => prospectRow(s, p)),
  };
}

const GEOGRAPHY_OPTIONS = ["United States", "Canada", "United Kingdom", "India"];
const PERSONA_OPTIONS = ["Founder", "CEO", "Head of Product", "CTO", "VP Engineering", "CIO", "Head of Risk"];
const union = (options, chosen) => [...options, ...chosen.filter((x) => !options.includes(x))];

// The form values for a campaign, in the shape the create/edit form uses.
function formValues(c) {
  return {
    name: c.name, description: c.description, owner: c.owner, objective: c.objective, icpText: c.icpText,
    geographyOptions: union(GEOGRAPHY_OPTIONS, c.geography), geography: [...c.geography],
    personaOptions: union(PERSONA_OPTIONS, c.personas), personas: [...c.personas],
    companyCriteria: c.companyCriteria, exclusionCriteria: c.exclusionCriteria, channels: [...c.channels],
    qualificationPrompt: c.qualificationPrompt, dailyLimit: c.dailyLimit, workingHours: c.workingHours,
    cadence: { ...(c.cadence || { maxTouches: 3, waitHours: 72 }) },
    approvals: { ...c.approvals }, sources: c.sources.map(sourceView),
  };
}

export function getCampaignDefaults() {
  const s = getState();
  const c = s.campaigns.find((x) => x.id === "c_ai_founders") || s.campaigns[0];
  // A new campaign starts with a template's settings but at the safest approval level.
  return { ...formValues(c), approvals: { ...c.approvals, level: "manual" }, sources: c.sources.map((x) => ({ ...x })) };
}

/** An existing campaign's settings, for the edit form. Knowledge sources are edited from the campaign page. */
export function getCampaignConfig(id) {
  const s = getState();
  const c = campaignOf(s, id);
  return { ...formValues(c), id: c.id, rawStatus: c.status };
}

export function getProspects() {
  const s = getState();
  return s.prospects.map((p) => prospectRow(s, p));
}

export function getProspect(id) {
  const s = getState();
  const p = s.prospects.find((x) => x.id === id);
  if (!p) throw new Error("Prospect not found.");
  const c = s.campaigns.find((x) => x.id === p.campaignId);
  const ap = s.approvals.filter((a) => a.prospectId === id).sort((a, b) => b.requestedTs - a.requestedTs)[0] || null;
  const dec = s.decisions.filter((d) => d.prospectId === id).sort((a, b) => b.ts - a.ts)[0] || null;
  return {
    ...p,
    campaign: c ? { id: c.id, name: c.name } : null,
    approval: ap ? { id: ap.id, status: ap.status, nextActionText: ap.nextActionText, source: ap.source, decidedBy: ap.decidedBy, decidedTs: ap.decidedTs, reason: ap.reason } : null,
    decisionId: dec ? dec.id : null,
  };
}

export function getDecisions({ limit = 4 } = {}) {
  const s = getState();
  const sorted = [...s.decisions].sort((a, b) => b.ts - a.ts);
  const items = sorted.slice(0, limit).map((d) => {
    const c = s.campaigns.find((x) => x.id === d.campaignId);
    return { ...d, campaignName: c ? c.name : "", campaignTag: c ? c.shortName : "" };
  });
  return { items, total: sorted.length, hasMore: sorted.length > limit };
}

export function getDecisionForProspect(prospectId) {
  const s = getState();
  const sorted = [...s.decisions].sort((a, b) => b.ts - a.ts);
  const index = sorted.findIndex((d) => d.prospectId === prospectId);
  return index === -1 ? null : { id: sorted[index].id, index };
}

export function getApprovals() {
  const s = getState();
  const items = pendingApprovals(s).map((a) => {
    const c = s.campaigns.find((x) => x.id === a.campaignId);
    return { id: a.id, name: a.name, company: a.company, campaignTag: c ? c.shortName : "", tag: a.tag, tone: a.tagTone, ts: a.requestedTs };
  });
  return { count: items.length, items };
}

export function getApproval(id) {
  const s = getState();
  const a = s.approvals.find((x) => x.id === id);
  if (!a) throw new Error("Approval not found.");
  const c = s.campaigns.find((x) => x.id === a.campaignId);
  return { ...a, campaignName: c ? c.name : "" };
}

export function getAgents() {
  const s = getState();
  return s.agents.map((a) => ({ id: a.id, listName: a.listName, enabled: a.enabled, status: agentStatus(s, a) }));
}

export function getAgent(id) {
  const s = getState();
  const a = s.agents.find((x) => x.id === id);
  if (!a) throw new Error("Agent not found.");
  const active = a.versions.find((v) => v.status === "active") || a.versions[0];
  return {
    id: a.id, title: a.title, description: a.description, status: agentStatus(s, a),
    scope: s.campaigns.filter((c) => c.status !== "archived").map((c) => c.name),
    campaignPins: s.campaigns.filter((c) => c.status !== "archived").map((c) => ({ campaignId: c.id, campaignName: c.name, version: pinnedVersion(a, c).version })),
    active, versions: a.versions,
    overrides: a.overrides.map((o) => {
      const c = s.campaigns.find((x) => x.id === o.campaignId);
      return { campaignName: c ? c.name : "", text: o.text, ts: o.ts };
    }),
  };
}

export function getSettings() {
  const s = getState();
  return {
    killSwitch: { active: s.killSwitch.active, at: s.killSwitch.at },
    agents: s.agents.map((a) => ({ id: a.id, name: a.settingsName, enabled: a.enabled, status: agentStatus(s, a), note: !a.enabled && a.disabledBy ? { by: a.disabledBy, ts: a.disabledTs } : null })),
    channels: s.channels.map((c) => ({ key: c.key, label: c.label, note: c.note, enabled: c.enabled, pausedTs: c.enabled ? null : c.pausedTs })),
    suppression: s.suppression,
    integrations: s.integrations,
  };
}

// ---------------------------------------------------------------- campaign writes

export function pauseCampaign(id) {
  return withState((s) => {
    if (s.killSwitch.active) throw new Error("The Global Kill Switch is active. Deactivate it first.");
    return transition(s, id, "paused", (c) => `**${c.name}** paused by ${currentUser()}`);
  });
}

export function resumeCampaign(id) {
  return withState((s) => {
    if (s.killSwitch.active) throw new Error("The Global Kill Switch is active. Deactivate it first.");
    return transition(s, id, "live", (c) => `**${c.name}** resumed by ${currentUser()}`);
  });
}

export function launchCampaign(id) {
  return withState((s) => {
    if (s.killSwitch.active) throw new Error("The Global Kill Switch is active. Deactivate it first.");
    return transition(s, id, "live", (c) => `**${c.name}** launched by ${currentUser()}`);
  });
}

export function completeCampaign(id) {
  return withState((s) => transition(s, id, "completed", (c) => `**${c.name}** marked as completed`));
}

export function archiveCampaign(id) {
  return withState((s) => transition(s, id, "archived", null));
}

// Follow-up cadence: how many touches a prospect gets in total (the opening message included) and how long to wait
// between them, in simulated hours (see services/simTime.js).
function normalizeCadence(c = {}) {
  const clamp = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt);
  return { maxTouches: clamp(c.maxTouches, 1, 6, 3), waitHours: clamp(c.waitHours, 24, 168, 72) };
}

const APPROVAL_LEVELS = ["manual", "assisted", "autonomous"];

// Approval policy per campaign: which actions need a human (three toggles) and how a human can be
// skipped (level; see scheduler.js autoApproval). Anything missing or out of range gets the safe default.
function normalizeApprovals(a = {}) {
  const clamp = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt);
  return {
    firstOutreach: a.firstOutreach !== false,
    meetingTime: !!a.meetingTime,
    escalate: a.escalate !== false,
    level: APPROVAL_LEVELS.includes(a.level) ? a.level : "manual",
    autoMinScore: clamp(a.autoMinScore, 50, 100, 85),
    autoAfterApproved: clamp(a.autoAfterApproved, 0, 50, 3),
  };
}

const MAX_SOURCE_CHARS = 60000;

function makeSource(s, { name, category, content }) {
  const errors = {};
  if (!name || name.trim().length < 3) errors.name = "Enter a source name (at least 3 characters).";
  if (!content || content.trim().length < 20) errors.content = "Paste or upload the source text (at least 20 characters).";
  else if (content.length > MAX_SOURCE_CHARS) errors.content = `That is too long (max ${MAX_SOURCE_CHARS.toLocaleString()} characters).`;
  if (Object.keys(errors).length) {
    const err = new Error("Please fix the highlighted fields.");
    err.fields = errors;
    throw err;
  }
  s.seq += 1;
  return { id: `s${s.seq}`, name: name.trim(), category: category || "Other", content: content.trim() };
}

// Sources arriving with a new campaign: either a reference to a shipped document (docId) or text typed or
// uploaded in the UI (content). Shape and size are enforced here, not trusted from the client.
function normalizeSources(list) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map((x, i) => ({
    id: String(x.id || `s_new_${i}`),
    name: String(x.name || "Untitled source").slice(0, 200),
    category: String(x.category || "Other").slice(0, 60),
    ...(typeof x.docId === "string" && /^[\w.-]+$/.test(x.docId) ? { docId: x.docId } : {}),
    ...(typeof x.content === "string" && x.content.trim() ? { content: x.content.trim().slice(0, MAX_SOURCE_CHARS) } : {}),
  }));
}

export function addCampaignSource(campaignId, values = {}) {
  return withState((s) => {
    const c = campaignOf(s, campaignId);
    const source = makeSource(s, values);
    c.sources.push(source);
    c.modifiedTs = Date.now();
    return sourceView(source);
  });
}

export function removeCampaignSource(campaignId, sourceId) {
  return withState((s) => {
    const c = campaignOf(s, campaignId);
    const before = c.sources.length;
    c.sources = c.sources.filter((x) => x.id !== sourceId);
    if (c.sources.length === before) throw new Error("Knowledge source not found.");
    c.modifiedTs = Date.now();
    return { id: sourceId };
  });
}

export function createCampaign(values, { launch = false } = {}) {
  return withState((s) => {
    const errors = validateCampaign(values, launch);
    if (Object.keys(errors).length) {
      const err = new Error("Please fix the highlighted fields.");
      err.fields = errors;
      throw err;
    }
    if (launch && s.killSwitch.active) throw new Error("The Global Kill Switch is active. Deactivate it first.");
    const now = Date.now();
    s.seq += 1;
    const id = `c_${s.seq}`;
    const name = values.name.trim();
    s.campaigns.push({
      id, name, shortName: name, status: launch ? "live" : "draft",
      owner: (values.owner || "").trim() || currentUser(), objective: (values.objective || "").trim(), description: (values.description || "").trim(),
      icpSummary: [(values.personas || []).join(" & "), (values.geography || []).join(", ")].filter(Boolean).join(" · "),
      icpText: (values.icpText || "").trim(), geography: values.geography || [], personas: values.personas || [],
      companyCriteria: values.companyCriteria || "", exclusionCriteria: values.exclusionCriteria || "", channels: values.channels || [],
      qualificationPrompt: (values.qualificationPrompt || "").trim(), dailyLimit: Number(values.dailyLimit) || 0,
      workingHours: values.workingHours || "", cadence: normalizeCadence(values.cadence), approvals: normalizeApprovals(values.approvals), sources: normalizeSources(values.sources),
      funnel: zeroFunnel(), outreach: { emails: 0, linkedin: 0, replies: 0, followups: 0, costPerQualified: 0 },
      responseRate: 0, createdTs: now, modifiedTs: now,
    });
    initCampaignPrompts(s.campaigns[s.campaigns.length - 1], s.agents, currentUser());
    if (launch) addEvent(s, { campaignId: id, type: "launch", text: `**${name}** launched by ${currentUser()}` });
    return { id, status: launch ? "live" : "draft" };
  });
}

export function updateCampaign(id, values = {}) {
  return withState((s) => {
    const c = campaignOf(s, id);
    if (c.status === "completed" || c.status === "archived") throw new Error(`A ${c.status} campaign cannot be edited.`);
    // A Draft only needs a name; a campaign that has been launched must stay fully valid.
    const errors = validateCampaign(values, c.status !== "draft");
    if (Object.keys(errors).length) {
      const err = new Error("Please fix the highlighted fields.");
      err.fields = errors;
      throw err;
    }
    c.name = values.name.trim();
    c.shortName = c.name;
    c.description = (values.description || "").trim();
    c.owner = (values.owner || "").trim() || c.owner;
    c.objective = (values.objective || "").trim();
    c.icpText = (values.icpText || "").trim();
    c.geography = values.geography || [];
    c.personas = values.personas || [];
    c.companyCriteria = values.companyCriteria || "";
    c.exclusionCriteria = values.exclusionCriteria || "";
    c.channels = values.channels || [];
    c.qualificationPrompt = (values.qualificationPrompt || "").trim();
    c.dailyLimit = Number(values.dailyLimit) || 0;
    c.workingHours = values.workingHours || "";
    c.approvals = normalizeApprovals(values.approvals);
    c.cadence = normalizeCadence(values.cadence);
    c.icpSummary = [c.personas.join(" & "), c.geography.join(", ")].filter(Boolean).join(" · ");
    c.modifiedTs = Date.now();
    addEvent(s, { campaignId: id, type: "edit", text: `**${c.name}** settings edited by ${currentUser()} (applies from the next agent run)`, featured: false });
    return { id: c.id, status: c.status };
  });
}

// A copy of a campaign as a new Draft: same targeting, knowledge, approval policy and per-campaign prompt
// overrides, with no prospects or metrics. This is how a variant is made (change one thing, launch, compare).
export function duplicateCampaign(id) {
  return withState((s) => {
    const src = campaignOf(s, id);
    s.seq += 1;
    const newId = `c_${s.seq}`;
    const now = Date.now();
    const name = `${src.name} (copy)`;
    s.campaigns.push({
      ...JSON.parse(JSON.stringify(src)),
      id: newId, name, shortName: name, status: "draft",
      sources: src.sources.map((x) => ({ ...x, id: `s${++s.seq}` })),
      funnel: zeroFunnel(), outreach: { emails: 0, linkedin: 0, replies: 0, followups: 0, costPerQualified: 0 },
      responseRate: 0, createdTs: now, modifiedTs: now,
    });
    for (const agent of s.agents) {
      const copies = agent.overrides.filter((o) => o.campaignId === id).map((o) => ({ ...o, campaignId: newId, ts: now }));
      agent.overrides.push(...copies);
    }
    logPromptChange(s.campaigns[s.campaigns.length - 1], currentUser(), `Created as a copy of ${src.name}: same prompt versions`);
    addEvent(s, { campaignId: newId, type: "edit", text: `**${name}** created as a copy of **${src.name}**`, featured: false });
    return { id: newId, status: "draft" };
  });
}

// ---------------------------------------------------------------- approvals

const OUTCOMES = {
  followup: { last: "Follow-up sent, {ago}", next: "Awaiting reply", counter: "followups" },
  pricing: { last: "Pricing shared, {ago}", next: "Awaiting reply", counter: "followups" },
  meeting: { last: "Meeting booked, {ago}", next: "Prep for call", stage: "meeting", funnel: "meeting" },
  escalation: { last: "Reply sent by a human, {ago}", next: "Awaiting reply", counter: "followups" },
};

export function decideApproval(id, { action, reason = "" } = {}) {
  return withState((s) => {
    const a = s.approvals.find((x) => x.id === id);
    if (!a) throw new Error("Approval not found.");
    if (a.status !== "pending") throw new Error("This action has already been handled.");
    if (action !== "approve" && action !== "reject") throw new Error("Unknown action.");
    if (action === "reject" && !reason.trim()) throw new Error("Add a reason before rejecting.");

    const now = Date.now();
    const p = s.prospects.find((x) => x.id === a.prospectId);
    const c = s.campaigns.find((x) => x.id === a.campaignId);
    a.status = action === "approve" ? "approved" : "rejected";
    a.decidedBy = currentUser();
    a.decidedTs = now;
    a.reason = reason.trim();

    if (p) {
      if (action === "approve") {
        if (a.type === "first" || a.touchKind === "cadence") {
          // An outbound touch (opening message or cadence follow-up): recorded in one place so the touch
          // history, counters, funnel and the next follow-up's clock stay consistent.
          recordTouch(s, c, p, {
            channel: a.channel || (c.channels && c.channels[0]) || "email",
            kind: a.type === "first" ? "first" : "followup",
            subject: (a.draft && a.draft.subject) || "",
            body: (a.draft && a.draft.body) || "",
            ts: now,
          });
        } else {
          const o = OUTCOMES[a.type];
          // The approved (possibly edited) draft is what actually goes out, so keep it in the conversation.
          if (a.type === "followup" && a.draft && a.draft.body) {
            p.conversation.push({ dir: "out", text: a.draft.body, when: "Today", channel: a.channel });
          }
          p.lastAction = o.last;
          p.nextStep = o.next;
          if (o.stage) p.stage = o.stage;
          if (c && o.counter) c.outreach[o.counter] += 1;
          if (c && o.funnel) c.funnel[o.funnel] += 1;
        }
      } else {
        p.lastAction = "Action rejected, {ago}";
        // A rejected follow-up ends the sequence; a rejected opening message goes back for a redraft.
        p.nextStep = a.touchKind === "cadence" ? "Follow-up rejected: sequence stopped" : "Needs rework";
      }
      p.lastTs = now;
    }
    if (c) c.modifiedTs = now;
    const queued = c && !isRunning(s, c) ? " (queued while outreach is stopped)" : "";
    addEvent(s, {
      campaignId: a.campaignId,
      type: action === "approve" ? "approve" : "reject",
      text: `${currentUser()} ${action === "approve" ? "approved" : "rejected"} "${a.tag}" for **${a.name}** (${a.company})${action === "approve" ? queued : ""}`,
    });
    return { id, status: a.status };
  });
}

export function editApproval(id, patch = {}) {
  return withState((s) => {
    const a = s.approvals.find((x) => x.id === id);
    if (!a) throw new Error("Approval not found.");
    if (a.status !== "pending") throw new Error("This action has already been handled.");
    if (patch.draftBody !== undefined) {
      if (!patch.draftBody.trim()) throw new Error("The draft cannot be empty.");
      a.draft.body = patch.draftBody.trim();
    }
    if (patch.nextActionText !== undefined) {
      if (!patch.nextActionText.trim()) throw new Error("The recommended action cannot be empty.");
      a.nextActionText = patch.nextActionText.trim();
    }
    return { id };
  });
}

// ---------------------------------------------------------------- agents & prompts

export function activatePromptVersion(agentId, version) {
  return withState((s) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) throw new Error("Agent not found.");
    const target = a.versions.find((v) => v.version === version);
    if (!target) throw new Error("Version not found.");
    a.versions.forEach((v) => { v.status = v.version === version ? "active" : "archived"; });
    target.activatedBy = currentUser();
    target.activatedTs = Date.now();
    return { agentId, version };
  });
}

export function savePromptVersion(agentId, text) {
  return withState((s) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) throw new Error("Agent not found.");
    if (!text || !text.trim()) throw new Error("The prompt cannot be empty.");
    const nums = a.versions.map((v) => v.version.replace("v", "").split(".").map(Number));
    nums.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
    const next = `v${nums[0][0]}.${nums[0][1] + 1}`;
    a.versions.forEach((v) => { v.status = "archived"; });
    a.versions.unshift({ version: next, changedBy: currentUser(), date: shortDate(Date.now()), status: "active", text: text.trim(), activatedBy: currentUser(), activatedTs: Date.now() });
    return { agentId, version: next };
  });
}

// ---- per-campaign prompts. Nothing here touches another campaign, and the shared library is only read. ----

function promptCampaign(s, id) {
  const c = campaignOf(s, id);
  if (c.status === "archived") throw new Error("An archived campaign cannot be edited.");
  initCampaignPrompts(c, s.agents, currentUser());
  return c;
}

export function setCampaignPin(campaignId, agentId, version) {
  return withState((s) => {
    const c = promptCampaign(s, campaignId);
    const agent = s.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error("Agent not found.");
    if (!agent.versions.some((v) => v.version === version)) throw new Error("Version not found.");
    const from = pinnedVersion(agent, c).version;
    if (from === version) return { agentId, version };
    c.promptPins[agentId] = version;
    c.modifiedTs = Date.now();
    logPromptChange(c, currentUser(), `${agent.title}: ${from} → ${version}`);
    addEvent(s, { campaignId, type: "edit", text: `${currentUser()} moved **${c.name}** to ${agent.title} ${version} (was ${from})`, featured: false });
    return { agentId, version };
  });
}

export function saveCampaignSystemPrompt(campaignId, text) {
  return withState((s) => {
    const c = promptCampaign(s, campaignId);
    if (!text || !text.trim()) throw new Error("The campaign prompt cannot be empty.");
    const next = Math.max(...c.systemPrompt.versions.map((v) => v.version)) + 1;
    c.systemPrompt.versions.push({ version: next, text: text.trim(), by: currentUser(), ts: Date.now() });
    c.systemPrompt.active = next;
    c.modifiedTs = Date.now();
    logPromptChange(c, currentUser(), `Campaign system prompt saved as v${next}`);
    addEvent(s, { campaignId, type: "edit", text: `${currentUser()} saved campaign prompt v${next} for **${c.name}**`, featured: false });
    return { version: next };
  });
}

/** Also the roll-back: activating an earlier version restores it without deleting anything newer. */
export function activateCampaignSystemPrompt(campaignId, version) {
  return withState((s) => {
    const c = promptCampaign(s, campaignId);
    const v = c.systemPrompt.versions.find((x) => x.version === Number(version));
    if (!v) throw new Error("Version not found.");
    if (c.systemPrompt.active === v.version) return { version: v.version };
    const from = c.systemPrompt.active;
    c.systemPrompt.active = v.version;
    c.modifiedTs = Date.now();
    logPromptChange(c, currentUser(), `Campaign system prompt v${from} → v${v.version}`);
    addEvent(s, { campaignId, type: "edit", text: `${currentUser()} set the campaign prompt of **${c.name}** to v${v.version} (was v${from})`, featured: false });
    return { version: v.version };
  });
}

/** An override is this campaign's extra instruction for one agent (empty text removes it). Other campaigns never see it. */
export function setCampaignOverride(campaignId, agentId, text) {
  return withState((s) => {
    const c = promptCampaign(s, campaignId);
    const agent = s.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error("Agent not found.");
    const clean = (text || "").trim();
    agent.overrides = agent.overrides.filter((o) => o.campaignId !== campaignId);
    if (clean) agent.overrides.push({ campaignId, text: clean, ts: Date.now(), by: currentUser() });
    c.modifiedTs = Date.now();
    logPromptChange(c, currentUser(), clean ? `${agent.title}: override set` : `${agent.title}: override removed`);
    return { agentId, hasOverride: !!clean };
  });
}

// ---------------------------------------------------------------- global controls

export function setKillSwitch(active) {
  return withState((s) => {
    if (s.killSwitch.active === !!active) return { active: s.killSwitch.active };
    s.killSwitch = { active: !!active, at: active ? Date.now() : null };
    addEvent(s, {
      campaignId: null,
      type: active ? "kill" : "resume",
      text: active ? `${currentUser()} activated the **Global Kill Switch** — all autonomous outreach is stopped` : `${currentUser()} deactivated the **Global Kill Switch** — campaigns are back to their own status`,
    });
    return { active: s.killSwitch.active };
  });
}

export function setAgentEnabled(id, enabled) {
  return withState((s) => {
    const a = s.agents.find((x) => x.id === id);
    if (!a) throw new Error("Agent not found.");
    a.enabled = !!enabled;
    a.disabledBy = enabled ? null : currentUser();
    a.disabledTs = enabled ? null : Date.now();
    return { id, enabled: a.enabled };
  });
}

export function setChannelEnabled(key, enabled) {
  return withState((s) => {
    const c = s.channels.find((x) => x.key === key);
    if (!c) throw new Error("Channel not found.");
    c.enabled = !!enabled;
    c.pausedTs = enabled ? null : Date.now();
    return { key, enabled: c.enabled };
  });
}

export function addSuppression({ contact, reason }) {
  return withState((s) => {
    const errors = validateSuppression({ contact, reason });
    if (Object.keys(errors).length) {
      const err = new Error("Please fix the highlighted fields.");
      err.fields = errors;
      throw err;
    }
    s.seq += 1;
    s.suppression.unshift({ id: `x${s.seq}`, contact: contact.trim(), reason: reason.trim(), added: shortDate(Date.now()) });
    return { ok: true };
  });
}

// Re-exported so the scheduler can run the same conflict check the routes would.
export { checkConflict };
