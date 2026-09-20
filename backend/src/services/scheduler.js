// The autonomous loop (PS: "AI agents do this work autonomously, while a human manager stays
// fully in control"). Replaces the frontend mock's tickState() — instead of incrementing funnel
// counters at random, this drives real, per-prospect agent calls that each write a real Decision
// Journal entry, respecting every guardrail: global kill switch, campaign Live/Paused state,
// per-agent enable/disable, per-channel enable/disable, and cross-campaign conflict detection.
import { greetingName } from "./agentEngine/ruleEngine.js";
import { getState, persistState } from "../db/index.js";
import { addEvent, isRunning } from "./logic.js";
import { config } from "../config.js";
import { checkConflict } from "./conflict.js";
import { generateProspect } from "./prospectGenerator.js";
import { newProspect } from "./prospects.js";
import * as engine from "./agentEngine/index.js";
import { classifyReply } from "./replyRouter.js";
import { recordAvoided } from "./usage.js";
import { recordReply, recordTouch, touchLimit } from "./outreach.js";
import { bookMeeting, proposeSlots, slotsText } from "./meetings.js";
import { pickRep } from "./reps.js";
import { outreachAllowed } from "./limits.js";
import { describeIssues } from "./grounding.js";
import { hoursToMs } from "./simTime.js";
import { addFact, addNote, ensureDossier } from "./dossier.js";
import { SDR_STEPS } from "./sdrSteps.js";
import { shortDate } from "../utils/format.js";
import { isRealCampaign, realChannels, channelBlocker } from "./realMode.js";
import { rankContacts, pickContacts } from "./contacts.js";
import { newReplies } from "./channels/gmail.js";
import { gmailReady } from "./realMode.js";

const agentById = (s, id) => s.agents.find((a) => a.id === id);
// An agent runs in a campaign only when it is enabled for the whole platform AND for that campaign, and the kill
// switch is off. (Agent pause: one agent stops in one campaign while the rest of the campaign continues.)
const agentEnabled = (s, id, campaign) =>
  !s.killSwitch.active && !!agentById(s, id)?.enabled && !(campaign && campaign.agentsEnabled && campaign.agentsEnabled[id] === false);
const channelEnabled = (s, key) => s.channels.some((c) => c.key === key && c.enabled);

function pushDecision(s, decision) {
  s.seq += 1;
  s.decisions.unshift({
    id: `d${s.seq}`,
    prospectId: null,
    score: null,
    retrieved: [],
    evidence: [],
    instruction: "",
    conflict: { ok: true, text: "No conflicts found" },
    ts: Date.now(),
    ...decision,
  });
  if (s.decisions.length > 500) s.decisions.length = 500;
}

function pushApproval(s, approval) {
  s.seq += 1;
  s.approvals.unshift({
    id: `a${s.seq}`,
    status: "pending",
    decidedBy: null,
    decidedTs: null,
    reason: "",
    requestedTs: Date.now(),
    ...approval,
  });
}

// How many people are waiting to be researched or scored before the search is asked for more.
const SEARCH_BACKLOG = 4;
const SEARCH_INTERVAL_MS = 45 * 1000;

// Lead Research: finding people. A single-target campaign never searches (it has exactly the person it was made for).
// "simulated-search" asks the imitated people search (Gemini acting as a search tool) for fictional candidates that match
// the campaign's audience, whatever it is; "synthetic" is the free company-style generator.
async function runDiscovery(s, campaign) {
  if (!agentEnabled(s, "lead", campaign)) return;
  if (campaign.mode === "single") return;

  // Real data: people entered by hand in the Dev tab. Nothing is made up and nothing is searched for.
  if (campaign.sourcing === "real") {
    const waiting = s.prospects.filter((p) => p.campaignId === campaign.id && (p.stage === "discovered" || p.stage === "researched") && p.fit == null).length;
    if (waiting >= SEARCH_BACKLOG) return;
    const chosen = pickContacts(s, campaign, 3);
    if (!chosen.length) return;
    const provider = "real contact (entered by a person)";
    const prospects = chosen.map((c) => {
      const p = newProspect(campaign, { name: c.name, title: c.title, company: c.organisation, email: c.email || "", phone: c.phone || "" }, { provider, real: true, note: "A real person added in the Dev tab" });
      p.email = c.email || "";
      p.phone = c.phone || "";
      p.contactId = c.id;
      for (const fact of c.notes) addFact(p, { text: fact, source: "entered by a person", kind: "profile" });
      return p;
    });
    for (const p of prospects) s.prospects.push(p);
    campaign.funnel.discovered += prospects.length;
    pushDecision(s, {
      kind: "enriched", campaignId: campaign.id, agent: "Lead Research Agent", harness: "real contacts", engine: "matching",
      headline: `Picked ${prospects.length} real ${prospects.length === 1 ? "contact" : "contacts"} for ${campaign.name}`,
      summary: `Chose from the real contacts added by hand, best match to the audience first: ${prospects.map((p) => p.name).join(", ")}`,
      evidence: ["Source: real people entered in the Dev tab. Nothing here is simulated.", `Audience: ${campaign.icpText || campaign.objective || "the campaign's target"}`],
      instruction: "Rank the real contacts by how well they match the campaign's audience and hand the best to Research.", finalAction: "Hand each contact to Research",
    });
    return;
  }

  if (campaign.sourcing === "simulated-search") {
    const waiting = s.prospects.filter((p) => p.campaignId === campaign.id && (p.stage === "discovered" || p.stage === "researched") && p.fit == null).length;
    if (waiting >= SEARCH_BACKLOG || Date.now() - (campaign.lastSourcedAt || 0) < SEARCH_INTERVAL_MS) return;
    campaign.lastSourcedAt = Date.now();
    const leadAgent = agentById(s, "lead");
    const avoid = s.prospects.filter((p) => p.campaignId === campaign.id).map((p) => p.name);
    const found = await engine.sourceProspects({ campaign, count: 3, avoid, leadAgent });
    const provider = "imitated search (AI, fictional people)";
    const prospects = found.candidates
      ? found.candidates.map((c) => {
          const p = newProspect(campaign, c, { provider, real: false, note: "Made up by an AI acting as a people-search tool" });
          for (const fact of c.facts) addFact(p, { text: fact, source: provider, kind: "profile" });
          return p;
        })
      : [generateProspect(campaign)]; // no model available: the free generator keeps the campaign moving
    for (const p of prospects) s.prospects.push(p);
    campaign.funnel.discovered += prospects.length;
    pushDecision(s, {
      kind: "enriched",
      campaignId: campaign.id,
      agent: "Lead Research Agent",
      harness: found.harness || "n/a",
      engine: found.candidates ? found.engine : "rule",
      headline: `Found ${prospects.length} ${prospects.length === 1 ? "person" : "people"} for ${campaign.name}`,
      summary: `Sourcing found ${prospects.length} candidate${prospects.length === 1 ? "" : "s"} through ${found.candidates ? "the imitated people search" : "the free generator"}: ${prospects.map((p) => p.name).join(", ")}`,
      evidence: [`Source: ${found.candidates ? provider : "synthetic generator"}. These people are simulated, not real.`, `Audience searched for: ${campaign.icpText || campaign.objective || "the campaign's target"}`],
      instruction: "Return candidates that match the campaign's audience. All people are fictional until a real data source is connected.",
      finalAction: "Hand each candidate to Research",
    });
    return;
  }

  // Free generator (company-style prospects), plus the background volume that mirrors the seeded funnel totals.
  const bump = 1 + Math.floor(Math.random() * 4);
  campaign.funnel.discovered += bump;
  campaign.funnel.researched = Math.min(campaign.funnel.discovered, campaign.funnel.researched + bump);
  if (Math.random() < 0.5) {
    s.prospects.push(generateProspect(campaign));
    if (Math.random() < 0.3) {
      addEvent(s, { campaignId: campaign.id, type: "enrich", text: `Lead Research Agent found a new prospect for **${campaign.name}**`, featured: false });
    }
  }
}

