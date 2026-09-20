// The real service layer behind every function the frontend's src/services/api.js mocks.
// Function names and return shapes are kept identical to that file on purpose (see the
// frontend README: "Backend swap: reimplement functions in src/services/api.js with fetch();
// keep names and return shapes") — only the storage (JSON file via src/db/index.js instead of
// sessionStorage) and the fact that campaign/prospect/agent data is real and mutable server-side
// have changed.
import { getState, withState } from "../db/index.js";
import { addEvent, canTransition, effectiveStatus, isRunning, pct, zeroFunnel, agentStatus } from "./logic.js";
import { STAGE_KEYS, STAGE_LABELS, CARD_CHANNEL_LABELS, CHANNEL_KEYS } from "./constants.js";
import { validateCampaign, validateSuppression } from "../utils/validation.js";
import { shortDate } from "../utils/format.js";
import { checkConflict } from "./conflict.js";
import { getUsage } from "./usage.js";
import { docLength } from "./rag.js";
import { SDR_STEPS } from "./sdrSteps.js";
import { FIXED_PROMPTS } from "./agentEngine/geminiEngine.js";
import { newProspect } from "./prospects.js";
import { addFact } from "./dossier.js";
import { recordReply, recordTouch } from "./outreach.js";
import { sentToday } from "./limits.js";
import { campaignsNeedingReps, pickRep, repTouchesToday } from "./reps.js";
import { parseWorkingHours, simClockLabel, withinWorkingHours } from "./simTime.js";
import { config, isDronahqMode, isGeminiMode } from "../config.js";
import { embeddingsStatus } from "./embeddings.js";
import { normalisePhone } from "./contacts.js";
import { dispatch } from "./channels/dispatch.js";
import { channelBlocker, gmailReady, isRealCampaign, realChannels, recipientBlocker, smsReady, voiceReady } from "./realMode.js";
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

// The campaign dashboard's "agent activity" (PS: active, completed and failed workflows, pending approvals, escalations).
// A workflow here is one agent step for one prospect: in flight = prospects still moving through the funnel, completed =
// decisions the running system made (each is in the Decision Journal), failed = steps that threw (contained and retried).
function activityFor(s, c, pending) {
  const inFlight = s.prospects.filter(
    (p) => p.campaignId === c.id && ["researched", "qualified", "contacted", "engaged"].includes(p.stage) && !p.closedOut
  ).length;
  return {
    inFlight,
    completed: s.decisions.filter((d) => d.campaignId === c.id && d.engine && d.engine !== "error").length,
    failed: (c.failures && c.failures.total) || 0,
    pendingApprovals: pending.length,
    escalations: pending.filter((a) => a.type === "escalation").length,
  };
}

// Outcomes: how replies split (positive = wants a meeting, negative = opt-out or hostile, neutral = a question or an
// objection) and the conversion rates between funnel stages.
function outcomesFor(c, f, o) {
  const split = c.outcomes || { positive: 0, negative: 0, neutral: 0 };
  const total = split.positive + split.negative + split.neutral;
  return {
    positive: split.positive, negative: split.negative, neutral: split.neutral, total,
    positiveRate: pct(split.positive, total), negativeRate: pct(split.negative, total),
    meetings: f.meeting,
    rates: {
      qualify: pct(f.qualified, f.discovered),
      reply: Math.min(100, pct(o.replies, f.contacted)),
      meeting: Math.min(100, pct(f.meeting, f.contacted)),
      opportunity: Math.min(100, pct(f.opportunity, f.meeting)),
    },
  };
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

const isSandbox = (s, campaignId) => { const c = s.campaigns.find((x) => x.id === campaignId); return !!(c && c.sandbox); };
// A finished campaign has nothing left to approve: its drafts must never be sent, so they do not count or show.
const isClosed = (s, campaignId) => { const c = s.campaigns.find((x) => x.id === campaignId); return !!(c && (c.status === "completed" || c.status === "archived")); };
const pendingApprovals = (s) => s.approvals.filter((a) => a.status === "pending" && !isSandbox(s, a.campaignId) && !isClosed(s, a.campaignId)).sort((a, b) => b.requestedTs - a.requestedTs);

function approvalQueueItem(a) {
  return { id: a.id, text: a.summary, tag: a.tag, tone: a.tagTone, ts: a.requestedTs };
}

function transition(s, id, to, eventText) {
  const c = campaignOf(s, id);
  if (!canTransition(c.status, to)) throw new Error(`A ${c.status} campaign cannot move to ${to}.`);
  c.status = to;
  c.modifiedTs = Date.now();
  if (to === "completed" || to === "archived") {
    // Withdraw what is still waiting for a human: nothing more will be sent from a finished campaign.
    for (const a of s.approvals) {
      if (a.campaignId === id && a.status === "pending") { a.status = "withdrawn"; a.decidedTs = Date.now(); a.reason = `Campaign ${to}`; }
    }
  }
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
  const cs = s.campaigns.filter((c) => !c.sandbox);
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
    repAlerts: campaignsNeedingReps(s),
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
      .filter((e) => e.featured && !isSandbox(s, e.campaignId))
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
    icpSummary: c.icpSummary, objective: c.objective, owner: c.owner, modifiedTs: c.modifiedTs, lastTickTs: c.lastTickTs || null,
    metrics: { pipeline: f.discovered, qualifyRate: pct(f.qualified, f.discovered), responseRate: draft ? 0 : c.responseRate, meetings: f.meeting },
    funnel: STAGE_KEYS.map((k) => ({ key: k, label: STAGE_LABELS[k], value: f[k] })),
    timeline: draft ? [] : s.events.filter((e) => e.campaignId === id).sort((a, b) => b.ts - a.ts).slice(0, 4).map((e) => ({ id: e.id, type: e.type, text: e.text, ts: e.ts })),
    outreach: o,
    approvals: { count: pending.length, items: pending.slice(0, 2).map(approvalQueueItem) },
    agents: s.agents.map((a) => ({
      id: a.id, title: a.title, globallyEnabled: a.enabled,
      enabled: !(c.agentsEnabled && c.agentsEnabled[a.id] === false),
    })),
    reps: (c.repIds || []).map((rid) => s.reps.find((r) => r.id === rid)).filter(Boolean).map((r) => ({ id: r.id, name: r.name, status: r.status, sentToday: repTouchesToday(s, r.id) })),
    repOptions: s.reps.filter((r) => r.status === "active").map((r) => ({ id: r.id, name: r.name })),
    copiedFrom: c.copiedFrom ? (() => { const o = s.campaigns.find((x) => x.id === c.copiedFrom); return o ? { id: o.id, name: o.name } : null; })() : null,
    activity: activityFor(s, c, pending),
    outcomes: outcomesFor(c, f, o),
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
    name: c.name, description: c.description, owner: c.owner, objective: c.objective, offer: c.offer || "", icpText: c.icpText,
    mode: c.mode || "bulk", sourcing: c.sourcing || "synthetic", audienceKind: c.audienceKind || "organisations", target: c.target || null,
    geographyOptions: union(GEOGRAPHY_OPTIONS, c.geography), geography: [...c.geography],
    personaOptions: union(PERSONA_OPTIONS, c.personas), personas: [...c.personas],
    companyCriteria: c.companyCriteria, exclusionCriteria: c.exclusionCriteria, channels: [...c.channels],
    qualificationPrompt: c.qualificationPrompt, dailyLimit: c.dailyLimit, workingHours: c.workingHours,
    cadence: { ...(c.cadence || { maxTouches: 3, waitHours: 72 }) },
    approvals: { ...c.approvals }, sources: c.sources.map(sourceView),
  };
}

