// The Dev tab: tools for developers and judges to see how the SDR really behaves, kept apart from live campaigns.
//
//   Sandbox         a single-target campaign with a REAL person as the prospect. The SDR researches them, plans and
//                   writes the first message; the person reads it and types their own replies; the SDR answers,
//                   proposes meeting times and books one. Nothing is simulated on the prospect's side.
//   Search          try the imitated people search on any audience, without creating anything
//   Real-data tests enter real prospects with the answer you expect, run the ICP agent on them, and see how often it agrees
//   Runtime         which engines, limits and clocks are in force
//
// Sandbox campaigns are hidden from the dashboard, the approvals queue, the journal and comparisons.
import { getState, persistState } from "../db/index.js";
import { activeEngine, config } from "../config.js";
import { currentUser } from "./auth.js";
import * as data from "./data.js";
import * as engine from "./agentEngine/index.js";
import { processReply, tickCampaign } from "./scheduler.js";
import { getUsage, recordLlmError } from "./usage.js";
import { embeddingsStatus } from "./embeddings.js";
import { newProspect } from "./prospects.js";
import { addFact } from "./dossier.js";
import { parseWorkingHours } from "./simTime.js";

const sandboxOf = (s, id) => {
  const c = s.campaigns.find((x) => x.id === id);
  if (!c || !c.sandbox) throw new Error("Sandbox not found.");
  return c;
};
const prospectOf = (s, c) => s.prospects.find((p) => p.campaignId === c.id);

/** Starts a sandbox: a live, single-target, autonomous campaign for the person described, sending as the chosen rep. */
export function createSandbox(v = {}) {
  const s = getState();
  const t = v.target || {};
  const rep = s.reps.find((r) => r.id === v.repId && r.status === "active") || s.reps.find((r) => r.status === "active");
  if (!rep) throw new Error("Add an active representative first: the SDR needs someone to send as.");
  const channel = ["email", "linkedin", "sms"].includes(v.channel) ? v.channel : "email";
  const created = data.createCampaign(
    {
      name: (v.name && v.name.trim()) || `Sandbox: ${(t.name || "").trim()}`, description: "A test run with a real person as the prospect.", owner: currentUser(),
      objective: v.objective, offer: v.offer, brief: v.brief, mode: "single", sandbox: true, target: { ...t, real: true }, channels: [channel],
      dailyLimit: 100, workingHours: "12:00 AM – 11:59 PM", cadence: { maxTouches: 1, waitHours: 24 },
      approvals: { firstOutreach: false, meetingTime: false, escalate: true, level: "autonomous" }, sources: [],
    },
    { launch: true }
  );
  data.setCampaignReps(created.id, [rep.id]);
  return getSandbox(created.id);
}

export function listSandboxes() {
  const s = getState();
  return s.campaigns
    .filter((c) => c.sandbox)
    .map((c) => {
      const p = prospectOf(s, c);
      return { id: c.id, name: c.name, target: c.target && c.target.name, stage: p && p.stage, meeting: p && p.meeting ? p.meeting.status : null, createdTs: c.createdTs, feedback: c.judgeFeedback || null };
    })
    .sort((a, b) => b.createdTs - a.createdTs);
}

/** Runs every step of the SDR for the sandbox now: research, plan, and send the first message. */
export async function runSandbox(id) {
  const s = getState();
  const c = sandboxOf(s, id);
  await tickCampaign(c);
  await persistState();
  return getSandbox(id);
}

/** The person types a reply; the SDR handles it exactly as it would a real reply. */
export async function sandboxReply(id, text) {
  const s = getState();
  const c = sandboxOf(s, id);
  const p = prospectOf(s, c);
  if (!String(text || "").trim()) throw new Error("Type a reply first.");
  if (!p || !p.touches.length) throw new Error("The SDR has not written to this person yet. Press Run the SDR first.");
  const channel = (p.touches.at(-1) || {}).channel || c.channels[0];
  const outcome = await processReply(s, c, p, { text: String(text).trim().slice(0, 2000), channel, kind: "typed by the judge" });
  await persistState();
  return { outcome, sandbox: getSandbox(id) };
}

export async function setSandboxFeedback(id, { rating, notes = "" } = {}) {
  const c = sandboxOf(getState(), id);
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) throw new Error("Give a rating from 1 to 5.");
  c.judgeFeedback = { rating: r, notes: String(notes).trim().slice(0, 1000), by: currentUser(), ts: Date.now() };
  await persistState();
  return c.judgeFeedback;
}

