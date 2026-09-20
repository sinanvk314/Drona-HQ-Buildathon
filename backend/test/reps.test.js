// Representatives: assignment, who a touch is sent as, per-rep channels/hours/limits, offboarding and reassignment.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `reps-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-reps-${process.pid}.json`);
process.env.SIM_MS_PER_HOUR = "3600000"; // real-time days, so "today" does not roll over mid-test
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const { pickRep, repBlocker, campaignsNeedingReps } = await import("../src/services/reps.js");
const { outreachAllowed } = await import("../src/services/limits.js");
const { recordTouch } = await import("../src/services/outreach.js");
await initDb();

const s = () => getState();
const campaign = (id) => s().campaigns.find((c) => c.id === id);
const rep = (id) => s().reps.find((r) => r.id === id);
const ALL_DAY = "12:00 AM – 11:59 PM";
for (const r of s().reps) r.workingHours = ALL_DAY; // time of day must not decide these tests
for (const c of s().campaigns) c.workingHours = ALL_DAY;

let n = 0;
const prospectIn = (campaignId) => {
  n += 1;
  const p = { id: `p_rep_${n}`, campaignId, name: `Rep Test${n}`, title: "CTO", company: `RepCo${n}`, email: `rep${n}@repco${n}.com`, stage: "qualified", touches: [], conversation: [], history: [], plan: null, nextTouchTs: null };
  s().prospects.push(p);
  return p;
};

test("the seeded campaigns each have reps assigned, and the reps have their own channels, hours and limits", () => {
  assert.deepEqual(campaign("c_us_saas").repIds, ["r_priya", "r_rohit"]);
  const view = data.getReps().reps.find((r) => r.id === "r_priya");
  assert.deepEqual(view.campaigns.map((c) => c.id).sort(), ["c_ai_founders", "c_us_saas"]);
  assert.ok(view.dailyLimit > 0 && view.channels.length && view.workingHours);
});

test("a touch is sent as an assigned rep who works that channel, and the prospect keeps the same rep", () => {
  const p = prospectIn("c_ai_founders"); // assigned: Priya (email, linkedin, sms) and JD (all four)
  recordTouch(s(), campaign("c_ai_founders"), p, { channel: "email", kind: "first", subject: "Hi", body: "Hello" });
  assert.ok(["r_priya", "r_jd"].includes(p.touches[0].repId));
  assert.equal(p.touches[0].repName, rep(p.touches[0].repId).name);
  assert.equal(p.conversation[0].sender, p.touches[0].repName);
  recordTouch(s(), campaign("c_ai_founders"), p, { channel: "sms", kind: "followup", body: "Nudge" });
  assert.equal(p.touches[1].repId, p.touches[0].repId, "the same rep follows up");
});

test("a channel only some reps work is sent by one of them", () => {
  const r = pickRep(s(), campaign("c_us_saas"), "voice"); // Priya has no voice, Rohit does
  assert.equal(r.id, "r_rohit");
  assert.equal(repBlocker(s(), rep("r_priya"), "voice"), "not on voice");
});

test("a rep's own daily limit holds outreach when every assigned rep is used up", () => {
  config.enforceLimits = true;
  try {
    const c = campaign("c_us_saas");
    const p = prospectIn("c_us_saas");
    for (const id of c.repIds) rep(id).dailyLimit = 1;
    // Each rep has already sent one touch today.
    for (const id of c.repIds) {
      const other = prospectIn("c_us_saas");
      other.touches = [{ n: 1, channel: "email", kind: "first", ts: Date.now(), repId: id, repName: rep(id).name }];
    }
    c.dailyLimit = 1000;
    const gate = outreachAllowed(s(), c, p, Date.now(), "email");
    assert.equal(gate.ok, false);
    assert.match(gate.reason, /No assigned rep can send on email/);
    assert.match(gate.reason, /at their daily limit/);
    for (const id of c.repIds) rep(id).dailyLimit = 25;
    assert.equal(outreachAllowed(s(), c, prospectIn("c_us_saas"), Date.now(), "email").ok, true);
  } finally {
    config.enforceLimits = false;
  }
});

test("offboarding a rep surfaces every campaign that used them, and reassigning fixes it", () => {
  config.enforceLimits = true;
  try {
    const { affected } = data.offboardRep("r_rohit");
    assert.deepEqual(affected.map((a) => a.id).sort(), ["c_india_bfsi", "c_us_saas"]);
    assert.equal(rep("r_rohit").status, "offboarded");
    assert.equal(pickRep(s(), campaign("c_us_saas"), "email").id, "r_priya", "the campaign carries on with its other rep");
    assert.deepEqual(campaignsNeedingReps(s()), [], "every campaign still has an active rep");

    // Priya leaves too: US SaaS now has nobody, and outreach is held with a clear reason.
    data.offboardRep("r_priya");
    assert.deepEqual(campaignsNeedingReps(s()).map((c) => c.id), ["c_us_saas"]);
    assert.equal(data.getCommandCenter().repAlerts[0].id, "c_us_saas");
    const gate = outreachAllowed(s(), campaign("c_us_saas"), prospectIn("c_us_saas"), Date.now(), "email");
    assert.equal(gate.ok, false);
    assert.match(gate.reason, /offboarded\. Reassign/);

    // An admin hands Priya's work to JD.
    const moved = data.reassignRep("r_priya", "r_jd");
    assert.ok(moved.campaigns >= 2);
    assert.deepEqual(campaignsNeedingReps(s()), []);
    assert.ok(campaign("c_us_saas").repIds.includes("r_jd"));
    assert.throws(() => data.reassignRep("r_jd", "r_rohit"), /active rep/);
    assert.throws(() => data.updateRep("r_rohit", { name: "x" }), /offboarded/);
  } finally {
    config.enforceLimits = false;
  }
});

test("reps are validated on creation, and a campaign's reps can be set", () => {
  assert.throws(() => data.createRep({ name: "A", email: "nope", channels: [], dailyLimit: 0, workingHours: "later" }), (e) => Object.keys(e.fields).length === 5);
  const created = data.createRep({ name: "Asha N.", email: "asha@nimbusguard.example", channels: ["email"], dailyLimit: 20, workingHours: "9:00 AM – 5:00 PM" });
  assert.equal(created.status, "active");
  data.setCampaignReps("c_ai_founders", [created.id]);
  assert.deepEqual(campaign("c_ai_founders").repIds, [created.id]);
  assert.equal(data.getCampaign("c_ai_founders").reps[0].name, "Asha N.");
  assert.throws(() => data.setCampaignReps("c_ai_founders", ["r_rohit"]), /offboarded/);
  assert.throws(() => data.setCampaignReps("c_ai_founders", ["r_nobody"]), /Rep not found/);
});

test("a campaign with no reps assigned behaves as before (its own limits only)", () => {
  config.enforceLimits = true;
  try {
    const c = campaign("c_ai_founders");
    c.repIds = [];
    assert.equal(outreachAllowed(s(), c, prospectIn("c_ai_founders"), Date.now(), "email").ok, true);
    const p = prospectIn("c_ai_founders");
    recordTouch(s(), c, p, { channel: "email", kind: "first", subject: "Hi", body: "Hello" });
    assert.equal(p.touches[0].repId, null);
  } finally {
    config.enforceLimits = false;
  }
});