// Research: a brief from what is known about each new prospect (facts, reasons they might care, gaps). It works only from the
// prospect's own data, so it can structure and prioritise what is known but cannot make anything up.
async function runResearch(s, campaign) {
  const waiting = s.prospects.filter((p) => p.campaignId === campaign.id && p.stage === "discovered");
  if (!agentEnabled(s, "research", campaign)) {
    for (const p of waiting) { p.stage = "researched"; p.nextStep = "ICP scoring"; }
    return;
  }
  const researchAgent = agentById(s, "research");
  for (const prospect of waiting.slice(0, config.schedulerBatchSize)) {
    try {
      const result = await engine.researchProspect({ campaign, prospect, researchAgent });
      const d = ensureDossier(prospect);
      for (const f of result.facts) addFact(prospect, { text: f.text, source: "research", kind: f.kind });
      d.hooks = result.hooks;
      d.gaps = result.gaps;
      prospect.research = { summary: result.summary, confidence: result.confidence, engine: result.engine, harness: result.harness, ts: Date.now() };
      prospect.stage = "researched";
      prospect.nextStep = "ICP scoring";
      prospect.lastAction = "Researched, {ago}";
      prospect.lastTs = Date.now();
      addNote(prospect, { agent: "Research Agent", harness: result.harness, engine: result.engine, note: `${result.summary} ${result.hooks.length ? `Reasons to reach out: ${result.hooks.join("; ")}.` : "No specific reason to reach out is known."}${result.gaps.length ? ` Not known: ${result.gaps.join("; ")}.` : ""}` });
      pushDecision(s, {
        kind: "enriched",
        campaignId: campaign.id,
        prospectId: prospect.id,
        agent: "Research Agent",
        harness: result.harness,
        engine: result.engine,
        headline: `Researched — ${prospect.name}, ${prospect.company}`,
        summary: `Research Agent built a brief on **${prospect.name}**, ${prospect.company} (${result.confidence} confidence)`,
        evidence: [result.summary, ...result.hooks.map((h) => `Reason to reach out: ${h}`), ...result.gaps.map((g) => `Not known: ${g}`), ...(result.dropped ? [`${result.dropped} statement${result.dropped === 1 ? "" : "s"} dropped: not supported by the prospect's own data`] : [])],
        retrieved: result.retrieved,
        instruction: "Use only facts present in the input. Never invent.",
        finalAction: "Hand the brief to ICP Fitment",
      });
    } catch (e) {
      recordFailure(s, campaign, prospect, "Research", e);
    }
  }
}

// Approval levels (per campaign, PS "human-approval rules"). The three toggles say which actions
// need a human; the level says when a human can be skipped:
//   manual      every toggled action waits in the Approvals queue (default)
//   assisted    first outreach / meeting auto-approve once the campaign has earned trust: at least
//               `autoAfterApproved` human approvals of that action type AND a fit score >= `autoMinScore`
//   autonomous  first outreach and meetings never wait for a human
// Escalations (an objection that needs a compliance-accurate answer) always go to a human at every level.
function autoApproval(s, campaign, prospect, type) {
  const ap = campaign.approvals || {};
  if (isRealCampaign(campaign) && !config.realAutoSend) return { ok: false }; // real people: a human always approves
  if (ap.level === "autonomous") return { ok: true, why: "Autonomous approval level" };
  if (ap.level === "assisted") {
    const minScore = ap.autoMinScore ?? 85;
    const needed = ap.autoAfterApproved ?? 3;
    const human = s.approvals.filter((a) => a.campaignId === campaign.id && a.type === type && a.status === "approved").length;
    if ((prospect.fit ?? 0) >= minScore && human >= needed) {
      return { ok: true, why: `Assisted level: fit ${prospect.fit} >= ${minScore} and ${human} earlier human approvals of this action` };
    }
  }
  return { ok: false };
}

async function runIcpFitment(s, campaign) {
  if (!agentEnabled(s, "icp", campaign)) return;
  const icpAgent = agentById(s, "icp");
  const batch = s.prospects.filter((p) => p.campaignId === campaign.id && p.stage === "researched" && p.fit == null).slice(0, config.schedulerBatchSize);

  for (const prospect of batch) {
    try {
      if (campaign.mode === "single") {
        // The ICP is this one named person: nothing to score.
        prospect.fit = 100;
        prospect.reasons = [];
        prospect.qual = { status: "Qualified", reasoning: "Named target: this campaign is aimed at exactly this person, so there is no fit to score.", agent: "ICP Fitment Agent", harness: "policy", ts: Date.now() };
        prospect.stage = "qualified";
        prospect.lastAction = "Qualified (named target), {ago}";
        prospect.nextStep = "Personalise & send";
        prospect.lastTs = Date.now();
        campaign.funnel.qualified += 1;
        addNote(prospect, { agent: "ICP Fitment Agent", harness: "policy", engine: "policy", note: "Named target: qualified without scoring." });
        continue;
      }
      const result = await engine.scoreICP({ state: s, campaign, prospect, icpAgent });
      prospect.fit = result.score;
      prospect.reasons = result.reasons;
      prospect.evidence = result.evidence;
      prospect.qual = { status: result.qualified ? "Qualified" : "Rejected", reasoning: result.reasoning, agent: "ICP Fitment Agent", harness: result.harness, ts: Date.now() };

      if (result.qualified) {
        prospect.stage = "qualified";
        prospect.lastAction = "Qualified, {ago}";
        prospect.nextStep = "Personalise & send";
        campaign.funnel.qualified += 1;
      } else {
        prospect.stage = "rejected";
        prospect.lastAction = "Rejected by ICP Fitment Agent, {ago}";
        prospect.nextStep = "—";
      }
      prospect.lastTs = Date.now();
      addNote(prospect, { agent: "ICP Fitment Agent", harness: result.harness, engine: result.engine, note: `${result.qualified ? "Qualified" : "Rejected"} at ${result.score}/100. ${result.reasoning}` });

      pushDecision(s, {
        kind: result.qualified ? "qualified" : "rejected",
        campaignId: campaign.id,
        prospectId: prospect.id,
        agent: "ICP Fitment Agent",
        harness: result.harness,
        engine: result.engine,
        headline: `${result.qualified ? "Qualified" : "Rejected"} — ${prospect.name}, ${prospect.company}`,
        summary: `ICP Fitment Agent ${result.qualified ? "qualified" : "rejected"} **${prospect.name}**, ${prospect.company}${result.qualified ? ` (score ${result.score}/100)` : ""}`,
        evidence: result.evidence,
        score: result.score,
        retrieved: result.retrieved,
        instruction: result.instruction,
        finalAction: result.qualified ? "Move to Qualified → hand off to Personalisation Agent" : "Mark as not qualified and stop outreach",
      });
      if (!result.qualified) {
        addEvent(s, { campaignId: campaign.id, type: "reject", text: `ICP Fitment Agent rejected **${prospect.company}** — ${result.reasoning}`, featured: true });
      }
    } catch (e) {
      recordFailure(s, campaign, prospect, "ICP Fitment", e);
    }
  }
}

