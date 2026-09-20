// The simulated clock, hard outreach limits, touch recording and the additive state migration.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SIM_MS_PER_HOUR = "1000"; // one simulated hour = one real second, so the maths below is exact
const { config } = await import("../src/config.js");
const { parseWorkingHours, withinWorkingHours, simMinuteOfDay, hoursToMs } = await import("../src/services/simTime.js");
const { outreachAllowed, sentToday } = await import("../src/services/limits.js");
const { recordTouch, touchLimit } = await import("../src/services/outreach.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildSeed } = await import("../src/db/seed.js");

// A real timestamp whose simulated time of day is exactly `hour`:`00` (day length is 24s at 1000 ms/hour).
const at = (hour, dayIndex = 1000) => dayIndex * 24 * 1000 + hour * 1000;

test("working hours are read from the campaign text", () => {
  assert.deepEqual(parseWorkingHours("9:00 AM – 6:00 PM, prospect local time"), { start: 540, end: 1080 });
  assert.deepEqual(parseWorkingHours("10:00 AM – 6:00 PM IST"), { start: 600, end: 1080 });
  assert.deepEqual(parseWorkingHours("9-17"), { start: 540, end: 1020 });
  assert.equal(parseWorkingHours("whenever"), null);
});

test("the simulated clock decides whether a campaign may send", () => {
  const campaign = { workingHours: "9:00 AM – 6:00 PM" };
  assert.equal(simMinuteOfDay(at(14)), 14 * 60);
  assert.equal(withinWorkingHours(campaign, at(14)), true);
  assert.equal(withinWorkingHours(campaign, at(21)), false);
  assert.equal(withinWorkingHours(campaign, at(8)), false);
  assert.equal(withinWorkingHours({ workingHours: "unreadable" }, at(3)), true, "unreadable hours never block");
});

function world() {
  const state = buildSeed(at(14));
  const campaign = state.campaigns.find((c) => c.id === "c_us_saas");
  const prospect = state.prospects.find((p) => p.campaignId === "c_us_saas");
  return { state, campaign, prospect };
}

test("a touch is recorded once, everywhere, and schedules the next follow-up", () => {
  const { state, campaign, prospect } = world();
  prospect.touches = [];
  prospect.conversation = [];
  prospect.plan = { sequence: ["linkedin", "email", "email"], waitHours: 48 };
  const contactedBefore = campaign.funnel.contacted;

  const ts = at(14);
  const n = recordTouch(state, campaign, prospect, { channel: "linkedin", kind: "first", subject: "Hi", body: "Hello there", ts });
  assert.equal(n, 1);
  assert.equal(prospect.stage, "contacted");
  assert.equal(campaign.funnel.contacted, contactedBefore + 1);
  assert.equal(prospect.conversation.at(-1).channel, "linkedin");
  assert.equal(prospect.nextTouchTs, ts + hoursToMs(48), "next follow-up is due after the planned wait, on the simulated clock");

  recordTouch(state, campaign, prospect, { channel: "email", kind: "followup", body: "Following up", ts: ts + 1 });
  assert.equal(campaign.funnel.contacted, contactedBefore + 1, "a follow-up does not count as a new contact");
  recordTouch(state, campaign, prospect, { channel: "email", kind: "followup", body: "Last note", ts: ts + 2 });
  assert.equal(prospect.nextTouchTs, null, "the sequence stops at the touch limit");
});

test("the touch limit is the smaller of the campaign limit and the planned sequence", () => {
  const { campaign, prospect } = world();
  campaign.cadence = { maxTouches: 5, waitHours: 72 };
  prospect.plan = { sequence: ["email", "linkedin"] };
  assert.equal(touchLimit(campaign, prospect), 2);
  campaign.cadence.maxTouches = 1;
  assert.equal(touchLimit(campaign, prospect), 1);
  prospect.plan = null;
  assert.equal(touchLimit(campaign, prospect), 1, "an unplanned prospect gets the opening touch only");
});

test("outreach is held back outside working hours, at the daily limit and at the frequency cap", () => {
  const { state, campaign, prospect } = world();
  assert.equal(outreachAllowed(state, campaign, prospect, at(21)).ok, false);
  assert.match(outreachAllowed(state, campaign, prospect, at(21)).reason, /working hours/);

  const now = at(14);
  campaign.dailyLimit = 2;
  const others = state.prospects.filter((p) => p.campaignId === campaign.id);
  for (const p of others) p.touches = [];
  others[0].touches = [{ n: 1, channel: "email", kind: "first", ts: now }, { n: 2, channel: "email", kind: "followup", ts: now }];
  assert.equal(sentToday(state, campaign, now), 2);
  assert.match(outreachAllowed(state, campaign, prospect, now).reason, /Daily limit/);

  campaign.dailyLimit = 100;
  prospect.email = "same@person.com";
  prospect.touches = Array.from({ length: 4 }, (_, i) => ({ n: i + 1, channel: "email", kind: "first", ts: now - i }));
  assert.match(outreachAllowed(state, campaign, prospect, now).reason, /frequency cap/);

  config.enforceLimits = false;
  assert.equal(outreachAllowed(state, campaign, prospect, at(21)).ok, true, "ENFORCE_LIMITS=off lifts every limit");
  config.enforceLimits = true;
});

test("migrating old state adds what is new and never removes or overwrites anything", () => {
  const state = buildSeed(Date.now());
  // Make it look like a saved state from before strategy/follow-up existed, with a campaign the user made.
  state.agents = state.agents.filter((a) => a.id !== "strategy" && a.id !== "followup");
  for (const c of state.campaigns) delete c.cadence;
  for (const p of state.prospects) { delete p.touches; delete p.plan; delete p.nextTouchTs; }
  state.campaigns.push({ ...state.campaigns[0], id: "c_mine", name: "My own campaign", cadence: { maxTouches: 5, waitHours: 24 } });
  const promptBefore = state.agents.find((a) => a.id === "icp").versions[0].text;

  assert.equal(migrate(state), true);
  assert.ok(state.agents.some((a) => a.id === "strategy") && state.agents.some((a) => a.id === "followup"));
  assert.deepEqual(state.campaigns.find((c) => c.id === "c_mine").cadence, { maxTouches: 5, waitHours: 24 }, "an existing setting is kept");
  assert.ok(state.campaigns.some((c) => c.name === "My own campaign"));
  assert.ok(state.prospects.every((p) => Array.isArray(p.touches) && p.plan === null && p.nextTouchTs === null));
  assert.equal(state.agents.find((a) => a.id === "icp").versions[0].text, promptBefore);
  assert.equal(migrate(state), false, "running it again changes nothing");
});
