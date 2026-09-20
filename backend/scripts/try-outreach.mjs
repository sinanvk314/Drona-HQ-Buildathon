// Runs the Outreach Strategy, Follow-up and Conversation agents once each on a seeded prospect, so you can read
// what they produce and whether the grounding check passes. Uses AGENT_ENGINE from .env (set it to gemini for the
// real model; about 3 requests, more if a draft has to be rewritten).
//
//   node scripts/try-outreach.mjs
import os from "os";
import path from "path";

process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-try-outreach-${process.pid}.json`);
const { buildSeed } = await import("../src/db/seed.js");
const engine = await import("../src/services/agentEngine/index.js");
const { config } = await import("../src/config.js");

const seed = buildSeed(Date.now());
const agent = (id) => seed.agents.find((a) => a.id === id);
const campaign = seed.campaigns.find((c) => c.id === "c_us_saas");
const prospect = { ...seed.prospects.find((p) => p.campaignId === "c_us_saas"), touches: [], plan: null };
console.log(`Engine chain: ${config.agentEngine}\nProspect: ${prospect.name}, ${prospect.title} at ${prospect.company}\n`);

const plan = await engine.planOutreach({ campaign, prospect, strategyAgent: agent("strategy"), allowedChannels: campaign.channels });
console.log(`STRATEGY (${plan.engine}${plan.fallbackReason ? `; fell back: ${plan.fallbackReason}` : ""})`);
console.log(`  sequence: ${plan.sequence.join(" -> ")}   wait: ${plan.waitHours}h\n  why: ${plan.reasoning}\n`);

prospect.conversation = [{ dir: "out", text: "Hi Dana, saw Fleetwise is hiring a Cloud FinOps Engineer. Worth a quick look at how teams like yours cut cloud spend?", channel: plan.sequence[0] }];
const follow = await engine.draftFollowUp({ campaign, prospect, followupAgent: agent("followup"), channel: plan.sequence[1] || plan.sequence[0], touchNumber: 1, isLast: false });
console.log(`FOLLOW-UP on ${plan.sequence[1] || plan.sequence[0]} (${follow.engine}${follow.regenerated ? ", rewritten once" : ""})`);
console.log(`  ${follow.subject}\n  ${follow.body}\n  angle: ${follow.angle}`);
console.log(`  grounding: ${follow.grounding.ok ? "OK" : "FAILED " + JSON.stringify(follow.grounding.issues)}\n`);

prospect.conversation.push({ dir: "in", text: "Before we go further, can you share your SOC 2 report and where data is stored?" });
const convo = await engine.handleConversation({ campaign, prospect, conversationAgent: agent("conversation") });
console.log(`CONVERSATION (${convo.engine}): action = ${convo.action}`);
console.log(`  reason: ${convo.reasoning}\n  draft: ${convo.draft}`);
console.log(`  grounding: ${convo.grounding.ok ? "OK" : "FAILED " + JSON.stringify(convo.grounding.issues)}`);