// A stage that throws is contained to that campaign and stage, counted against the campaign (its dashboard shows
// failed workflows) and written to the Decision Journal, at most once a minute per identical failure so a stuck
// stage cannot flood it. The loop retries on the next tick; other stages and other campaigns are unaffected.
function recordFailure(s, campaign, prospect, stage, error) {
  console.warn(`[scheduler] ${stage} failed in ${campaign.name}${prospect ? ` for ${prospect.id}` : ""}: ${error.message}`);
  campaign.failures = campaign.failures || { total: 0 };
  campaign.failures.total += 1;
  const key = `${stage}:${error.message}`.slice(0, 160);
  if (campaign.lastFailure && campaign.lastFailure.key === key && Date.now() - campaign.lastFailure.ts < 60 * 1000) return;
  campaign.lastFailure = { key, ts: Date.now() };
  pushDecision(s, {
    kind: "blocked",
    campaignId: campaign.id,
    prospectId: prospect ? prospect.id : null,
    agent: `${stage} stage`,
    harness: "n/a",
    engine: "error",
    headline: `Workflow failed — ${stage}${prospect ? `, ${prospect.name}` : ""}`,
    summary: `The ${stage} step failed in **${campaign.name}**${prospect ? ` for **${prospect.name}**` : ""}: ${error.message}`,
    evidence: [error.message],
    instruction: "A failure is contained to this campaign's stage. Nothing was sent, and the loop retries on the next tick.",
    finalAction: "Retry on the next tick",
  });
}

// Outcome of a reply, for the campaign's response split: positive (wants a meeting), negative (opt-out or hostile),
// neutral (a question or an objection). Out-of-office auto-replies are not a response and are not counted.
function countOutcome(campaign, outcome) {
  campaign.outcomes = campaign.outcomes || { positive: 0, negative: 0, neutral: 0 };
  campaign.outcomes[outcome] += 1;
}

const groundingLine = (g) => (g.ok ? "Grounding check: every figure and claim is supported by the knowledge or the prospect's data" : `Grounding check FAILED: ${describeIssues(g.issues).join("; ")}`);

const HOLD_LOG_INTERVAL_MS = 60 * 1000;