/**
 * A blank campaign for the create form. Nothing is pre-filled with example content: the form's own hints say what each
 * field is for. Only structural defaults (manual approvals, one channel, sensible limits) are set.
 */
export function getCampaignDefaults() {
  return {
    name: "", description: "", owner: currentUser(), objective: "", offer: "", brief: "", icpText: "",
    mode: "bulk", sourcing: "simulated-search", audienceKind: "organisations", target: { name: "", title: "", organisation: "", email: "", phone: "", notes: "" },
    geographyOptions: [...GEOGRAPHY_OPTIONS], geography: [], personaOptions: [...PERSONA_OPTIONS], personas: [],
    companyCriteria: "", exclusionCriteria: "", channels: ["email"], qualificationPrompt: "",
    dailyLimit: 25, workingHours: "9:00 AM – 6:00 PM", cadence: { maxTouches: 3, waitHours: 72 },
    approvals: { firstOutreach: true, meetingTime: true, escalate: true, level: "manual", autoMinScore: 85, autoAfterApproved: 3 },
    sources: [],
  };
}

/** An existing campaign's settings, for the edit form. Knowledge sources are edited from the campaign page. */
export function getCampaignConfig(id) {
  const s = getState();
  const c = campaignOf(s, id);
  return { ...formValues(c), id: c.id, rawStatus: c.status };
}

/**
 * Campaigns side by side (PS: compare performance across campaigns, and a campaign against its variant): funnel
 * results, reply outcomes and cost. Cost is today's LLM spend for the campaign (from token counts) divided by the
 * work it produced today; `avoided` is the share of decisions that needed no LLM call.
 */
export function getComparison(ids) {
  const s = getState();
  const usage = getUsage();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const chosen = (ids && ids.length ? ids : s.campaigns.filter((c) => c.status !== "archived" && !c.sandbox).map((c) => c.id))
    .map((id) => s.campaigns.find((c) => c.id === id))
    .filter(Boolean);

  return chosen.map((c) => {
    const draft = c.status === "draft";
    const f = draft ? zeroFunnel() : c.funnel;
    const o = draft ? { emails: 0, linkedin: 0, replies: 0, followups: 0 } : c.outreach;
    const out = outcomesFor(c, f, o);
    const cu = usage.byCampaign[c.id] || { decisions: 0, avoided: 0, estCostUsd: 0 };
    const todayDecisions = s.decisions.filter((d) => d.campaignId === c.id && d.engine && d.ts >= startOfDay.getTime());
    const qualifiedToday = todayDecisions.filter((d) => d.kind === "qualified").length;
    const scoredToday = todayDecisions.filter((d) => d.kind === "qualified" || d.kind === "rejected").length;
    const per = (cost, n) => (n ? Number((cost / n).toFixed(6)) : null);
    return {
      id: c.id, name: c.name, status: effectiveStatus(s, c), copiedFrom: c.copiedFrom || null,
      prospects: f.discovered, qualified: f.qualified, contacted: f.contacted, replies: o.replies, meetings: f.meeting,
      qualifyRate: out.rates.qualify, replyRate: out.rates.reply, meetingRate: out.rates.meeting,
      positiveRate: out.positiveRate, negativeRate: out.negativeRate, responses: out.total,
      failed: (c.failures && c.failures.total) || 0,
      llmDecisions: cu.decisions, decisionsWithoutLlm: cu.avoided,
      avoidedPct: cu.decisions + cu.avoided ? Math.round((cu.avoided / (cu.decisions + cu.avoided)) * 100) : null,
      costTodayUsd: cu.estCostUsd, costPerProspect: per(cu.estCostUsd, scoredToday), costPerQualified: per(cu.estCostUsd, qualifiedToday),
      qualifiedToday, scoredToday,
    };
  });
}