export async function deleteSandbox(id) {
  const s = getState();
  const c = sandboxOf(s, id);
  s.campaigns = s.campaigns.filter((x) => x.id !== c.id);
  s.prospects = s.prospects.filter((p) => p.campaignId !== c.id);
  s.decisions = s.decisions.filter((d) => d.campaignId !== c.id);
  s.approvals = s.approvals.filter((a) => a.campaignId !== c.id);
  s.events = s.events.filter((e) => e.campaignId !== c.id);
  await persistState();
  return { id };
}

// How the run went, from what actually happened (nothing here is asked of a model).
function scorecard(s, c, p, decisions) {
  const rep = s.reps.find((r) => r.id === (p.meeting && p.meeting.repId)) || s.reps.find((r) => r.id === (c.repIds || [])[0]);
  const m = p.meeting && p.meeting.status === "confirmed" ? p.meeting : null;
  const inbound = p.conversation.filter((x) => x.dir === "in").length;
  const outbound = p.conversation.filter((x) => x.dir === "out").length;
  const groundingFailures = decisions.filter((d) => (d.evidence || []).some((e) => /Grounding check FAILED/.test(e))).length;
  const escalations = s.approvals.filter((a) => a.campaignId === c.id && a.type === "escalation").length;
  const usage = getUsage().byCampaign[c.id] || { decisions: 0, avoided: 0, estCostUsd: 0, tokensIn: 0, tokensOut: 0 };

  let withinHours = null;
  if (m && rep) {
    const w = parseWorkingHours(rep.workingHours);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: config.meetingTimezone, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(m.chosen.start)).map((x) => [x.type, x.value]));
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    withinHours = !w || (minute >= w.start && minute + config.meetingMinutes <= w.end);
  }
  const doubleBooked = m ? s.prospects.some((o) => o.id !== p.id && o.meeting && o.meeting.status === "confirmed" && o.meeting.repId === m.repId && o.meeting.chosen.start < m.chosen.end && m.chosen.start < o.meeting.chosen.end) : false;

  const checks = [
    { label: "The SDR wrote to the person", pass: p.touches.length > 0 },
    { label: "A meeting was booked", pass: !!m },
    { label: "It was booked inside the rep's working hours", pass: m ? withinHours : null },
    { label: "It does not clash with another meeting", pass: m ? !doubleBooked : null },
    { label: "No draft with an unsupported claim was sent", pass: groundingFailures === 0 },
    { label: "It did not need a human to step in", pass: escalations === 0 },
  ];
  return {
    verdict: m ? "Meeting booked" : p.meeting && p.meeting.status === "declined" ? "The person declined" : p.touches.length ? "In progress" : "Not started",
    meeting: m ? { label: m.chosen.label, start: m.chosen.start, withRep: m.repName, title: m.title } : null,
    turns: { fromPerson: inbound, fromSdr: outbound },
    groundingFailures, escalations,
    llm: { decisions: usage.decisions, withoutLlm: usage.avoided, costUsd: usage.estCostUsd, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut },
    checks,
  };
}

export function getSandbox(id) {
  const s = getState();
  const c = sandboxOf(s, id);
  const p = prospectOf(s, c);
  const decisions = s.decisions.filter((d) => d.campaignId === c.id).sort((a, b) => b.ts - a.ts);
  const rep = s.reps.find((r) => r.id === (c.repIds || [])[0]) || null;
  const { ics, ...meeting } = (p && p.meeting) || {};
  return {
    id: c.id, name: c.name, objective: c.objective, offer: c.offer, target: c.target, channel: c.channels[0],
    rep: rep && { id: rep.id, name: rep.name, workingHours: rep.workingHours },
    brief: (c.systemPrompt && c.systemPrompt.versions.find((v) => v.version === c.systemPrompt.active) || {}).text || "",
    prospect: p && {
      id: p.id, name: p.name, title: p.title, company: p.company, stage: p.stage, nextStep: p.nextStep, conversation: p.conversation, dossier: p.dossier,
      research: p.research || null, plan: p.plan, touches: p.touches, meeting: p.meeting ? meeting : null, canDownloadInvite: !!(p.meeting && p.meeting.status === "confirmed"),
    },
    decisions: decisions.slice(0, 40).map((d) => ({ ts: d.ts, agent: d.agent, engine: d.engine, harness: d.harness, headline: d.headline, evidence: d.evidence, retrieved: d.retrieved })),
    approvals: s.approvals.filter((a) => a.campaignId === c.id && a.status === "pending").map((a) => ({ id: a.id, tag: a.tag, summary: a.summary })),
    scorecard: p ? scorecard(s, c, p, decisions) : null,
    feedback: c.judgeFeedback || null,
  };
}