// An outreach limit (working hours, daily limit, frequency cap) is holding this prospect back. One Decision Journal
// entry per reason, not one per tick, and no agent is called while it holds.
function holdOutreach(s, campaign, prospect, reason) {
  const key = reason.replace(/\s*\(.*$/, "").trim();
  prospect.nextStep = `Held: ${key}`;
  // One journal entry per campaign and reason for a while, not one per prospect, so a closed window does not flood it.
  const last = campaign.lastHold;
  if (last && last.key === key && Date.now() - last.ts < HOLD_LOG_INTERVAL_MS) return;
  campaign.lastHold = { key, ts: Date.now() };
  pushDecision(s, {
    kind: "blocked",
    campaignId: campaign.id,
    prospectId: prospect.id,
    agent: "Outreach Limits",
    harness: "policy",
    engine: "policy",
    headline: `Outreach held — ${campaign.shortName || campaign.name}: ${key.toLowerCase()}`,
    summary: `Outreach in **${campaign.name}** is held: ${reason}. Prospects wait and go out when the limit clears.`,
    evidence: [reason, `First affected: ${prospect.name}, ${prospect.company}`],
    instruction: "Working hours, the daily limit and the contact-frequency cap are hard limits that no agent can override.",
    finalAction: "Wait until the limit clears. No agent call was made.",
  });
}

// Outreach Strategy Agent: plans which channels, in what order and how long to wait. Runs once per qualified prospect,
// before any message is drafted, and only over the channels that are enabled right now.
async function runStrategy(s, campaign) {
  if (!agentEnabled(s, "strategy", campaign)) return;
  let allowedChannels = campaign.channels.filter((k) => channelEnabled(s, k));
  // Voice is for real campaigns only, and a real campaign only uses channels that can really be sent right now.
  allowedChannels = isRealCampaign(campaign) ? realChannels(allowedChannels) : allowedChannels.filter((k) => k !== "voice");
  if (!allowedChannels.length) return;
  const strategyAgent = agentById(s, "strategy");
  const batch = s.prospects
    .filter((p) => p.campaignId === campaign.id && p.stage === "qualified" && !p.plan && p.nextStep !== "See Decision Journal")
    .slice(0, config.schedulerBatchSize);

  for (const prospect of batch) {
    try {
      if (!checkConflict(s, prospect).ok) continue; // the Personalisation step records the block
      const result = await engine.planOutreach({ campaign, prospect, strategyAgent, allowedChannels });
      prospect.plan = { sequence: result.sequence, waitHours: result.waitHours, reasoning: result.reasoning, engine: result.engine, harness: result.harness, ts: Date.now() };
      addNote(prospect, { agent: "Outreach Strategy Agent", harness: result.harness, engine: result.engine, note: `Plan ${result.sequence.join(" → ")}, ${result.waitHours}h between touches. ${result.reasoning}` });
      pushDecision(s, {
        kind: "strategy",
        campaignId: campaign.id,
        prospectId: prospect.id,
        agent: "Outreach Strategy Agent",
        harness: result.harness,
        engine: result.engine,
        headline: `Plan — ${prospect.name}, ${prospect.company}: ${result.sequence.join(" → ")}`,
        summary: `Outreach Strategy Agent planned **${prospect.name}**, ${prospect.company}: ${result.sequence.join(" → ")}, ${result.waitHours}h between touches`,
        evidence: [result.reasoning, `Enabled channels for this campaign: ${allowedChannels.join(", ")}`],
        instruction: result.instruction,
        finalAction: `Personalise the first ${result.sequence[0]} touch`,
      });
    } catch (e) {
      recordFailure(s, campaign, prospect, "Outreach Strategy", e);
    }
  }
}

async function runPersonalisation(s, campaign) {
  if (!agentEnabled(s, "personalisation", campaign)) return;
  const activeChannels = campaign.channels.filter((k) => channelEnabled(s, k));
  if (!activeChannels.length) return;
  const personalisationAgent = agentById(s, "personalisation");
  const batch = s.prospects
    .filter((p) => p.campaignId === campaign.id && p.stage === "qualified" && p.nextStep !== "Awaiting approval" && p.nextStep !== "See Decision Journal" && (p.plan || !agentEnabled(s, "strategy", campaign)))
    .slice(0, config.schedulerBatchSize);

  for (const prospect of batch) {
    try {
      const conflict = checkConflict(s, prospect);
      if (!conflict.ok) {
        pushDecision(s, {
          kind: "blocked",
          campaignId: campaign.id,
          prospectId: prospect.id,
          agent: "Conflict Resolution Agent",
          harness: "harness v1.4",
          headline: `Outreach blocked — ${prospect.company}`,
          summary: `Outreach blocked — **${prospect.company}** — ${conflict.text}`,
          evidence: [`Contact: ${prospect.name}, ${prospect.title} — ${prospect.company}`, "Rule: one campaign per prospect within 14 days"],
          conflict: { ok: false, text: conflict.text },
          instruction: "Never contact a prospect already engaged by another campaign within the last 14 days.",
          finalAction: "Skip prospect and notify the campaign owner",
        });
        addEvent(s, { campaignId: campaign.id, type: "conflict", text: `Conflict Resolution blocked outreach to **${prospect.name}** — ${conflict.text}`, featured: true });
        prospect.lastAction = "Outreach blocked, {ago}";
        prospect.nextStep = "See Decision Journal";
        prospect.lastTs = Date.now();
        continue;
      }

      // The Strategy agent chose the channel. If it has since been paused, plan again rather than send on it.
      const planned = prospect.plan && prospect.plan.sequence[0];
      if (planned && !channelEnabled(s, planned)) {
        prospect.plan = null;
        continue;
      }
      // If this touch would go out without a human, the hard limits must allow it now (no LLM call is spent if not).
      const goesOutUnattended = !campaign.approvals.firstOutreach || autoApproval(s, campaign, prospect, "first").ok;
      if (goesOutUnattended) {
        const gate = outreachAllowed(s, campaign, prospect, Date.now(), planned || campaign.channels[0]);
        if (!gate.ok) {
          holdOutreach(s, campaign, prospect, gate.reason);
          continue;
        }
      }

      const result = await engine.draftOutreach({ campaign, prospect, personalisationAgent, channel: planned || undefined });
      addNote(prospect, { agent: "Personalisation Agent", harness: result.harness, engine: result.engine, note: `Drafted the ${result.channel} opening. ${result.reasoning}` });
      pushDecision(s, {
        kind: "strategy",
        campaignId: campaign.id,
        prospectId: prospect.id,
        agent: "Personalisation & Outreach Strategy Agent",
        harness: result.harness,
        engine: result.engine,
        headline: `Channel chosen — ${prospect.name}, ${prospect.company}`,
        summary: `Personalisation Agent chose ${result.channel} for **${prospect.name}**, ${prospect.company}`,
        evidence: [result.reasoning, groundingLine(result.grounding)],
        retrieved: result.retrieved,
        instruction: result.instruction,
        finalAction: `Draft ${result.channel} message`,
      });

      const auto = campaign.approvals.firstOutreach ? autoApproval(s, campaign, prospect, "first") : { ok: true, why: "Approval not required for this campaign" };
      // A draft that fails the grounding check is never auto-sent, whatever the approval level says.
      if (!auto.ok || !result.grounding.ok) {
        pushApproval(s, {
          type: "first",
          touchKind: "first",
          channel: result.channel,
          prospectId: prospect.id,
          campaignId: campaign.id,
          name: prospect.name,
          company: prospect.company,
          tag: result.grounding.ok ? "Send first outreach email" : "Review draft: unsupported claim",
          tagTone: result.grounding.ok ? "neutral" : "danger",
          warnings: describeIssues(result.grounding.issues),
          summary: `Send first outreach email — **${prospect.name}**, ${prospect.company}`,
          recommendation: { title: `Send the opening ${result.channel} — ${prospect.name} scored ${prospect.fit}/100.`, body: result.reasoning },
          draft: { subject: result.subject, body: result.body },
          nextActionText: `Send the opening ${result.channel} message.`,
          source: `Recommended by Personalisation Agent · ${result.harness}`,
        });
        prospect.lastAction = "Draft ready, {ago}";
        prospect.nextStep = "Awaiting approval";
      } else {
        recordTouch(s, campaign, prospect, { channel: result.channel, kind: "first", subject: result.subject, body: result.body });
        if (campaign.approvals.firstOutreach) {
          pushDecision(s, {
            kind: "strategy",
            campaignId: campaign.id,
            prospectId: prospect.id,
            agent: "Approval Policy",
            harness: result.harness,
            engine: "auto-approval",
            headline: `Auto-approved and sent — ${prospect.name}, ${prospect.company}`,
            summary: `First ${result.channel} to **${prospect.name}**, ${prospect.company} was auto-approved (${auto.why})`,
            evidence: [auto.why, `Campaign approval level: ${campaign.approvals.level || "manual"}`],
            instruction: "Escalations always need a human; first outreach may skip the queue only at the Assisted or Autonomous approval level.",
            finalAction: `Send the ${result.channel} message without waiting in the Approvals queue`,
          });
        }
      }
      prospect.lastTs = Date.now();
    } catch (e) {
      recordFailure(s, campaign, prospect, "Personalisation", e);
    }
  }
}

// Stand-in for real inbound mail until a mailbox integration exists: a mix of clean-cut replies
// (opt-out, hostile, out-of-office) and ones that need judgment (objection, question, interest).
const REPLIES = [
  { weight: 0.07, kind: "opt-out request", texts: ["Please remove me from your list.", "Not interested, unsubscribe me from these emails.", "Take me off this mailing list, thanks."] },
  { weight: 0.04, kind: "out-of-office auto-reply", texts: ["I am out of the office until next Monday with limited access to email.", "Automatic reply: I am on annual leave and will respond when I return."] },
  { weight: 0.03, kind: "hostile reply", texts: ["Stop spamming me. This is unsolicited and I will report it.", "How did you get my details? Never contact me again."] },
  { weight: 0.24, kind: "security / compliance objection", texts: ["Before we go further, can you share your SOC 2 report and where data is stored?"] },
  { weight: 0.31, kind: "interested — wants a call", texts: ["Interesting, could we do a quick call this week?"] },
  { weight: 0.31, kind: "asked about pricing", texts: ["Thanks for reaching out, tell me more about pricing."] },
];

function simulateReply() {
  let r = Math.random();
  const pick = REPLIES.find((x) => (r -= x.weight) < 0) || REPLIES[REPLIES.length - 1];
  return { text: pick.texts[Math.floor(Math.random() * pick.texts.length)], kind: pick.kind };
}

// A reply the embedding router settled by itself: opt-outs and hostile replies suppress the
// contact everywhere (the global do-not-contact list every campaign checks); out-of-office just waits.
function applyRoutedReply(s, campaign, prospect, routed) {
  const optOut = routed.category === "unsubscribe" || routed.category === "hostile";
  recordAvoided("replyRouting", campaign.id);
  if (optOut) countOutcome(campaign, "negative");
  prospect.history.push({ kind: "email", text: optOut ? `Reply received — opt-out (${routed.category})` : "Out-of-office auto-reply received", when: "Today" });

  if (optOut) {
    s.seq += 1;
    s.suppression.unshift({ id: `x${s.seq}`, contact: prospect.email, reason: routed.category === "hostile" ? "Hostile reply — auto-suppressed" : "Unsubscribed by reply — auto-suppressed", added: shortDate(Date.now()) });
    prospect.stage = "rejected";
    prospect.lastAction = "Opted out, {ago}";
    prospect.nextStep = "Suppressed — do not contact";
    addEvent(s, { campaignId: campaign.id, type: "reject", text: `**${prospect.name}** (${prospect.company}) opted out — added to the global suppression list, no LLM call used`, featured: true });
  } else {
    prospect.lastAction = "Out-of-office reply, {ago}";
    prospect.nextStep = "Follow up after they return";
  }

  pushDecision(s, {
    kind: optOut ? "rejected" : "strategy",
    campaignId: campaign.id,
    prospectId: prospect.id,
    agent: "Reply Router",
    harness: "embedding match",
    engine: "embedding-router",
    headline: `${optOut ? "Opt-out" : "Out-of-office"} — ${prospect.name}, ${prospect.company}`,
    summary: `Reply from **${prospect.name}**, ${prospect.company} routed as ${routed.category} without an LLM call`,
    evidence: [
      `Reply: "${prospect.conversation[prospect.conversation.length - 1].text}"`,
      `Closest canonical reply category: ${routed.category} (similarity ${routed.score.toFixed(2)}, ${routed.margin.toFixed(2)} clear of the nearest judgment category)`,
    ],
    retrieved: ["Canonical example replies (knowledge base)"],
    instruction: "Clear-cut opt-outs, hostile replies and out-of-office auto-replies are routed by embedding similarity; only ambiguous replies reach the Conversation Agent.",
    finalAction: optOut ? "Add the contact to the global suppression list and stop all outreach" : "Pause follow-ups until the contact is back",
  });
}

// Does this reply go out without waiting for a human? Never if it failed the grounding check. A meeting proposal follows the
// campaign's meeting-approval rule; a plain answer goes out on its own only in an Autonomous campaign. Escalations never do.
function sendsItself(s, campaign, prospect, kind, groundingOk) {
  if (!groundingOk) return false;
  if (isRealCampaign(campaign) && !config.realAutoSend) return false;
  if (kind === "meeting") return !(campaign.approvals.meetingTime && !autoApproval(s, campaign, prospect, "meeting").ok);
  return campaign.approvals.level === "autonomous";
}

function escalate(s, campaign, prospect, { channel, title, body, draft, reasoning, harness, warnings = [] }) {
  pushApproval(s, {
    type: "escalation",
    touchKind: "reply",
    channel,
    prospectId: prospect.id,
    campaignId: campaign.id,
    name: prospect.name,
    company: prospect.company,
    tag: title,
    warnings,
    tagTone: "danger",
    summary: `Escalation — **${prospect.name}**: ${title.toLowerCase()}`,
    recommendation: { title: body, body: reasoning },
    draft: { subject: `Re: ${prospect.company}`, body: draft },
    nextActionText: "Reply personally.",
    source: `Escalated by Conversation Agent · ${harness}`,
  });
  prospect.lastAction = `${title}, {ago}`;
  prospect.nextStep = "Human review";
  addEvent(s, { campaignId: campaign.id, type: "escalate", text: `Conversation Agent escalated **${prospect.name}** — ${title.toLowerCase()}`, featured: false });
}

// A meeting time has been proposed and the prospect has answered it: book it, decline gracefully, offer other times, or
// hand a request the SDR cannot meet to a human.
async function answerProposal(s, campaign, prospect, { text, channel, conversationAgent }) {
  const m = prospect.meeting;
  const first = greetingName(prospect.name);
  const pick = await engine.resolveMeetingReply({ campaign, prospect, slots: m.slots, replyText: text, conversationAgent });
  countOutcome(campaign, pick.declined ? "negative" : pick.choice >= 0 ? "positive" : "neutral");
  addNote(prospect, { agent: "Conversation Agent", harness: pick.harness, engine: pick.engine, note: `Answer to the proposed times: ${pick.choice >= 0 ? `accepted ${m.slots[pick.choice].label}` : pick.declined ? "declined" : pick.alternative ? `asked for "${pick.alternative}"` : "unclear"}. ${pick.reasoning}` });

  if (pick.choice >= 0) {
    const slot = m.slots[pick.choice];
    const rep = s.reps.find((r) => r.id === m.repId) || null;
    bookMeeting(campaign, prospect, slot, rep);
    prospect.stage = "meeting";
    prospect.lastAction = "Meeting booked, {ago}";
    prospect.nextStep = "Prep for call";
    campaign.funnel.meeting += 1;
    recordReply(s, campaign, prospect, {
      channel,
      body: `Wonderful, ${first}. You are booked for ${slot.label}${rep ? ` with ${rep.name}` : ""}. A calendar invite is attached with the details. Looking forward to speaking.`,
    });
    prospect.nextStep = "Prep for call";
    pushDecision(s, {
      kind: "meeting",
      campaignId: campaign.id,
      prospectId: prospect.id,
      agent: "Conversation & Follow-up Agent",
      harness: pick.harness,
      engine: pick.engine,
      headline: `Meeting booked — ${prospect.name}, ${prospect.company}: ${slot.label}`,
      summary: `Conversation Agent booked **${prospect.name}**, ${prospect.company} for ${slot.label}${rep ? ` with ${rep.name}` : ""}`,
      evidence: [`The prospect's reply: "${text.slice(0, 160)}"`, pick.reasoning, `Offered ${m.slots.length} times inside ${rep ? `${rep.name}'s` : "the campaign's"} working hours; ${slot.label} was free on the calendar`],
      instruction: "Book a time only when the prospect clearly accepts one of the times that were offered.",
      finalAction: "Record the meeting, send the confirmation and the calendar invite",
    });
    addEvent(s, { campaignId: campaign.id, type: "meeting", text: `Conversation Agent booked a meeting with **${prospect.name}** (${prospect.company}) for ${slot.label}`, featured: true });
    return { handled: "meeting-booked", slot };
  }

  if (pick.declined) {
    m.status = "declined";
    recordReply(s, campaign, prospect, { channel, body: `Understood, ${first}, and thank you for letting me know. I will not follow up on this. If it becomes useful later, you know where to find us.` });
    prospect.nextStep = "Closed: declined the meeting";
    return { handled: "declined" };
  }

  const wantsOther = Boolean(pick.alternative);
  m.clarifications = (m.clarifications || 0) + 1;
  if (wantsOther && m.rounds < 2) {
    const rep = s.reps.find((r) => r.id === m.repId) || null;
    const slots = proposeSlots(s, { rep, campaign, exclude: m.slots.map((x) => x.start) });
    if (slots.length) {
      prospect.meeting = { ...m, slots, rounds: m.rounds + 1 };
      recordReply(s, campaign, prospect, { channel, body: `Thanks, ${first}. I cannot offer exactly that, but these times are free:\n${slotsText(slots)}\nWould any of them work?` });
      return { handled: "meeting-reproposed" };
    }
  }
  if (!wantsOther && m.clarifications < 3) {
    recordReply(s, campaign, prospect, { channel, body: `Sorry, ${first}, I was not sure which time you meant. Which of these works?\n${slotsText(m.slots)}` });
    return { handled: "meeting-clarified" };
  }
  escalate(s, campaign, prospect, {
    channel, title: "Needs a different meeting time",
    body: wantsOther ? `${prospect.name} asked for "${pick.alternative}", which the SDR cannot offer.` : `${prospect.name}'s answers to the proposed times were unclear.`,
    draft: `Hi ${first}, thanks for your reply. ${wantsOther ? `A colleague will confirm a time that suits you directly.` : `A colleague will reach out to agree a time with you.`}`,
    reasoning: pick.reasoning, harness: pick.harness,
  });
  return { handled: "escalated" };
}

// Everything that happens when a prospect replies, whoever wrote the reply: the simulator, or a real person in the Dev sandbox.
//   clear opt-outs and auto-replies -> the router, no LLM
//   an answer to proposed meeting times -> pick, book, offer other times, or escalate
//   anything else -> the Conversation agent: meet (propose times), escalate, or answer
export async function processReply(s, campaign, prospect, { text, channel, kind = "reply" }) {
  const conversationAgent = agentById(s, "conversation");
  prospect.conversation.push({ dir: "in", text, when: "Today", channel });
  prospect.nextTouchTs = null; // a reply ends the follow-up sequence

  const routed = await classifyReply(text);
  if (routed.deterministic) {
    applyRoutedReply(s, campaign, prospect, routed);
    prospect.lastTs = Date.now();
    return { handled: "routed", category: routed.category };
  }

  prospect.history.push({ kind: channel === "email" ? "email" : "chat", text: `Reply received on ${channel} — ${kind}`, when: "Today" });
  if (prospect.stage === "contacted") {
    prospect.stage = "engaged";
    campaign.funnel.engaged += 1;
  }
  campaign.outreach.replies += 1;

  try {
    if (prospect.meeting && prospect.meeting.status === "proposed") {
      const r = await answerProposal(s, campaign, prospect, { text, channel, conversationAgent });
      prospect.lastTs = Date.now();
      return r;
    }
    if (prospect.meeting && prospect.meeting.status === "confirmed") {
      addNote(prospect, { agent: "Conversation Agent", note: `Reply after the meeting was booked: "${text.slice(0, 120)}". A human should read it.` });
      prospect.lastTs = Date.now();
      return { handled: "after-booking" };
    }

    const result = await engine.handleConversation({ campaign, prospect, conversationAgent });
    countOutcome(campaign, result.action === "meeting" ? "positive" : "neutral");
    addNote(prospect, { agent: "Conversation Agent", harness: result.harness, engine: result.engine, note: `Reply on ${channel}: ${result.action}. ${result.reasoning}` });
    const warnings = describeIssues(result.grounding.issues);

    if (result.action === "escalate") {
      escalate(s, campaign, prospect, {
        channel, title: "Escalation: objection needs a human", body: "Respond personally — this needs a compliance-accurate answer.",
        draft: result.draft || "Draft this reply personally using the objection-handling playbook.", reasoning: result.reasoning, harness: result.harness, warnings,
      });
      return { handled: "escalated" };
    }

    if (result.action === "meeting") {
      const rep = pickRep(s, campaign, channel, { preferId: prospect.repId, strict: false });
      const slots = proposeSlots(s, { rep, campaign });
      if (!slots.length) {
        escalate(s, campaign, prospect, { channel, title: "No free meeting time", body: "The prospect wants to meet but no free time was found.", draft: result.draft, reasoning: result.reasoning, harness: result.harness, warnings });
        return { handled: "escalated" };
      }
      const body = `${(result.draft || `Thanks, ${greetingName(prospect.name)}. I would be glad to set up a call.`).trim()}\n\nWould any of these work?\n${slotsText(slots)}`;
      const meeting = { status: "proposed", slots, rounds: 1, repId: rep ? rep.id : null, channel, proposedTs: Date.now(), clarifications: 0 };
      if (sendsItself(s, campaign, prospect, "meeting", result.grounding.ok)) {
        prospect.meeting = meeting;
        recordReply(s, campaign, prospect, { channel, body });
        pushDecision(s, {
          kind: "strategy", campaignId: campaign.id, prospectId: prospect.id, agent: "Conversation & Follow-up Agent", harness: result.harness, engine: result.engine,
          headline: `Meeting times offered — ${prospect.name}, ${prospect.company}`,
          summary: `Conversation Agent offered **${prospect.name}**, ${prospect.company} ${slots.length} times: ${slots.map((x) => x.label).join("; ")}`,
          evidence: [result.reasoning, `Times are free on ${rep ? `${rep.name}'s` : "the campaign's"} calendar, inside working hours, on different days`],
          retrieved: result.retrieved, instruction: result.instruction, finalAction: "Send the proposal and wait for the prospect to choose",
        });
        return { handled: "meeting-proposed", slots };
      }
      prospect.meeting = { ...meeting, status: "pending-approval" };
      pushApproval(s, {
        type: "meeting", touchKind: "reply", meetingProposal: true, channel, prospectId: prospect.id, campaignId: campaign.id, name: prospect.name, company: prospect.company,
        tag: "Propose meeting times", warnings, tagTone: "neutral", summary: `Propose meeting times — **${prospect.name}**, ${prospect.company}`,
        recommendation: { title: "Send these meeting times.", body: result.reasoning }, draft: { subject: `Re: ${prospect.company}`, body },
        nextActionText: "Send the proposal with these times.", source: `Recommended by Conversation Agent · ${result.harness}`,
      });
      prospect.lastAction = "Replied — wants to meet, {ago}";
      prospect.nextStep = "Awaiting approval";
      return { handled: "meeting-awaiting-approval" };
    }

    // A question or interest that knowledge lets us answer.
    const answer = result.draft || "Thanks for the reply — following up with the details requested.";
    if (sendsItself(s, campaign, prospect, "answer", result.grounding.ok)) {
      recordReply(s, campaign, prospect, { channel, body: answer });
      pushDecision(s, {
        kind: "strategy", campaignId: campaign.id, prospectId: prospect.id, agent: "Conversation & Follow-up Agent", harness: result.harness, engine: result.engine,
        headline: `Answered — ${prospect.name}, ${prospect.company}`, summary: `Conversation Agent answered **${prospect.name}**, ${prospect.company}`,
        evidence: [result.reasoning, groundingLine(result.grounding)], retrieved: result.retrieved, instruction: result.instruction, finalAction: "Send the answer",
      });
      return { handled: "answered" };
    }
    pushApproval(s, {
      type: "followup", touchKind: "reply", channel, prospectId: prospect.id, campaignId: campaign.id, name: prospect.name, company: prospect.company,
      tag: "Send follow-up email", warnings, tagTone: "neutral", summary: `Send follow-up email — **${prospect.name}**, ${prospect.company}`,
      recommendation: { title: "Send a contextual follow-up.", body: result.reasoning }, draft: { subject: `Re: ${prospect.company}`, body: answer },
      nextActionText: "Send a follow-up addressing what the prospect asked.", source: `Recommended by Conversation Agent · ${result.harness}`,
    });
    prospect.nextStep = "Awaiting approval";
    return { handled: "answer-awaiting-approval" };
  } catch (e) {
    recordFailure(s, campaign, prospect, "Conversation", e);
    return { handled: "failed", error: e.message };
  } finally {
    prospect.lastTs = Date.now();
  }
}

// The simulated replies: each tick a contacted prospect who has not replied has a small chance of writing back.
async function runConversation(s, campaign) {
  if (!agentEnabled(s, "conversation", campaign)) return;
  await pollInbox(s, campaign);
  const contacted = s.prospects.filter(
    (p) => p.campaignId === campaign.id && p.stage === "contacted" && p.conversation.every((c) => c.dir === "out") && !p.sandboxHuman && !isRealCampaign(campaign)
  );
  let handled = 0;
  for (const prospect of contacted) {
    if (handled >= config.schedulerBatchSize) break; // caps the agent calls per tick, not who may reply
    if (Math.random() >= config.simReplyChance) continue; // most prospects stay silent on any given tick
    handled += 1;
    const channel = (prospect.touches.at(-1) || {}).channel || "email";
    const { text, kind } = simulateReply();
    await processReply(s, campaign, prospect, { text, channel, kind });
  }
}

// Real email replies: for real campaigns, look in each contacted person's Gmail thread for new messages from them and handle each
// one exactly as a typed reply. Runs at most every GMAIL_POLL_MS.
const lastInbox = new Map();

/**
 * Reads the Gmail thread of every real person we have written to. `force` ignores the polling interval (the "Check inbox now"
 * button). What it found is kept on the campaign (`inbox`) so a person can see that the inbox is really being read.
 */
export async function pollInbox(s, campaign, { force = false } = {}) {
  if (!isRealCampaign(campaign) || !gmailReady() || channelBlocker("email")) return { checked: 0, replies: 0, errors: [] };
  if (!force && Date.now() - (lastInbox.get(campaign.id) || 0) < config.gmail.pollMs) return { checked: 0, replies: 0, errors: [] };
  lastInbox.set(campaign.id, Date.now());
  const status = { checked: 0, replies: 0, autoReplies: 0, bounces: 0, errors: [] };
  for (const prospect of s.prospects.filter((p) => p.campaignId === campaign.id && p.emailThread && p.stage !== "rejected" && !p.sending)) {
    status.checked += 1;
    let messages = [];
    try {
      messages = await newReplies({ threadId: prospect.emailThread, seen: prospect.seenMessageIds || [] });
    } catch (e) {
      status.errors.push(`${prospect.name}: ${e.message}`);
      recordFailure(s, campaign, prospect, "inbox", e);
      continue;
    }
    for (const r of messages) {
      prospect.seenMessageIds = [...(prospect.seenMessageIds || []), r.id];
      if (r.kind === "bounce") {
        // The address does not work. Nothing more is sent to it, and the failure is plain to see.
        status.bounces += 1;
        prospect.stage = "rejected";
        prospect.nextTouchTs = null;
        prospect.nextStep = "Email bounced: the address does not work";
        for (const t of prospect.touches) if (t.delivery && t.delivery.status === "sent") t.delivery = { ...t.delivery, status: "failed", error: "Bounced: the address does not work" };
        addEvent(s, { campaignId: campaign.id, type: "escalate", text: `An email to **${prospect.name}** **bounced**: the address ${prospect.email} does not work`, featured: true });
      } else if (r.kind === "auto") {
        // An out-of-office or other automatic answer is not the person replying: it is noted and never answered.
        status.autoReplies += 1;
        prospect.history.push({ kind: "email", text: "Automatic reply received (out of office)", when: "Today" });
        prospect.nextStep = "Out of office: follow up later";
        addNote(prospect, { agent: "Reply Router", harness: "headers", engine: "rules", note: `An automatic reply arrived ("${r.text.slice(0, 100)}"). It was not answered.` });
      } else {
        status.replies += 1;
        prospect.lastMessageId = r.messageId || prospect.lastMessageId;
        await processReply(s, campaign, prospect, { text: r.text.slice(0, 2000), channel: "email", kind: "real email reply" });
      }
    }
  }
  campaign.inbox = { ...status, ts: Date.now() };
  return status;
}

/**
 * A phone call has ended: its transcript joins the conversation and its outcome is acted on. Someone who asks not to be
 * called goes on the do-not-contact list; anyone who wants more goes to a human, who books the meeting.
 */
export function completeCall(s, campaign, prospect) {
  const v = prospect.voice;
  if (!v) return;
  for (const t of v.transcript) prospect.conversation.push({ dir: t.who === "sdr" ? "out" : "in", text: t.text, when: "Today", channel: "voice", sender: t.who === "sdr" ? (prospect.touches.at(-1) || {}).repName : undefined });
  const heard = v.transcript.some((t) => t.who === "person");
  prospect.history.push({ kind: "chat", text: `Phone call ${heard ? "completed" : "not answered"}: ${v.summary || v.outcome || "no outcome"}`, when: "Today" });
  addNote(prospect, { agent: "Voice SDR Agent", harness: v.harness, engine: v.engine, note: heard ? `Phone call: ${v.summary || v.outcome}.` : "The call was not answered." });
  if (!heard) return;
  campaign.outreach.replies += 1;
  if (v.outcome === "opt_out") {
    s.seq += 1;
    s.suppression.unshift({ id: `x${s.seq}`, contact: prospect.email || prospect.phone, reason: "Asked not to be contacted on a call", added: shortDate(Date.now()) });
    prospect.stage = "rejected";
    prospect.nextStep = "Suppressed: do not contact";
    countOutcome(campaign, "negative");
  } else if (v.outcome === "interested") {
    if (prospect.stage === "contacted") { prospect.stage = "engaged"; campaign.funnel.engaged += 1; }
    countOutcome(campaign, "positive");
    escalate(s, campaign, prospect, { channel: "voice", title: "Wants to talk after a call", body: `${prospect.name} was open to a meeting on the call.`, draft: "Suggest a few times by email.", reasoning: v.summary || "Interested on the phone.", harness: v.harness || "voice" });
  } else if (v.outcome === "callback") {
    prospect.nextStep = "Asked for a call back";
  } else if (v.outcome === "not_interested") {
    prospect.nextStep = "Not interested (phone)";
    countOutcome(campaign, "negative");
  }
  prospect.nextTouchTs = null;
}

// Follow-up Agent: cadence for contacted prospects who have gone quiet. WHEN is policy (the plan, the wait, the touch
// limit, opt-outs, working hours, daily limit); HOW (the message and its angle) is the agent's call.
async function runFollowUp(s, campaign) {
  if (!agentEnabled(s, "followup", campaign)) return;
  const followupAgent = agentById(s, "followup");
  const now = Date.now();
  const silent = s.prospects.filter(
    (p) => p.campaignId === campaign.id && p.stage === "contacted" && p.plan && p.conversation.every((c) => c.dir === "out")
  );

  // 1. Sequences that have run their course with no reply are closed out, and the reason is recorded.
  for (const p of silent) {
    const waitMs = hoursToMs(p.plan.waitHours || campaign.cadence.waitHours);
    if (!p.closedOut && p.touches.length >= touchLimit(campaign, p) && p.lastTs + waitMs <= now) {
      p.closedOut = true;
      p.nextStep = `Closed: no reply after ${p.touches.length} touches`;
      pushDecision(s, {
        kind: "rejected",
        campaignId: campaign.id,
        prospectId: p.id,
        agent: "Follow-up Agent",
        harness: "policy",
        engine: "policy",
        headline: `Sequence complete — ${p.name}, ${p.company}`,
        summary: `No reply from **${p.name}**, ${p.company} after ${p.touches.length} touches; follow-ups stopped`,
        evidence: [`Touches: ${p.touches.map((t) => t.channel).join(" → ")}`, `Campaign touch limit: ${campaign.cadence.maxTouches}`],
        instruction: "Stop after the campaign's touch limit, or on any reply or opt-out.",
        finalAction: "Stop follow-ups and leave the prospect in the funnel as contacted",
      });
    }
  }

  // 2. Follow-ups that are due.
  const due = silent.filter((p) => !p.closedOut && p.nextTouchTs && p.nextTouchTs <= now && p.nextStep === "Awaiting reply");
  for (const prospect of due.slice(0, config.schedulerBatchSize)) {
    try {
      // Re-check the suppression list: someone may have been added mid-campaign.
      const conflict = checkConflict(s, prospect);
      if (!conflict.ok) {
        prospect.nextTouchTs = null;
        prospect.nextStep = "Stopped: on the suppression list";
        pushDecision(s, {
          kind: "blocked",
          campaignId: campaign.id,
          prospectId: prospect.id,
          agent: "Follow-up Agent",
          harness: "policy",
          engine: "policy",
          headline: `Follow-ups stopped — ${prospect.name}, ${prospect.company}`,
          summary: `Follow-ups to **${prospect.name}**, ${prospect.company} stopped: ${conflict.text}`,
          evidence: [conflict.text],
          conflict: { ok: false, text: conflict.text },
          instruction: "Suppression and conflict rules are re-checked before every follow-up.",
          finalAction: "Stop the sequence",
        });
        continue;
      }

      const channel = prospect.plan.sequence[prospect.touches.length];
      if (!channel || !channelEnabled(s, channel)) continue; // that channel is paused: wait rather than switch it silently

      const needsApproval = !!campaign.approvals.firstOutreach;
      const goesOutUnattended = !needsApproval || autoApproval(s, campaign, prospect, "followup").ok;
      if (goesOutUnattended) {
        const gate = outreachAllowed(s, campaign, prospect, Date.now(), channel);
        if (!gate.ok) {
          holdOutreach(s, campaign, prospect, gate.reason);
          prospect.nextStep = "Awaiting reply"; // still due: retried on a later tick
          continue;
        }
      }

      const touchNumber = prospect.touches.length; // follow-up number (the opening was touch 1)
      const isLast = prospect.touches.length + 1 >= touchLimit(campaign, prospect);
      const result = await engine.draftFollowUp({ campaign, prospect, followupAgent, channel, touchNumber, isLast });

      addNote(prospect, { agent: "Follow-up Agent", harness: result.harness, engine: result.engine, note: `Follow-up ${touchNumber} on ${channel}${result.angle ? ` (${result.angle})` : ""}. ${result.reasoning}` });
      pushDecision(s, {
        kind: "strategy",
        campaignId: campaign.id,
        prospectId: prospect.id,
        agent: "Follow-up Agent",
        harness: result.harness,
        engine: result.engine,
        headline: `Follow-up ${touchNumber} on ${channel} — ${prospect.name}, ${prospect.company}`,
        summary: `Follow-up Agent drafted follow-up ${touchNumber} on ${channel} for **${prospect.name}**, ${prospect.company}${isLast ? " (last touch)" : ""}`,
        evidence: [result.reasoning, `No reply after ${prospect.touches.length} touch${prospect.touches.length === 1 ? "" : "es"}: ${prospect.touches.map((t) => t.channel).join(" → ")}`, groundingLine(result.grounding)],
        retrieved: result.retrieved,
        instruction: result.instruction,
        finalAction: goesOutUnattended && result.grounding.ok ? `Send the ${channel} follow-up` : "Queue the follow-up for human approval",
      });

      if (!goesOutUnattended || !result.grounding.ok) {
        pushApproval(s, {
          type: "followup",
          touchKind: "cadence",
          channel,
          prospectId: prospect.id,
          campaignId: campaign.id,
          name: prospect.name,
          company: prospect.company,
          tag: result.grounding.ok ? `Send follow-up ${touchNumber}` : "Review draft: unsupported claim",
          tagTone: result.grounding.ok ? "neutral" : "danger",
          warnings: describeIssues(result.grounding.issues),
          summary: `Send follow-up ${touchNumber} on ${channel} — **${prospect.name}**, ${prospect.company}`,
          recommendation: { title: `No reply after ${prospect.touches.length} touch${prospect.touches.length === 1 ? "" : "es"}; follow up on ${channel}.`, body: result.reasoning },
          draft: { subject: result.subject, body: result.body },
          nextActionText: `Send the ${channel} follow-up${isLast ? " (last touch)" : ""}.`,
          source: `Recommended by Follow-up Agent · ${result.harness}`,
        });
        prospect.lastAction = "Follow-up drafted, {ago}";
        prospect.nextStep = "Awaiting approval";
        prospect.nextTouchTs = null; // set again when the follow-up is approved and sent
      } else {
        recordTouch(s, campaign, prospect, { channel, kind: "followup", subject: result.subject, body: result.body });
      }
      prospect.lastTs = Date.now();
    } catch (e) {
      recordFailure(s, campaign, prospect, "Follow-up", e);
    }
  }
}

// The pipeline is defined once, in sdrSteps.js (the SDR Blueprint shows the same list); this maps each step to its code.
const RUNNERS = {
  discovery: runDiscovery,
  research: runResearch,
  icp: runIcpFitment,
  strategy: runStrategy,
  personalisation: runPersonalisation,
  conversation: runConversation,
  followup: runFollowUp,
};
const STAGES = SDR_STEPS.map((step) => [step.title, RUNNERS[step.key]]);

/** Runs every step of the SDR for one campaign right now (the Dev sandbox uses this instead of waiting for the next tick). */
export async function tickCampaign(campaign) {
  const s = getState();
  for (const [name, run] of STAGES) {
    try {
      await run(s, campaign);
    } catch (e) {
      recordFailure(s, campaign, null, name, e);
    }
  }
  campaign.modifiedTs = Date.now();
}

export async function tick() {
  const s = getState();
  if (s.killSwitch.active) return;

  for (const campaign of s.campaigns) {
    if (!isRunning(s, campaign)) continue; // Draft/Paused/Completed/Archived campaigns never progress.
    campaign.lastTickTs = Date.now(); // proof of life: a paused campaign's stops moving, whatever an in-flight model call does
    for (const [name, run] of STAGES) {
      try {
        await run(s, campaign);
      } catch (e) {
        recordFailure(s, campaign, null, name, e); // contained: the other stages and campaigns still run
      }
    }
    campaign.modifiedTs = Date.now();
  }
}

let timer = null;
let running = false;

export function startScheduler() {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return; // don't overlap ticks if one is still awaiting an LLM call
    running = true;
    try {
      await tick();
      await persistState();
    } catch (e) {
      console.error("[scheduler] Tick failed:", e.message);
    } finally {
      running = false;
    }
  }, config.schedulerIntervalMs);
  console.log(`[scheduler] Autonomous tick started (every ${config.schedulerIntervalMs}ms).`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
