// The autonomous loop (PS: "AI agents do this work autonomously, while a human manager stays
// fully in control"). Replaces the frontend mock's tickState() — instead of incrementing funnel
// counters at random, this drives real, per-prospect agent calls that each write a real Decision
// Journal entry, respecting every guardrail: global kill switch, campaign Live/Paused state,
// per-agent enable/disable, per-channel enable/disable, and cross-campaign conflict detection.
import { getState, persistState } from "../db/index.js";
import { addEvent, isRunning } from "./logic.js";
import { config } from "../config.js";
import { checkConflict } from "./conflict.js";
import { generateProspect } from "./prospectGenerator.js";
import * as engine from "./agentEngine/index.js";
import { classifyReply } from "./replyRouter.js";
import { recordAvoided } from "./usage.js";
import { recordTouch, touchLimit } from "./outreach.js";
import { outreachAllowed } from "./limits.js";
import { describeIssues } from "./grounding.js";
import { hoursToMs } from "./simTime.js";
import { shortDate } from "../utils/format.js";

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

async function runLeadResearch(s, campaign) {
  if (!agentEnabled(s, "lead", campaign)) return;
  // Background volume (mirrors the scale implied by the seeded funnel totals).
  const bump = 1 + Math.floor(Math.random() * 4);
  campaign.funnel.discovered += bump;
  campaign.funnel.researched = Math.min(campaign.funnel.discovered, campaign.funnel.researched + bump);

  // A named, fully-enriched prospect the UI can actually show, some fraction of ticks.
  if (Math.random() < 0.5) {
    const prospect = generateProspect(campaign);
    s.prospects.push(prospect);
    if (Math.random() < 0.3) {
      addEvent(s, { campaignId: campaign.id, type: "enrich", text: `Lead Research Agent enriched a new prospect for **${campaign.name}**`, featured: false });
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
  const allowedChannels = campaign.channels.filter((k) => channelEnabled(s, k));
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
        const gate = outreachAllowed(s, campaign, prospect);
        if (!gate.ok) {
          holdOutreach(s, campaign, prospect, gate.reason);
          continue;
        }
      }

      const result = await engine.draftOutreach({ campaign, prospect, personalisationAgent, channel: planned || undefined });
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
  recordAvoided("replyRouting");
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

async function runConversation(s, campaign) {
  if (!agentEnabled(s, "conversation", campaign)) return;
  const conversationAgent = agentById(s, "conversation");
  const contacted = s.prospects.filter(
    (p) => p.campaignId === campaign.id && p.stage === "contacted" && p.conversation.every((c) => c.dir === "out")
  );

  let handled = 0;
  for (const prospect of contacted) {
    if (handled >= config.schedulerBatchSize) break; // caps the agent calls per tick, not who may reply
    if (Math.random() >= config.simReplyChance) continue; // most prospects stay silent on any given tick
    handled += 1;
    const replyChannel = (prospect.touches.at(-1) || {}).channel || "email";
    const { text: replyText, kind: replyKind } = simulateReply();
    prospect.conversation.push({ dir: "in", text: replyText, when: "Today", channel: replyChannel });
    prospect.nextTouchTs = null; // a reply ends the follow-up sequence

    // Matching before judgment: clear-cut opt-outs and auto-replies are settled by embedding
    // similarity to canonical examples, with no LLM call. Everything else goes to the agent below.
    const routed = await classifyReply(replyText);
    if (routed.deterministic) {
      applyRoutedReply(s, campaign, prospect, routed);
      prospect.lastTs = Date.now();
      continue;
    }

    prospect.history.push({ kind: replyChannel === "email" ? "email" : "chat", text: `Reply received on ${replyChannel} — ${replyKind}`, when: "Today" });
    prospect.stage = "engaged";
    campaign.funnel.engaged += 1;
    campaign.outreach.replies += 1;

    try {
      const result = await engine.handleConversation({ campaign, prospect, conversationAgent });
      countOutcome(campaign, result.action === "meeting" ? "positive" : "neutral");
      if (result.action === "escalate") {
        pushApproval(s, {
          type: "escalation",
          touchKind: "reply",
          channel: replyChannel,
          prospectId: prospect.id,
          campaignId: campaign.id,
          name: prospect.name,
          company: prospect.company,
          tag: "Escalation: objection needs a human",
          warnings: describeIssues(result.grounding.issues),
          tagTone: "danger",
          summary: `Escalation — **${prospect.name}** raised an objection`,
          recommendation: { title: "Respond personally — this needs a compliance-accurate answer.", body: result.reasoning },
          draft: { subject: `Re: ${prospect.company}`, body: result.draft || "Draft this reply personally using the objection-handling playbook." },
          nextActionText: "Reply personally using the objection-handling playbook.",
          source: `Escalated by Conversation Agent · ${result.harness}`,
        });
        prospect.lastAction = "Objection raised, {ago}";
        prospect.nextStep = "Human review";
        addEvent(s, { campaignId: campaign.id, type: "escalate", text: `Conversation Agent escalated **${prospect.name}** — needs human input`, featured: false });
      } else if (result.action === "meeting") {
        if ((campaign.approvals.meetingTime && !autoApproval(s, campaign, prospect, "meeting").ok) || !result.grounding.ok) {
          pushApproval(s, {
            type: "meeting",
            touchKind: "reply",
            channel: replyChannel,
            prospectId: prospect.id,
            campaignId: campaign.id,
            name: prospect.name,
            company: prospect.company,
            tag: "Book meeting",
            warnings: describeIssues(result.grounding.issues),
            tagTone: "neutral",
            summary: `Book meeting — **${prospect.name}**, ${prospect.company}`,
            recommendation: { title: "Confirm the proposed time.", body: result.reasoning },
            draft: { subject: "Meeting time", body: result.draft || "Confirming the proposed meeting time and sending a calendar invite." },
            nextActionText: "Confirm the meeting time and send a calendar invite.",
            source: `Recommended by Conversation Agent · ${result.harness}`,
          });
          prospect.lastAction = "Replied — wants to meet, {ago}";
          prospect.nextStep = "Awaiting approval";
        } else {
          prospect.stage = "meeting";
          prospect.lastAction = "Meeting booked, {ago}";
          prospect.nextStep = "Prep for call";
          campaign.funnel.meeting += 1;
          pushDecision(s, {
            kind: "meeting",
            campaignId: campaign.id,
            prospectId: prospect.id,
            agent: "Conversation & Follow-up Agent",
            harness: result.harness,
            engine: result.engine,
            headline: `Meeting booked — ${prospect.name}, ${prospect.company}`,
            summary: `Conversation Agent booked a meeting with **${prospect.name}**, ${prospect.company}`,
            evidence: [result.reasoning],
            retrieved: result.retrieved,
            instruction: result.instruction,
            finalAction: "Create calendar event and notify the campaign owner",
          });
          addEvent(s, { campaignId: campaign.id, type: "meeting", text: `Conversation Agent booked a meeting with **${prospect.name}** (${prospect.company})`, featured: true });
        }
      } else {
        pushApproval(s, {
          type: "followup",
          touchKind: "reply",
          channel: replyChannel,
          prospectId: prospect.id,
          campaignId: campaign.id,
          name: prospect.name,
          company: prospect.company,
          tag: "Send follow-up email",
          warnings: describeIssues(result.grounding.issues),
          tagTone: "neutral",
          summary: `Send follow-up email — **${prospect.name}**, ${prospect.company}`,
          recommendation: { title: "Send a contextual follow-up.", body: result.reasoning },
          draft: { subject: `Re: ${prospect.company}`, body: result.draft || "Thanks for the reply — following up with the details requested." },
          nextActionText: "Send a follow-up addressing what the prospect asked.",
          source: `Recommended by Conversation Agent · ${result.harness}`,
        });
        prospect.nextStep = "Awaiting approval";
      }
    } catch (e) {
      recordFailure(s, campaign, prospect, "Conversation", e);
    }
    prospect.lastTs = Date.now();
  }
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
        const gate = outreachAllowed(s, campaign, prospect);
        if (!gate.ok) {
          holdOutreach(s, campaign, prospect, gate.reason);
          prospect.nextStep = "Awaiting reply"; // still due: retried on a later tick
          continue;
        }
      }

      const touchNumber = prospect.touches.length; // follow-up number (the opening was touch 1)
      const isLast = prospect.touches.length + 1 >= touchLimit(campaign, prospect);
      const result = await engine.draftFollowUp({ campaign, prospect, followupAgent, channel, touchNumber, isLast });

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

const STAGES = [
  ["Lead Research", runLeadResearch],
  ["ICP Fitment", runIcpFitment],
  ["Outreach Strategy", runStrategy],
  ["Personalisation", runPersonalisation],
  ["Conversation", runConversation],
  ["Follow-up", runFollowUp],
];

export async function tick() {
  const s = getState();
  if (s.killSwitch.active) return;

  for (const campaign of s.campaigns) {
    if (!isRunning(s, campaign)) continue; // Draft/Paused/Completed/Archived campaigns never progress.
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
