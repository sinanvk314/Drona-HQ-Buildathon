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
    .filter((p) => p.campaignId === campaign.id && p.stage === "qualified" && p.nextStep !== "Awaiting approval")
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
        headline: `Channel chosen — ${prospect.name}, ${prospect.company}`,
        summary: `Personalisation Agent chose ${result.channel} for **${prospect.name}**, ${prospect.company}`,
        evidence: [result.reasoning],
        retrieved: result.retrieved,
        instruction: result.instruction,
        finalAction: `Draft ${result.channel} message`,
      });

      if (campaign.approvals.firstOutreach) {
        pushApproval(s, {
          type: "first",
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
        prospect.stage = "contacted";
        prospect.channel = result.channel[0].toUpperCase() + result.channel.slice(1);
        prospect.conversation.push({ dir: "out", text: result.body, when: "Today" });
        prospect.history.push({ kind: "email", text: `Opening ${result.channel} sent — "${result.subject}"`, when: "Today" });
        prospect.lastAction = `Opening ${result.channel} sent, {ago}`;
        prospect.nextStep = "Awaiting reply";
        campaign.funnel.contacted += 1;
        campaign.outreach[result.channel === "email" || result.channel === "sms" ? (result.channel === "email" ? "emails" : "linkedin") : "linkedin"] =
          (campaign.outreach.emails || 0) + 1;
      }
      prospect.lastTs = Date.now();
    } catch (e) {
      console.warn(`[scheduler] Personalisation failed for ${prospect.id}:`, e.message);
    }
  }
}

async function runConversation(s, campaign) {
  if (!agentEnabled(s, "conversation")) return;
  const conversationAgent = agentById(s, "conversation");
  const contacted = s.prospects.filter(
    (p) => p.campaignId === campaign.id && p.stage === "contacted" && p.conversation.every((c) => c.dir === "out")
  );

  for (const prospect of contacted.slice(0, config.schedulerBatchSize)) {
    if (Math.random() > 0.35) continue; // not every prospect replies on every tick
    const objection = Math.random() < 0.3;
    const replyText = objection
      ? "Before we go further — can you share your SOC 2 report and where data is stored?"
      : Math.random() < 0.5
      ? "Interesting — could we do a quick call this week?"
      : "Thanks for reaching out, tell me more about pricing.";
    prospect.conversation.push({ dir: "in", text: replyText, when: "Today" });
    prospect.history.push({ kind: "email", text: `Reply received — ${objection ? "security / compliance objection" : "asked about pricing"}`, when: "Today" });
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
        if (campaign.approvals.meetingTime) {
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
