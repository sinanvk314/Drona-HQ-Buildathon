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
import { recordTouch } from "./outreach.js";
import { shortDate } from "../utils/format.js";

const agentById = (s, id) => s.agents.find((a) => a.id === id);
const agentEnabled = (s, id) => !s.killSwitch.active && !!agentById(s, id)?.enabled;
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
  if (!agentEnabled(s, "lead")) return;
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
  if (!agentEnabled(s, "icp")) return;
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
      console.warn(`[scheduler] ICP Fitment failed for ${prospect.id}:`, e.message);
    }
  }
}

async function runPersonalisation(s, campaign) {
  if (!agentEnabled(s, "personalisation")) return;
  const activeChannels = campaign.channels.filter((k) => channelEnabled(s, k));
  if (!activeChannels.length) return;
  const personalisationAgent = agentById(s, "personalisation");
  const batch = s.prospects
    .filter((p) => p.campaignId === campaign.id && p.stage === "qualified" && p.nextStep !== "Awaiting approval" && p.nextStep !== "See Decision Journal")
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

      const result = await engine.draftOutreach({ campaign, prospect, personalisationAgent });
      pushDecision(s, {
        kind: "strategy",
        campaignId: campaign.id,
        prospectId: prospect.id,
        agent: "Personalisation & Outreach Strategy Agent",
        harness: result.harness,
        engine: result.engine,
        headline: `Channel chosen — ${prospect.name}, ${prospect.company}`,
        summary: `Personalisation Agent chose ${result.channel} for **${prospect.name}**, ${prospect.company}`,
        evidence: [result.reasoning],
        retrieved: result.retrieved,
        instruction: result.instruction,
        finalAction: `Draft ${result.channel} message`,
      });

      const auto = campaign.approvals.firstOutreach ? autoApproval(s, campaign, prospect, "first") : { ok: true, why: "Approval not required for this campaign" };
      if (!auto.ok) {
        pushApproval(s, {
          type: "first",
          touchKind: "first",
          channel: result.channel,
          prospectId: prospect.id,
          campaignId: campaign.id,
          name: prospect.name,
          company: prospect.company,
          tag: "Send first outreach email",
          tagTone: "neutral",
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
      console.warn(`[scheduler] Personalisation failed for ${prospect.id}:`, e.message);
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
  if (!agentEnabled(s, "conversation")) return;
  const conversationAgent = agentById(s, "conversation");
  const contacted = s.prospects.filter(
    (p) => p.campaignId === campaign.id && p.stage === "contacted" && p.conversation.every((c) => c.dir === "out")
  );

  for (const prospect of contacted.slice(0, config.schedulerBatchSize)) {
    if (Math.random() > 0.35) continue; // not every prospect replies on every tick
    const { text: replyText, kind: replyKind } = simulateReply();
    prospect.conversation.push({ dir: "in", text: replyText, when: "Today" });

    // Matching before judgment: clear-cut opt-outs and auto-replies are settled by embedding
    // similarity to canonical examples, with no LLM call. Everything else goes to the agent below.
    const routed = await classifyReply(replyText);
    if (routed.deterministic) {
      applyRoutedReply(s, campaign, prospect, routed);
      prospect.lastTs = Date.now();
      continue;
    }

    prospect.history.push({ kind: "email", text: `Reply received — ${replyKind}`, when: "Today" });
    prospect.stage = "engaged";
    campaign.funnel.engaged += 1;
    campaign.outreach.replies += 1;

    try {
      const result = await engine.handleConversation({ campaign, prospect, conversationAgent });
      if (result.action === "escalate") {
        pushApproval(s, {
          type: "escalation",
          prospectId: prospect.id,
          campaignId: campaign.id,
          name: prospect.name,
          company: prospect.company,
          tag: "Escalation: objection needs a human",
          tagTone: "danger",
          summary: `Escalation — **${prospect.name}** raised an objection`,
          recommendation: { title: "Respond personally — this needs a compliance-accurate answer.", body: result.reasoning },
          draft: { subject: `Re: ${prospect.company}`, body: "Draft this reply personally using the objection-handling playbook." },
          nextActionText: "Reply personally using the objection-handling playbook.",
          source: `Escalated by Conversation Agent · ${result.harness}`,
        });
        prospect.lastAction = "Objection raised, {ago}";
        prospect.nextStep = "Human review";
        addEvent(s, { campaignId: campaign.id, type: "escalate", text: `Conversation Agent escalated **${prospect.name}** — needs human input`, featured: false });
      } else if (result.action === "meeting") {
        if (campaign.approvals.meetingTime && !autoApproval(s, campaign, prospect, "meeting").ok) {
          pushApproval(s, {
            type: "meeting",
            prospectId: prospect.id,
            campaignId: campaign.id,
            name: prospect.name,
            company: prospect.company,
            tag: "Book meeting",
            tagTone: "neutral",
            summary: `Book meeting — **${prospect.name}**, ${prospect.company}`,
            recommendation: { title: "Confirm the proposed time.", body: result.reasoning },
            draft: { subject: "Meeting time", body: "Confirming the proposed meeting time and sending a calendar invite." },
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
          prospectId: prospect.id,
          campaignId: campaign.id,
          name: prospect.name,
          company: prospect.company,
          tag: "Send follow-up email",
          tagTone: "neutral",
          summary: `Send follow-up email — **${prospect.name}**, ${prospect.company}`,
          recommendation: { title: "Send a contextual follow-up.", body: result.reasoning },
          draft: { subject: `Re: ${prospect.company}`, body: "Thanks for the reply — following up with the details requested." },
          nextActionText: "Send a follow-up addressing what the prospect asked.",
          source: `Recommended by Conversation Agent · ${result.harness}`,
        });
        prospect.nextStep = "Awaiting approval";
      }
    } catch (e) {
      console.warn(`[scheduler] Conversation handling failed for ${prospect.id}:`, e.message);
    }
    prospect.lastTs = Date.now();
  }
}

async function tick() {
  const s = getState();
  if (s.killSwitch.active) return;

  for (const campaign of s.campaigns) {
    if (!isRunning(s, campaign)) continue; // Draft/Paused/Completed/Archived campaigns never progress.
    await runLeadResearch(s, campaign);
    await runIcpFitment(s, campaign);
    await runPersonalisation(s, campaign);
    await runConversation(s, campaign);
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