const CORE_AGENTS = ["icp", "strategy", "personalisation", "conversation", "followup"];

/**
 * What a manager should see before activating a campaign (PS design question). Each check is ok, warn (can proceed,
 * worth knowing) or block (cannot launch until fixed).
 */
export function getLaunchReview(id) {
  const s = getState();
  const c = campaignOf(s, id);
  const checks = [];
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail });

  // Required settings are complete (the same validation launching enforces).
  const errors = validateCampaign({ ...c, geography: c.geography, personas: c.personas }, true);
  if (!(c.offer || "").trim()) add("offer", "What we offer", "block", "Say what this campaign offers. Agents can only make claims that appear in the offer or the knowledge sources.");
  if (Object.keys(errors).length) add("config", "Campaign settings", "block", `Missing or invalid: ${Object.values(errors).join(" ")}`);
  else add("config", "Campaign settings", "ok", "Name, ICP, targeting, qualification criteria and limits are filled in.");

  if (s.killSwitch.active) add("kill", "Global kill switch", "block", "The kill switch is on, so nothing can start. Turn it off in Settings first.");

  // Channels
  const on = c.channels.filter((k) => s.channels.some((x) => x.key === k && x.enabled));
  const off = c.channels.filter((k) => !on.includes(k));
  if (!on.length) add("channels", "Channels", "block", `None of this campaign's channels (${c.channels.join(", ") || "none selected"}) is enabled, so nothing can be sent.`);
  else if (off.length) add("channels", "Channels", "warn", `${on.join(", ")} enabled. ${off.join(", ")} is paused platform-wide and will be skipped.`);
  else add("channels", "Channels", "ok", `${on.join(", ")} enabled.`);

  // A real address typed into a simulated campaign is the easy mistake: nothing is sent and the replies are invented.
  if (c.sourcing !== "real" && c.mode === "single" && c.target && c.target.email && !/\.example$/i.test(c.target.email)) {
    add("simulated-real", "Real address, simulated data", "warn", `${c.target.email} looks like a real address, but this campaign is set to Simulated data: nothing will be emailed, and any replies will be made up. Create the campaign again with Real data to email them for real.`);
  }

  // Real data and real sending
  if (c.sourcing === "real") {
    const usable = realChannels(c.channels);
    const blockedWhy = c.channels.map((k) => `${k}: ${channelBlocker(k) || "ready"}`).join("; ");
    if (!usable.length) add("real", "Real sending", "block", `This campaign uses real data, but none of its channels can really send yet. ${blockedWhy}.`);
    else if (usable.length < c.channels.length) add("real", "Real sending", "warn", `Ready to send for real on ${usable.join(", ")}. Not on the others (${blockedWhy}).`);
    else add("real", "Real sending", "ok", `Real messages will be sent on ${usable.join(", ")}. Every message to a real person waits for a human to approve it${config.realAutoSend ? " (REAL_AUTO_SEND is on, so approved levels apply)" : ""}.`);
    if (c.mode !== "single") {
      const n = (s.realContacts || []).length;
      add("contacts", "Real contacts", n ? "ok" : "block", n ? `${n} real contact${n === 1 ? "" : "s"} to choose from.` : "There are no real contacts. Add people in the Dev tab first.");
    }
  }

  // Knowledge
  if (!c.sources.length) add("knowledge", "Knowledge base", "warn", "No knowledge sources. Agents will have nothing to retrieve from and drafts will be generic.");
  else add("knowledge", "Knowledge base", "ok", `${c.sources.length} source${c.sources.length === 1 ? "" : "s"} for this campaign's agents.`);

  // Agents
  const stopped = CORE_AGENTS.filter((a) => {
    const agent = s.agents.find((x) => x.id === a);
    return !agent || !agent.enabled || (c.agentsEnabled && c.agentsEnabled[a] === false);
  });
  if (stopped.length) add("agents", "Agents", "warn", `Paused: ${stopped.join(", ")}. The pipeline will stall at those steps.`);
  else add("agents", "Agents", "ok", "All core agents are on.");

  // Approval policy
  const level = (c.approvals && c.approvals.level) || "manual";
  if (level === "autonomous") add("approvals", "Approvals", "warn", "Autonomous: first outreach and meetings are sent without waiting for a human. Escalated objections still need one.");
  else if (level === "assisted") add("approvals", "Approvals", "ok", `Assisted: drafts wait for you until you have approved ${c.approvals.autoAfterApproved ?? 3}, then fit ${c.approvals.autoMinScore ?? 85}+ goes out on its own.`);
  else add("approvals", "Approvals", "ok", "Manual: every toggled action waits in the Approvals queue.");

  // Overlap with campaigns that are running: the same people may be targeted twice.
  const overlaps = s.campaigns.filter(
    (o) => o.id !== c.id && (o.status === "live" || o.status === "paused") &&
      o.personas.some((p) => c.personas.includes(p)) && o.geography.some((g) => c.geography.includes(g))
  );
  if (overlaps.length) {
    add("overlap", "Overlap with other campaigns", "warn", `Same roles and region as ${overlaps.map((o) => o.name).join(", ")}. The 14-day conflict rule stops one person being contacted twice, but prospects may be split between them.`);
  } else add("overlap", "Overlap with other campaigns", "ok", "No other running campaign targets the same roles in the same region.");

  // Volume this launch could produce
  const touches = (c.cadence && c.cadence.maxTouches) || 3;
  add("volume", "Expected volume", "ok", `Up to ${c.dailyLimit || "an unlimited number of"} touches per simulated day, ${touches} touches per prospect, ${(c.cadence && c.cadence.waitHours) || 72}h apart.`);

  const sp = c.systemPrompt && c.systemPrompt.versions.find((v) => v.version === c.systemPrompt.active);
  add("prompts", "Prompts", "ok", `Campaign prompt v${sp ? sp.version : 1}; agents pinned to ${Object.entries(c.promptPins || {}).slice(0, 5).map(([a, v]) => `${a} ${v}`).join(", ")}.`);

  return { id: c.id, name: c.name, status: c.status, ready: !checks.some((k) => k.status === "block"), checks };
}