// ---------------------------------------------------------------- the imitated search, on any audience
export async function devSearch({ audience, count = 5 } = {}) {
  const s = getState();
  if (!String(audience || "").trim()) throw new Error("Describe who to search for.");
  const n = Math.min(8, Math.max(1, Math.round(Number(count)) || 5));
  const pseudo = { id: "dev-search", name: "Search playground", objective: "", offer: "", icpText: String(audience).trim().slice(0, 600), personas: [], geography: [], companyCriteria: "", exclusionCriteria: "", channels: [], approvals: {} };
  const found = await engine.sourceProspects({ campaign: pseudo, count: n, avoid: [], leadAgent: s.agents.find((a) => a.id === "lead") });
  return {
    audience: pseudo.icpText,
    provider: "imitated search (AI, fictional people)",
    real: false,
    engine: found.engine,
    candidates: found.candidates || [],
    note: found.candidates ? "These people are made up by an AI acting as a search tool. Nothing was saved." : "No model answered (the key, the quota or the daily cap), so nothing was returned.",
  };
}

// ---------------------------------------------------------------- real-data tests: how often does the ICP agent agree with what you know?
const tests = (s) => (s.devTests ||= []);

export function listDevTests() {
  return tests(getState());
}

export async function addDevTest(v = {}) {
  const s = getState();
  const e = {};
  if (!String(v.name || "").trim()) e.name = "Enter the person's name.";
  if (!String(v.organisation || "").trim()) e.organisation = "Enter their organisation.";
  if (!["Qualified", "Rejected"].includes(v.expected)) e.expected = "Say whether this person should qualify.";
  if (Object.keys(e).length) throw Object.assign(new Error("Please fix the highlighted fields."), { fields: e });
  s.seq += 1;
  const t = {
    id: `t${s.seq}`, name: v.name.trim(), title: String(v.title || "").trim(), organisation: v.organisation.trim(), size: String(v.size || "").trim(),
    notes: String(v.notes || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 20), expected: v.expected, why: String(v.why || "").trim().slice(0, 300),
  };
  tests(s).push(t);
  await persistState();
  return t;
}

export async function removeDevTest(id) {
  const s = getState();
  s.devTests = tests(s).filter((t) => t.id !== id);
  await persistState();
  return { id };
}

/** Runs the chosen campaign's ICP agent (with its real prompt and criteria) over the entered people. */
export async function runDevTests(campaignId) {
  const s = getState();
  const c = s.campaigns.find((x) => x.id === campaignId && !x.sandbox && x.mode !== "single");
  if (!c) throw new Error("Choose a campaign that targets an audience.");
  const icpAgent = s.agents.find((a) => a.id === "icp");
  const results = [];
  for (const t of tests(s)) {
    const p = newProspect(c, { name: t.name, title: t.title, company: t.organisation, size: t.size }, { provider: "entered by a person", real: true });
    for (const note of t.notes) addFact(p, { text: note, source: "entered by a person", kind: "profile" });
    let got = null, score = null, reasoning = "", usedEngine = null, error = null;
    try {
      const r = await engine.scoreICP({ state: s, campaign: c, prospect: p, icpAgent });
      got = r.qualified ? "Qualified" : "Rejected";
      score = r.score;
      reasoning = r.reasoning;
      usedEngine = r.engine;
    } catch (e) {
      error = e.message;
    }
    results.push({ id: t.id, name: t.name, organisation: t.organisation, expected: t.expected, why: t.why, got, score, reasoning, engine: usedEngine, error, agrees: got === t.expected });
  }
  const scored = results.filter((r) => !r.error);
  return { campaign: c.name, total: results.length, correct: scored.filter((r) => r.agrees).length, accuracy: scored.length ? scored.filter((r) => r.agrees).length / scored.length : 0, results };
}

// ---------------------------------------------------------------- what is in force right now
export function getRuntime() {
  const u = getUsage();
  return {
    engines: activeEngine(),
    gemini: { keyConfigured: !!config.gemini.apiKey, models: String(config.gemini.model), ratePerMinute: config.gemini.rpm },
    llm: { lastError: u.lastError, callsToday: u.llmCalls, dailyCap: config.llmDailyCallCap, capReached: u.capReached, tokensIn: u.tokensIn, tokensOut: u.tokensOut, estCostUsd: u.estCostUsd },
    embeddings: embeddingsStatus(),
    clock: { simMsPerHour: config.simMsPerHour, note: `A simulated day lasts ${Math.round((24 * config.simMsPerHour) / 1000)} seconds` },
    meetings: { timezone: config.meetingTimezone, minutes: config.meetingMinutes },
    limitsEnforced: config.enforceLimits,
    simulatedReplyChance: config.simReplyChance,
    schedulerIntervalMs: config.schedulerIntervalMs,
    signInRequired: !!config.auth.accessCode,
  };
}

