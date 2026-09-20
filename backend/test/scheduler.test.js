// The Follow-up agent's cadence and the Strategy agent's plans, driven through the real scheduler tick on a
// throwaway data file, with the free rule engine (no API key, no network).
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `scheduler-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-scheduler-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.SIM_MS_PER_HOUR = "3600000"; // real-time days: a simulated day is 72s by default, which made day-boundary tests flaky
process.env.EMBEDDINGS = "off";
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const { tick } = await import("../src/services/scheduler.js");
await initDb();

config.simReplyChance = 0; // nobody replies, so the cadence is what is being tested
config.enforceLimits = false; // time-of-day would make these tests depend on when they run
config.schedulerBatchSize = 50;
const s = getState();
for (const c of s.campaigns) if (c.status === "live" && c.id !== "c_ai_founders") data.pauseCampaign(c.id);
if (s.campaigns.find((c) => c.id === "c_india_bfsi").status !== "live") data.resumeCampaign("c_india_bfsi");
for (const c of s.campaigns) if (c.id !== "c_india_bfsi" && c.id !== "c_ai_founders" && c.status === "live") data.pauseCampaign(c.id);

let n = 0;
function silentProspect(campaignId, { sequence, touches = 1, dueNow = true, lastAgoMs = 10000 } = {}) {
  n += 1;
  const now = Date.now();
  const p = {
    id: `p_test_${n}`, campaignId, name: `Test Person${n}`, title: "Founder", company: `TestCo${n}`, email: `test${n}@testco${n}.com`,
    industry: "Voice AI", size: "20 employees", funding: "Seed", tech: ["AWS"], city: "Austin, TX",
    stage: "contacted", fit: 90, channel: "Email", lastAction: "Opening email sent, {ago}", lastTs: now - lastAgoMs, nextStep: "Awaiting reply",
    reasons: [], evidence: [], history: [], linkedin: "",
    conversation: [{ dir: "out", text: "Hello, opening message", when: "Today", channel: sequence[0] }],
    plan: { sequence, waitHours: 72, reasoning: "test", engine: "rule", harness: "v1.0", ts: now },
    touches: Array.from({ length: touches }, (_, i) => ({ n: i + 1, channel: sequence[i], kind: i ? "followup" : "first", ts: now - lastAgoMs })),
    nextTouchTs: dueNow ? now - 1 : null,
  };
  getState().prospects.push(p);
  return p;
}
const campaign = (id) => getState().campaigns.find((c) => c.id === id);
const decisionsFor = (p) => getState().decisions.filter((d) => d.prospectId === p.id);

test("a due follow-up goes out on the next planned channel and schedules the one after", async () => {
  const p = silentProspect("c_ai_founders", { sequence: ["email", "sms", "email"] }); // autonomous campaign
  const before = campaign("c_ai_founders").outreach.followups;
  await tick();
  assert.equal(p.touches.length, 2);
  assert.equal(p.touches[1].channel, "sms", "the second touch uses the second channel in the plan");
  assert.equal(p.touches[1].kind, "followup");
  assert.equal(p.conversation.at(-1).channel, "sms");
  assert.ok(p.nextTouchTs > Date.now(), "the third touch is scheduled for later");
  assert.equal(campaign("c_ai_founders").outreach.followups, before + 1);
  assert.ok(decisionsFor(p).some((d) => d.agent === "Follow-up Agent"), "the decision is in the journal");
});

test("in a campaign that needs approval, the follow-up waits for a human, and approving it sends it", async () => {
  const p = silentProspect("c_india_bfsi", { sequence: ["email", "email", "email"] }); // manual approval level
  await tick();
  assert.equal(p.touches.length, 1, "nothing was sent yet");
  assert.equal(p.nextStep, "Awaiting approval");
  const approval = getState().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  assert.equal(approval.touchKind, "cadence");
  assert.equal(approval.channel, "email");

  data.decideApproval(approval.id, { action: "approve" });
  assert.equal(p.touches.length, 2);
  assert.equal(p.nextStep, "Awaiting reply");
  assert.ok(p.nextTouchTs > Date.now());
});

test("a rejected follow-up stops the sequence", async () => {
  const p = silentProspect("c_india_bfsi", { sequence: ["email", "email", "email"] });
  await tick();
  const approval = getState().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  data.decideApproval(approval.id, { action: "reject", reason: "Too pushy" });
  assert.match(p.nextStep, /sequence stopped/);
  assert.equal(p.nextTouchTs, null);
  await tick();
  assert.equal(p.touches.length, 1, "no further follow-up is drafted");
});

test("a sequence that has run its course is closed out with a recorded reason", async () => {
  const p = silentProspect("c_ai_founders", { sequence: ["email", "sms", "email"], touches: 3, dueNow: false, lastAgoMs: 100 * 60 * 60 * 1000 });
  await tick();
  assert.equal(p.closedOut, true);
  assert.match(p.nextStep, /no reply after 3 touches/);
  assert.ok(decisionsFor(p).some((d) => /Sequence complete/.test(d.headline)));
  const touches = p.touches.length;
  await tick();
  assert.equal(p.touches.length, touches, "nothing more is sent");
});

test("a contact added to the suppression list mid-sequence gets no further follow-up", async () => {
  const p = silentProspect("c_ai_founders", { sequence: ["email", "sms", "email"] });
  data.addSuppression({ contact: p.email, reason: "Asked to stop" });
  await tick();
  assert.equal(p.touches.length, 1);
  assert.match(p.nextStep, /suppression list/);
  assert.equal(p.nextTouchTs, null);
});

test("a follow-up is held, with no agent call, when the daily limit is reached", async () => {
  config.enforceLimits = true;
  try {
    const c = campaign("c_ai_founders");
    const saved = { dailyLimit: c.dailyLimit, workingHours: c.workingHours };
    c.workingHours = "12:00 AM – 11:59 PM";
    const p = silentProspect("c_ai_founders", { sequence: ["email", "sms", "email"] });
    c.dailyLimit = getState().prospects.filter((x) => x.campaignId === c.id).reduce((k, x) => k + x.touches.filter((t) => t.ts > Date.now() - 20000).length, 0);
    const llmBefore = (await import("../src/services/usage.js")).getUsage().llmCalls;
    await tick();
    assert.equal(p.touches.length, 1, "nothing sent");
    assert.equal(p.nextStep, "Awaiting reply", "still due, retried when the limit clears");
    assert.ok(getState().decisions.some((d) => d.agent === "Outreach Limits" && d.campaignId === c.id));
    assert.equal((await import("../src/services/usage.js")).getUsage().llmCalls, llmBefore, "no LLM request was made");
    Object.assign(c, saved);
  } finally {
    config.enforceLimits = false;
  }
});

test("each qualified prospect gets a plan that only uses enabled channels, before anything is drafted", async () => {
  const c = campaign("c_ai_founders");
  const planned = getState().prospects.filter((p) => p.campaignId === c.id && p.plan && p.id.startsWith("p_gen_"));
  // Give the loop a few ticks to qualify and plan generated prospects.
  for (let i = 0; i < 6 && planned.length < 1; i++) {
    await tick();
    planned.push(...getState().prospects.filter((p) => p.campaignId === c.id && p.plan && p.id.startsWith("p_gen_") && !planned.includes(p)));
  }
  assert.ok(planned.length >= 1, "at least one generated prospect was planned");
  for (const p of planned) {
    assert.ok(p.plan.sequence.length >= 1 && p.plan.sequence.length <= c.cadence.maxTouches);
    assert.ok(p.plan.sequence.every((ch) => c.channels.includes(ch)), `plan ${p.plan.sequence} stays within ${c.channels}`);
    assert.notEqual(p.plan.sequence[0], "sms", "SMS is never the opening touch");
  }
});

test("pausing one agent in one campaign stops only that agent there, and the other campaigns carry on", async () => {
  const founders = silentProspect("c_ai_founders", { sequence: ["email", "sms", "email"] });
  const bfsi = silentProspect("c_india_bfsi", { sequence: ["email", "email", "email"] });

  data.setCampaignAgentEnabled("c_ai_founders", "followup", false);
  await tick();
  assert.equal(founders.touches.length, 1, "follow-ups are off in the founders campaign");
  assert.ok(getState().approvals.some((a) => a.prospectId === bfsi.id && a.touchKind === "cadence"), "the BFSI campaign still follows up");
  assert.equal(data.getCampaign("c_ai_founders").agents.find((a) => a.id === "followup").enabled, false);
  assert.equal(data.getCampaign("c_india_bfsi").agents.find((a) => a.id === "followup").enabled, true);

  data.setCampaignAgentEnabled("c_ai_founders", "followup", true);
  await tick();
  assert.equal(founders.touches.length, 2, "and it resumes when turned back on");
});

test("a stage that fails is contained, counted and journalled, and other campaigns still progress", async () => {
  const bad = silentProspect("c_ai_founders", { sequence: ["email", "sms", "email"] });
  bad.plan.waitHours = 0; // makes the close-out check fall back to campaign.cadence...
  const founders = campaign("c_ai_founders");
  const savedCadence = founders.cadence;
  founders.cadence = null; // ...which is now missing, so the Follow-up stage throws for this campaign
  const good = silentProspect("c_india_bfsi", { sequence: ["email", "email", "email"] });
  const before = data.getCampaign("c_ai_founders").activity.failed;

  await tick(); // must not throw

  assert.equal(data.getCampaign("c_ai_founders").activity.failed, before + 1);
  assert.ok(getState().decisions.some((d) => d.engine === "error" && d.campaignId === "c_ai_founders" && /Workflow failed — Follow-up/.test(d.headline)));
  assert.ok(getState().approvals.some((a) => a.prospectId === good.id && a.touchKind === "cadence"), "another campaign's follow-up still went ahead");
  assert.equal(bad.touches.length, 1, "nothing was sent by the failed step");

  // The same failure repeating does not flood the journal, but it is still counted.
  const journalled = getState().decisions.filter((d) => d.engine === "error").length;
  await tick();
  assert.equal(getState().decisions.filter((d) => d.engine === "error").length, journalled);
  assert.ok(data.getCampaign("c_ai_founders").activity.failed >= before + 2);
  founders.cadence = savedCadence;
});

test("replies are split into positive, negative and neutral outcomes, with conversion rates", async () => {
  const c = campaign("c_us_saas");
  c.outcomes = { positive: 3, negative: 1, neutral: 6 };
  const view = data.getCampaign("c_us_saas").outcomes;
  assert.equal(view.total, 10);
  assert.equal(view.positiveRate, 30);
  assert.equal(view.negativeRate, 10);
  assert.ok(view.rates.qualify >= 0 && view.rates.reply <= 100 && view.rates.meeting <= 100);
  assert.equal(typeof data.getCampaign("c_us_saas").activity.inFlight, "number");
});

test("proof of life: a Live campaign records when it was last worked on, and a paused one stops", async () => {
  const live = s.campaigns.find((c) => c.status === "live");
  const paused = s.campaigns.find((c) => c.status === "paused");
  assert.ok(live && paused, "the fixture has one of each");
  const before = paused.lastTickTs || null;
  const liveBefore = live.lastTickTs || 0;
  await new Promise((r) => setTimeout(r, 5));
  await tick();
  assert.ok(live.lastTickTs > liveBefore, "the Live campaign was worked on");
  assert.equal(paused.lastTickTs || null, before, "the paused one was not");
  assert.equal(data.getCampaign(live.id).lastTickTs, live.lastTickTs, "and the page can see it");
});