/** The calendar invite (.ics) for a booked meeting. */
export function getMeetingIcs(prospectId) {
  const p = getState().prospects.find((x) => x.id === prospectId);
  if (!p) throw new Error("Prospect not found.");
  if (!p.meeting || p.meeting.status !== "confirmed") throw new Error("No meeting is booked for this prospect.");
  return p.meeting.ics;
}

/** Prospects across campaigns. Those of completed or archived campaigns are history: shown only when asked for. Sandbox runs never. */
export function getProspects({ includeClosed = false } = {}) {
  const s = getState();
  return s.prospects.filter((p) => !isSandbox(s, p.campaignId) && (includeClosed || !isClosed(s, p.campaignId))).map((p) => prospectRow(s, p));
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
  const sorted = s.decisions.filter((d) => !isSandbox(s, d.campaignId)).sort((a, b) => b.ts - a.ts);
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
    step: (() => { const st = SDR_STEPS.find((x) => x.agentId === a.id); return st ? { purpose: st.purpose, reads: st.reads, writes: st.writes } : null; })(),
    fixedPrompt: FIXED_PROMPTS()[a.id] || null,
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
    integrations: integrationStatus(),
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

/** The one person a single-target campaign is aimed at, as typed in. `notes` may be text (one fact per line) or a list. */
function normalizeTarget(t = {}) {
  const lines = Array.isArray(t.notes) ? t.notes : String(t.notes || "").split(/\r?\n/);
  return {
    name: String(t.name || "").trim().slice(0, 120), title: String(t.title || "").trim().slice(0, 160), organisation: String(t.organisation || "").trim().slice(0, 160),
    email: String(t.email || "").trim().slice(0, 160), phone: String(t.phone || "").trim().slice(0, 40), notes: lines.map((x) => String(x).trim()).filter(Boolean).slice(0, 20), real: !!t.real,
  };
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
      owner: (values.owner || "").trim() || currentUser(), objective: (values.objective || "").trim(), offer: (values.offer || "").trim(), mode: values.mode === "single" ? "single" : "bulk", sourcing: ["synthetic", "real"].includes(values.sourcing) ? values.sourcing : "simulated-search", audienceKind: values.audienceKind === "individuals" ? "individuals" : "organisations", sandbox: !!values.sandbox, target: values.mode === "single" ? normalizeTarget(values.target) : null, description: (values.description || "").trim(),
      icpSummary: [(values.personas || []).join(" & "), (values.geography || []).join(", ")].filter(Boolean).join(" · "),
      icpText: (values.icpText || "").trim(), geography: values.geography || [], personas: values.personas || [],
      companyCriteria: values.companyCriteria || "", exclusionCriteria: values.exclusionCriteria || "", channels: values.channels || [],
      qualificationPrompt: (values.qualificationPrompt || "").trim(), dailyLimit: Number(values.dailyLimit) || 0,
      workingHours: values.workingHours || "", cadence: normalizeCadence(values.cadence), approvals: normalizeApprovals(values.approvals), sources: normalizeSources(values.sources),
      funnel: zeroFunnel(), outreach: { emails: 0, linkedin: 0, replies: 0, followups: 0, costPerQualified: 0 },
      responseRate: 0, createdTs: now, modifiedTs: now,
    });
    initCampaignPrompts(s.campaigns[s.campaigns.length - 1], s.agents, currentUser());
    const created = s.campaigns[s.campaigns.length - 1];
    if (created.mode === "single" && created.target && created.target.name) {
      // A single-target campaign is aimed at exactly the person entered: they become its one prospect.
      const t = created.target;
      const real = created.sourcing === "real" && !created.sandbox;
      const p = newProspect(created, { name: t.name, title: t.title, company: t.organisation || "Independent", email: t.email || undefined, phone: t.phone || "" }, { provider: "entered by a person", real: real || !created.sandbox || !!t.real, note: "Details typed in by a person" });
      if (real) { p.email = t.email || ""; p.phone = normalisePhone(t.phone); }
      for (const note of t.notes) addFact(p, { text: note, source: "entered by a person", kind: "profile" });
      p.sandboxHuman = !!created.sandbox;
      s.prospects.push(p);
      created.funnel.discovered += 1;
    }
    // The brief written on the form becomes the campaign's first prompt; empty keeps the generated default.
    if ((values.brief || "").trim()) s.campaigns[s.campaigns.length - 1].systemPrompt.versions[0].text = values.brief.trim();
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
    c.offer = (values.offer || "").trim();
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
      id: newId, name, shortName: name, status: "draft", copiedFrom: src.id,
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
    if (isClosed(s, a.campaignId)) throw new Error("This campaign is finished, so nothing more can be sent from it.");
    if (action !== "approve" && action !== "reject") throw new Error("Unknown action.");
    if (action === "reject" && !reason.trim()) throw new Error("Add a reason before rejecting.");

    const now = Date.now();
    const p = s.prospects.find((x) => x.id === a.prospectId);
    const c = s.campaigns.find((x) => x.id === a.campaignId);
    if (action === "approve" && p && isRealCampaign(c) && a.channel) {
      const why = channelBlocker(a.channel) || recipientBlocker(a.channel, p);
      if (why) throw new Error(`This cannot be sent for real: ${why}.`);
    }
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
        } else if (a.meetingProposal) {
          // The approved proposal is what the prospect now sees; their answer is read against these times.
          recordReply(s, c, p, { channel: a.channel || (c.channels && c.channels[0]) || "email", body: (a.draft && a.draft.body) || "" });
          if (p.meeting) p.meeting.status = "proposed";
        } else {
          const o = OUTCOMES[a.type];
          // The approved (possibly edited) draft is what actually goes out, so keep it in the conversation.
          const outgoing = a.draft && a.draft.body && (a.type === "followup" || (isRealCampaign(c) && (a.type === "pricing" || a.type === "escalation")));
          if (outgoing) {
            const entry = { dir: "out", text: a.draft.body, when: "Today", channel: a.channel };
            p.conversation.push(entry);
            // For a real person this is where the approved reply actually goes out.
            const rep = pickRep(s, c, a.channel || "email", { preferId: p.repId }) || pickRep(s, c, a.channel || "email", { preferId: p.repId, strict: false });
            if (rep) { entry.sender = rep.name; p.repId = rep.id; }
            dispatch(s, c, p, { channel: a.channel || "email", subject: "", body: a.draft.body, rep, kind: "reply" }, [entry]);
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
        if (a.meetingProposal) p.meeting = null; // the proposal was never sent
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

/** Agent pause (PS "levels of control"): stop or start ONE agent in ONE campaign; the rest of the campaign continues. */
export function setCampaignAgentEnabled(campaignId, agentId, enabled) {
  return withState((s) => {
    const c = campaignOf(s, campaignId);
    const agent = s.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error("Agent not found.");
    if (c.status === "archived") throw new Error("An archived campaign cannot be edited.");
    c.agentsEnabled = { ...(c.agentsEnabled || {}), [agentId]: !!enabled };
    c.modifiedTs = Date.now();
    addEvent(s, { campaignId, type: enabled ? "resume" : "paused", text: `${currentUser()} ${enabled ? "turned on" : "paused"} **${agent.title}** in **${c.name}**`, featured: false });
    return { agentId, enabled: !!enabled };
  });
}

// ---- representatives -------------------------------------------------------------------------------------------

const repView = (s, r) => ({
  id: r.id, name: r.name, email: r.email, channels: r.channels, dailyLimit: r.dailyLimit, workingHours: r.workingHours,
  status: r.status, offboardedTs: r.offboardedTs, sentToday: repTouchesToday(s, r.id),
  campaigns: s.campaigns.filter((c) => (c.repIds || []).includes(r.id) && c.status !== "archived").map((c) => ({ id: c.id, name: c.name, status: c.status })),
  prospects: s.prospects.filter((p) => p.repId === r.id).length,
});

export function getReps() {
  const s = getState();
  return { reps: s.reps.map((r) => repView(s, r)), alerts: campaignsNeedingReps(s) };
}

function validateRep(v) {
  const e = {};
  if (!v.name || v.name.trim().length < 2) e.name = "Enter the rep's name.";
  if (!v.email || !/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (!Array.isArray(v.channels) || !v.channels.length || v.channels.some((c) => !CHANNEL_KEYS.includes(c))) e.channels = "Select at least one channel.";
  const n = Number(v.dailyLimit);
  if (!Number.isFinite(n) || n < 1 || n > 500) e.dailyLimit = "Enter a number between 1 and 500.";
  if (!parseWorkingHours(v.workingHours)) e.workingHours = "Enter working hours like 9:00 AM – 6:00 PM.";
  if (Object.keys(e).length) {
    const err = new Error("Please fix the highlighted fields.");
    err.fields = e;
    throw err;
  }
}

export function createRep(values = {}) {
  return withState((s) => {
    validateRep(values);
    s.seq += 1;
    const rep = {
      id: `r_${s.seq}`, name: values.name.trim(), email: values.email.trim(), channels: values.channels, dailyLimit: Number(values.dailyLimit),
      workingHours: values.workingHours.trim(), status: "active", offboardedTs: null,
    };
    s.reps.push(rep);
    return repView(s, rep);
  });
}

export function updateRep(id, values = {}) {
  return withState((s) => {
    const rep = s.reps.find((r) => r.id === id);
    if (!rep) throw new Error("Rep not found.");
    if (rep.status !== "active") throw new Error("An offboarded rep cannot be edited.");
    validateRep(values);
    Object.assign(rep, { name: values.name.trim(), email: values.email.trim(), channels: values.channels, dailyLimit: Number(values.dailyLimit), workingHours: values.workingHours.trim() });
    return repView(s, rep);
  });
}

/** Offboarding: the rep stops sending at once, and every campaign that used them is surfaced so an admin can reassign it. */
export function offboardRep(id) {
  return withState((s) => {
    const rep = s.reps.find((r) => r.id === id);
    if (!rep) throw new Error("Rep not found.");
    if (rep.status !== "active") throw new Error("This rep is already offboarded.");
    rep.status = "offboarded";
    rep.offboardedTs = Date.now();
    const affected = s.campaigns
      .filter((c) => (c.repIds || []).includes(id) && c.status !== "archived")
      .map((c) => {
        const remaining = c.repIds.map((rid) => s.reps.find((r) => r.id === rid)).filter((r) => r && r.status === "active");
        return { id: c.id, name: c.name, status: c.status, activeRepsLeft: remaining.length };
      });
    addEvent(s, { campaignId: null, type: "edit", text: `${currentUser()} offboarded **${rep.name}**. ${affected.length} campaign${affected.length === 1 ? "" : "s"} used them${affected.some((c) => !c.activeRepsLeft) ? ", and some now have no active rep" : ""}`, featured: true });
    return { id, affected };
  });
}

/** Hands a rep's campaigns and prospects to another active rep (typically after offboarding). */
export function reassignRep(fromId, toId) {
  return withState((s) => {
    const from = s.reps.find((r) => r.id === fromId);
    const to = s.reps.find((r) => r.id === toId);
    if (!from || !to) throw new Error("Rep not found.");
    if (to.status !== "active") throw new Error("Choose an active rep to reassign to.");
    if (fromId === toId) throw new Error("Choose a different rep.");
    let campaigns = 0;
    for (const c of s.campaigns) {
      if (!(c.repIds || []).includes(fromId)) continue;
      c.repIds = c.repIds.filter((x) => x !== fromId);
      if (!c.repIds.includes(toId)) c.repIds.push(toId);
      c.modifiedTs = Date.now();
      campaigns += 1;
    }
    let prospects = 0;
    for (const p of s.prospects) if (p.repId === fromId) { p.repId = toId; prospects += 1; }
    addEvent(s, { campaignId: null, type: "edit", text: `${currentUser()} reassigned ${campaigns} campaign${campaigns === 1 ? "" : "s"} and ${prospects} prospect${prospects === 1 ? "" : "s"} from **${from.name}** to **${to.name}**`, featured: true });
    return { campaigns, prospects };
  });
}

export function setCampaignReps(campaignId, repIds) {
  return withState((s) => {
    const c = campaignOf(s, campaignId);
    if (c.status === "archived") throw new Error("An archived campaign cannot be edited.");
    const ids = [...new Set(Array.isArray(repIds) ? repIds : [])];
    for (const id of ids) {
      const r = s.reps.find((x) => x.id === id);
      if (!r) throw new Error("Rep not found.");
      if (r.status !== "active" && !(c.repIds || []).includes(id)) throw new Error(`${r.name} is offboarded.`);
    }
    c.repIds = ids;
    c.modifiedTs = Date.now();
    addEvent(s, { campaignId, type: "edit", text: `${currentUser()} set the reps for **${c.name}** to ${ids.map((id) => s.reps.find((r) => r.id === id).name).join(", ") || "no one"}`, featured: false });
    return { repIds: ids };
  });
}

/** How this campaign's voice is set: tone and sign-off are added to the prompt every agent receives. Logged like a prompt change. */
export function setCampaignPersona(campaignId, { tone = "", signOff = "" } = {}) {
  return withState((s) => {
    const c = promptCampaign(s, campaignId);
    c.persona = { tone: String(tone).trim().slice(0, 300), signOff: String(signOff).trim().slice(0, 80) };
    c.modifiedTs = Date.now();
    logPromptChange(c, currentUser(), `Persona: ${c.persona.tone || "no tone set"}${c.persona.signOff ? `; sign-off "${c.persona.signOff}"` : ""}`);
    return c.persona;
  });
}

/**
 * The complete definition of this campaign's SDR in one place: mission, persona, the steps it runs (the same list the
 * scheduler executes), its tools, its shared memory and its policies.
 */
export function getBlueprint(id) {
  const s = getState();
  const c = campaignOf(s, id);
  const decisions = s.decisions.filter((d) => d.campaignId === id && d.engine);
  const sp = c.systemPrompt && c.systemPrompt.versions.find((v) => v.version === c.systemPrompt.active);
  const prospects = s.prospects.filter((p) => p.campaignId === id);
  const withDossier = prospects.filter((p) => p.dossier && (p.dossier.notes.length || p.dossier.facts.length));

  const steps = SDR_STEPS.map((step) => {
    const agent = s.agents.find((a) => a.id === step.agentId);
    const own = decisions.filter((d) => agentDecisionKey(d) === step.key);
    return {
      ...step,
      title: step.title,
      enabled: !!agent && agent.enabled && !(c.agentsEnabled && c.agentsEnabled[step.agentId] === false),
      globallyEnabled: !!agent && agent.enabled,
      pinned: agent ? pinnedVersion(agent, c).version : null,
      decisions: own.length,
      llmDecisions: own.filter((d) => !["rule", "rule-shortcut", "policy", "embedding-router", "auto-approval", "error"].includes(d.engine)).length,
    };
  });

  const level = (c.approvals && c.approvals.level) || "manual";
  return {
    id: c.id, name: c.name,
    mission: { objective: c.objective, offer: c.offer, target: c.icpText, mode: c.mode || "bulk", targetPerson: c.target || null, brief: sp ? sp.text : "", briefVersion: sp ? sp.version : null },
    persona: { tone: (c.persona && c.persona.tone) || "", signOff: (c.persona && c.persona.signOff) || "" },
    steps,
    tools: [
      { name: "Knowledge retrieval", status: c.sources.length ? "on" : "empty", note: `${c.sources.length} source${c.sources.length === 1 ? "" : "s"} searched by meaning before every decision` },
      c.mode === "single"
        ? { name: "Prospect sourcing", status: "on", note: "Single-target: the campaign is aimed at one named person, entered by a person" }
        : c.sourcing === "real"
        ? { name: "Prospect sourcing", status: "on", note: "Real contacts: people entered by hand in the Dev tab, picked by how well they match the audience" }
        : { name: "Prospect sourcing", status: "simulated", note: c.sourcing === "simulated-search" ? "Imitated people search: an AI acts as a search tool and returns fictional people that match the audience" : "Free generator of made-up company prospects. Real data sources are on the roadmap" },
      { name: "Reply routing", status: "on", note: "Clear opt-outs, hostile replies and out-of-office handled without an LLM" },
      { name: "Grounding check", status: "on", note: "Every draft is checked against the knowledge and the dossier before it can go out" },
      ...c.channels.map((k) => ({ name: `Channel: ${k}`, status: s.channels.some((x) => x.key === k && x.enabled) ? "simulated" : "off", note: s.channels.some((x) => x.key === k && x.enabled) ? "Sends are recorded, not delivered" : "Paused platform-wide" })),
    ],
    memory: {
      description: "One dossier per prospect. Every step reads all of it and leaves a hand-off note for the next.",
      prospectsWithDossier: withDossier.length,
      notes: withDossier.reduce((n, p) => n + p.dossier.notes.length, 0),
      facts: withDossier.reduce((n, p) => n + p.dossier.facts.length, 0),
    },
    policies: [
      { label: "Approvals", value: level === "manual" ? "Manual: every toggled action waits for a human" : level === "assisted" ? `Assisted: auto-sends at fit ${c.approvals.autoMinScore ?? 85}+ after ${c.approvals.autoAfterApproved ?? 3} approvals` : "Autonomous: only escalations wait for a human" },
      { label: "Working hours", value: c.workingHours || "not set" },
      { label: "Daily limit", value: c.dailyLimit ? `${c.dailyLimit} touches per simulated day` : "none" },
      { label: "Cadence", value: `${(c.cadence && c.cadence.maxTouches) || 3} touches, ${(c.cadence && c.cadence.waitHours) || 72}h apart` },
      { label: "Escalation", value: c.approvals && c.approvals.escalate ? "Objections and compliance questions go to a human" : "Objections handled by the agent" },
      { label: "Safety", value: "Kill switch, agent and channel pause, suppression list, 14-day cross-campaign rule, grounding check" },
      { label: "Representatives", value: (c.repIds || []).length ? `${c.repIds.length} assigned; each touch is sent as one of them` : "None assigned" },
    ],
  };
}

// Which pipeline step a journal entry belongs to, from the agent's name.
function agentDecisionKey(d) {
  const a = d.agent || "";
  if (/ICP/i.test(a)) return "icp";
  if (/Strategy/i.test(a) && !/Personalisation/i.test(a)) return "strategy";
  if (/Personalisation/i.test(a) || /Approval Policy/i.test(a)) return "personalisation";
  if (/Follow-up/i.test(a)) return "followup";
  if (/Conversation|Reply Router/i.test(a)) return "conversation";
  if (/Lead Research/i.test(a)) return "discovery";
  return null;
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

export function saveCampaignSystemPrompt(campaignId, text, message = "") {
  return withState((s) => {
    const c = promptCampaign(s, campaignId);
    if (!text || !text.trim()) throw new Error("The campaign prompt cannot be empty.");
    // Like a commit message: say what changed and why, so the history explains itself and a bad change can be traced.
    const note = String(message || "").trim().slice(0, 200);
    if (note.length < 3) throw Object.assign(new Error("Describe what you changed and why."), { fields: { message: "Describe what you changed and why." } });
    const next = Math.max(...c.systemPrompt.versions.map((v) => v.version)) + 1;
    c.systemPrompt.versions.push({ version: next, text: text.trim(), by: currentUser(), ts: Date.now(), message: note });
    c.systemPrompt.active = next;
    c.modifiedTs = Date.now();
    logPromptChange(c, currentUser(), `Campaign prompt v${next}: ${note}`);
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


/**
 * The prompt an agent ran with, rebuilt from the versions named in a harness label such as "v1.2 + campaign prompt v3".
 * Without a harness it is what the agent would receive right now. Library and campaign prompt versions are never
 * overwritten, so an old decision's prompt can be shown exactly; a campaign's override is shown as it is today.
 */
export function inspectPrompt(campaignId, agentId, harness = "") {
  const s = getState();
  const c = campaignOf(s, campaignId);
  const agent = s.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Agent not found.");
  const m = /^(\S+?)(?: \+ campaign prompt v(\d+))?$/.exec(String(harness || "").trim());
  const agentVersion = (m && agent.versions.find((v) => v.version === m[1])) || pinnedVersion(agent, c);
  const systemVersion = (m && m[2] && c.systemPrompt && c.systemPrompt.versions.find((v) => v.version === Number(m[2]))) || (c.systemPrompt && c.systemPrompt.versions.find((v) => v.version === c.systemPrompt.active));
  const persona = c.persona;
  const voice = persona && (persona.tone || persona.signOff)
    ? `Voice: ${[persona.tone && `write ${persona.tone}`, persona.signOff && `the sign-off "${persona.signOff}" is added automatically, so do not write one`].filter(Boolean).join("; ")}.` : "";
  const override = agent.overrides.find((o) => o.campaignId === c.id);
  return {
    agent: agent.title, agentId, campaign: c.name, exact: !!m && !!agent.versions.find((v) => v.version === (m && m[1])),
    parts: [
      systemVersion && { label: `Campaign prompt v${systemVersion.version}`, text: systemVersion.text },
      voice && { label: "Persona voice (current)", text: voice },
      agentVersion && { label: `${agent.title} prompt ${agentVersion.version}`, text: agentVersion.text },
      override && { label: "This campaign's extra instruction for this agent (current)", text: override.text },
    ].filter(Boolean),
    fixed: "Every agent also receives the platform guardrails and escalation rules, the prospect's dossier, and any knowledge it retrieved. Those are added at run time.",
  };
}

/** What is actually connected, worked out from the running configuration (never a stored list). */
function integrationStatus() {
  const emb = embeddingsStatus();
  const geminiKey = !!config.gemini.apiKey;
  const real = config.realSending;
  return [
    {
      name: "Gemini", kind: "Model",
      state: geminiKey && isGeminiMode() ? "connected" : geminiKey ? "idle" : "not-configured",
      note: geminiKey && isGeminiMode() ? `Deciding and writing. Models: ${String(config.gemini.model)}` : geminiKey ? "Key is set but AGENT_ENGINE does not include gemini" : "No GEMINI_API_KEY: the rule engine decides instead",
    },
    {
      name: "Local embeddings (RAG)", kind: "Model",
      state: emb === "off" || emb === "unavailable" ? "not-configured" : "connected",
      note: emb === "off" ? "Switched off (EMBEDDINGS=off): retrieval and reply routing use plain word matching" : emb === "unavailable" ? "The model could not load: word matching is used instead" : "bge-small model running on this server, no key or cost",
    },
    {
      name: "DronaHQ Agentic AI", kind: "Agent platform",
      state: isDronahqMode() ? "problem" : "idle",
      note: isDronahqMode() ? "Configured, but its webhook has not returned agent output in our tests, so the chain falls back" : "An adapter is built but not in use: its webhook returned no agent output in our tests",
    },
    {
      name: "Gmail API", kind: "Email",
      state: gmailReady() ? (real ? "connected" : "idle") : "not-configured",
      note: gmailReady() ? (real ? `Sending and reading replies as ${config.gmail.sender}, for real campaigns only` : "Set up, but REAL_SENDING is off, so nothing is sent") : "Add the GMAIL_* settings to send real email. Until then email is simulated",
    },
    {
      name: "Twilio SMS", kind: "SMS",
      state: smsReady() ? (real ? "connected" : "idle") : "not-configured",
      note: smsReady() ? (real ? "Sending real texts, and receiving replies at /webhooks/twilio/sms, for real campaigns only" : "Set up, but REAL_SENDING is off, so nothing is sent") : "Add the TWILIO_* settings to send real texts. Until then SMS is simulated",
    },
    {
      name: "Twilio Voice", kind: "Calls",
      state: voiceReady() ? (real ? "connected" : "idle") : "not-configured",
      note: voiceReady() ? (real ? "The Voice SDR can place calls, for real campaigns only" : "Set up, but REAL_SENDING is off, so no call is placed") : "Needs the TWILIO_* settings and PUBLIC_URL. Voice is never used in a simulated campaign",
    },
    { name: "Apollo", kind: "Prospect data", state: "not-built", note: "Not built. Real prospects are the people you add by hand in the Dev tab; simulated ones come from the AI-imitated search" },
  ];
}