// ---------------------------------------------------------------- real email: is it working, and what happened to each message
import { pollInbox } from "./scheduler.js";
import { profile, sendEmail } from "./channels/gmail.js";
import { channelBlocker, gmailReady, isRealCampaign, recipientBlocker } from "./realMode.js";

export function getEmailStatus() {
  const s = getState();
  const real = s.campaigns.filter(isRealCampaign);
  const recent = [];
  for (const p of s.prospects) {
    const c = real.find((x) => x.id === p.campaignId);
    if (!c) continue;
    for (const m of p.conversation) {
      if (m.dir !== "out" || !m.delivery) continue;
      recent.push({ prospect: p.name, prospectId: p.id, to: m.channel === "email" ? p.email : p.phone, channel: m.channel, campaign: c.name, status: m.delivery.status, error: m.delivery.error || null, provider: m.delivery.provider || null, ts: m.delivery.ts || 0, preview: String(m.text || "").slice(0, 120) });
    }
  }
  return {
    ready: !channelBlocker("email"), credentials: gmailReady(), realSending: config.realSending, sender: config.gmail.sender || null,
    allowlist: config.realAllowlist, autoSend: config.realAutoSend, pollSeconds: Math.round(config.gmail.pollMs / 1000),
    blocker: channelBlocker("email"),
    inboxes: real.map((c) => ({ campaign: c.name, status: c.status, inbox: c.inbox || null })),
    recent: recent.sort((a, b) => b.ts - a.ts).slice(0, 15),
  };
}

/** Signs in to Gmail with the stored credentials and says which mailbox they belong to. */
export async function testEmailConnection() {
  if (!gmailReady()) throw new Error("Gmail is not set up: one of GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN or GMAIL_SENDER is missing.");
  const p = await profile();
  const sender = config.gmail.sender.toLowerCase();
  return { ok: true, account: p.address, sender: config.gmail.sender, match: p.address.toLowerCase() === sender, note: p.address.toLowerCase() === sender ? "The credentials work and match GMAIL_SENDER." : `The credentials sign in as ${p.address}, but GMAIL_SENDER is ${config.gmail.sender}. Mail will show ${p.address} as the sender: set GMAIL_SENDER to match.` };
}

/** One real email, right now, to an address on the allow-list: the quickest way to see whether sending works. */
export async function sendTestEmail({ to } = {}) {
  const address = String(to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) throw new Error("Enter a real email address.");
  const why = channelBlocker("email") || recipientBlocker("email", { email: address });
  if (why) throw new Error(why);
  const r = await sendEmail({
    to: address, fromName: "Autonomous SDR", subject: "Test email from your SDR",
    body: "Hello,\n\nThis is a test email from your Autonomous SDR. If you can read it, real sending works: Gmail accepted the message and it reached your inbox.\n\nYou can delete it.\n\nBest regards,\nAutonomous SDR",
  });
  return { ok: true, to: address, id: r.id, threadId: r.threadId, note: "Gmail accepted it. Check that inbox (and its spam folder) within a minute." };
}

/** Reads every real campaign's Gmail threads now, instead of waiting for the next check. */
export async function checkInboxNow() {
  const s = getState();
  const out = { checked: 0, replies: 0, autoReplies: 0, bounces: 0, errors: [] };
  if (channelBlocker("email")) throw new Error(channelBlocker("email"));
  for (const c of s.campaigns.filter((x) => isRealCampaign(x) && (x.status === "live" || x.status === "paused"))) {
    const r = await pollInbox(s, c, { force: true });
    for (const k of ["checked", "replies", "autoReplies", "bounces"]) out[k] += r[k] || 0;
    out.errors.push(...(r.errors || []));
  }
  await persistState();
  return out;
}

/** Asks Gemini a trivial question now and reports exactly what came back, so a failing key, model or quota is never a mystery. */
export async function testGemini() {
  if (!config.gemini.apiKey) throw new Error("No GEMINI_API_KEY is set on this server.");
  const { geminiPing } = await import("./agentEngine/geminiEngine.js");
  const started = Date.now();
  let r;
  try {
    r = await geminiPing();
  } catch (e) {
    recordLlmError(e.message, "gemini"); // shown on Settings and Runtime until Gemini works again
    throw e;
  }
  return { ok: r.ok, ms: Date.now() - started, models: String(config.gemini.model), note: "Gemini answered. Decisions and drafts are being made by the model." };
}
