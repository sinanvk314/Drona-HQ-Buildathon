// Meeting scheduling end to end: real slots inside a rep's hours, understanding the answer, booking, a calendar invite.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `meetings-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-meetings-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.EMBEDDINGS = "off"; // clear opt-outs are not what is under test here
process.env.MEETING_TIMEZONE = "Asia/Kolkata";
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const { processReply } = await import("../src/services/scheduler.js");
const { proposeSlots, readReplyRule, buildIcs } = await import("../src/services/meetings.js");
const { newProspect } = await import("../src/services/prospects.js");
await initDb();

config.enforceLimits = false;
const state = () => getState();
const campaign = (id) => state().campaigns.find((c) => c.id === id);
const rep = state().reps.find((r) => r.id === "r_jd"); // works 8 AM to 8 PM

// An Autonomous campaign, so the SDR's messages go out on their own (as they will in the Dev sandbox).
const founders = campaign("c_ai_founders");
founders.approvals = { ...founders.approvals, level: "autonomous", meetingTime: false };
founders.repIds = ["r_jd"];

let n = 0;
function contacted(c = founders) {
  n += 1;
  const p = newProspect(c, { name: `Meeting Person${n}`, title: "Founder", company: `MeetCo${n}`, email: `person${n}@meetco${n}.example` }, { provider: "entered by a person", real: true });
  p.stage = "contacted";
  p.conversation.push({ dir: "out", text: "Hello, opening message", when: "Today", channel: "email" });
  p.touches.push({ n: 1, channel: "email", kind: "first", ts: Date.now(), repId: "r_jd", repName: "JD" });
  state().prospects.push(p);
  return p;
}
const wall = (epoch) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epoch));

test("proposed times are on different weekdays, inside the rep's working hours, and at least a day out", () => {
  const now = Date.now();
  const slots = proposeSlots(state(), { rep, campaign: founders, now });
  assert.equal(slots.length, 3);
  const days = new Set();
  for (const s of slots) {
    const parts = Object.fromEntries(wall(s.start).map((p) => [p.type, p.value]));
    assert.ok(!["Sat", "Sun"].includes(parts.weekday), `${s.label} is a weekday`);
    const hour = Number(parts.hour) + Number(parts.minute) / 60;
    assert.ok(hour >= 8 && hour + 0.5 <= 20, `${s.label} is inside 8 AM to 8 PM`);
    assert.ok(s.start >= now + 19 * 3600 * 1000, "not sooner than about a day away");
    assert.equal(s.end - s.start, 30 * 60 * 1000);
    days.add(parts.weekday + s.label.split(" ")[1]);
    assert.match(s.label, /IST$/);
  }
  assert.equal(days.size, 3, "each option is on a different day");
});

test("a reply is understood: a pick, a decline, a counter-offer, or unclear", () => {
  const slots = proposeSlots(state(), { rep, campaign: founders });
  assert.equal(readReplyRule("The second one works for me", slots).choice, 1);
  assert.equal(readReplyRule("Not interested, thanks", slots).declined, true);
  const counter = readReplyRule("Could we do next week Thursday at 5pm?", slots);
  assert.equal(counter.choice, -1);
  assert.ok(counter.alternative.includes("Thursday"));
  const unclear = readReplyRule("whatever suits you", slots);
  assert.deepEqual([unclear.choice, unclear.declined, unclear.alternative], [-1, false, ""]);
});

test("an interested reply gets times offered, the pick books the meeting, and the invite is a real calendar file", async () => {
  const p = contacted();
  const offered = await processReply(state(), founders, p, { text: "Sounds interesting, could we set up a call?", channel: "email" });
  assert.equal(offered.handled, "meeting-proposed");
  assert.equal(p.meeting.status, "proposed");
  const outbound = p.conversation.at(-1);
  assert.equal(outbound.dir, "out");
  assert.equal(outbound.sender, "JD", "sent as the rep");
  for (const slot of p.meeting.slots) assert.ok(outbound.text.includes(slot.label), "the message offers exactly the times that can be booked");

  const chosen = p.meeting.slots[1];
  const booked = await processReply(state(), founders, p, { text: "The second one works for me.", channel: "email" });
  assert.equal(booked.handled, "meeting-booked");
  assert.equal(p.stage, "meeting");
  assert.equal(p.meeting.status, "confirmed");
  assert.equal(p.meeting.chosen.start, chosen.start);
  assert.match(p.conversation.at(-1).text, new RegExp(chosen.label.replace(/[()]/g, "\\$&")));
  assert.ok(state().decisions.some((d) => d.kind === "meeting" && d.prospectId === p.id && /Meeting booked/.test(d.headline)));

  const ics = data.getMeetingIcs(p.id);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(ics, new RegExp(`ATTENDEE;CN=${p.name}`));
  assert.match(ics, /ORGANIZER;CN=JD/);
  assert.match(ics, /STATUS:CONFIRMED\r\n/);
});

test("two prospects are never booked into the same slot on a rep's calendar", async () => {
  const a = contacted();
  await processReply(state(), founders, a, { text: "Yes, let us have a call.", channel: "email" });
  await processReply(state(), founders, a, { text: "The first one works.", channel: "email" });
  const b = contacted();
  await processReply(state(), founders, b, { text: "Happy to chat, can we schedule a call?", channel: "email" });
  const booked = a.meeting.chosen.start;
  assert.ok(!b.meeting.slots.some((s) => s.start === booked), "the booked slot is not offered to anyone else");
});

test("a request for a different time gets other times once, then goes to a human", async () => {
  const p = contacted();
  await processReply(state(), founders, p, { text: "Sure, a call would be good.", channel: "email" });
  const first = p.meeting.slots.map((s) => s.start);
  const again = await processReply(state(), founders, p, { text: "None of those. Could you do Friday at 5pm?", channel: "email" });
  assert.equal(again.handled, "meeting-reproposed");
  assert.ok(p.meeting.slots.every((s) => !first.includes(s.start)), "new times, not the same ones");

  const pending = state().approvals.filter((a) => a.prospectId === p.id && a.status === "pending").length;
  const escalated = await processReply(state(), founders, p, { text: "Still no. Only Friday at 5pm works for me.", channel: "email" });
  assert.equal(escalated.handled, "escalated");
  assert.equal(state().approvals.filter((a) => a.prospectId === p.id && a.status === "pending").length, pending + 1);
  assert.match(state().approvals.at(0).tag, /different meeting time/i);
});

test("a decline closes it politely and books nothing", async () => {
  const p = contacted();
  await processReply(state(), founders, p, { text: "Yes, a call sounds good.", channel: "email" });
  const funnel = founders.funnel.meeting;
  const r = await processReply(state(), founders, p, { text: "Actually, not interested, sorry.", channel: "email" });
  assert.equal(r.handled, "declined");
  assert.equal(p.meeting.status, "declined");
  assert.equal(founders.funnel.meeting, funnel);
  assert.match(p.nextStep, /declined/i);
});

test("in a campaign that needs approval, the times are only offered once a human approves them", async () => {
  const bfsi = campaign("c_india_bfsi");
  bfsi.approvals = { ...bfsi.approvals, level: "manual", meetingTime: true };
  bfsi.repIds = ["r_jd"];
  const p = contacted(bfsi);
  const r = await processReply(state(), bfsi, p, { text: "Interested, can we schedule a call?", channel: "email" });
  assert.equal(r.handled, "meeting-awaiting-approval");
  assert.equal(p.meeting.status, "pending-approval");
  assert.equal(p.conversation.at(-1).dir, "in", "nothing has been sent yet");

  const approval = state().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  assert.equal(approval.meetingProposal, true);
  data.decideApproval(approval.id, { action: "approve" });
  assert.equal(p.meeting.status, "proposed");
  assert.equal(p.conversation.at(-1).dir, "out");
  assert.ok(p.meeting.slots.every((s) => p.conversation.at(-1).text.includes(s.label)));

  const booked = await processReply(state(), bfsi, p, { text: "The third works.", channel: "email" });
  assert.equal(booked.handled, "meeting-booked");
});

test("a rejected proposal is never sent and leaves no meeting behind", async () => {
  const bfsi = campaign("c_india_bfsi");
  const p = contacted(bfsi);
  await processReply(state(), bfsi, p, { text: "Yes please, let us have a call.", channel: "email" });
  const approval = state().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  data.decideApproval(approval.id, { action: "reject", reason: "Times are wrong" });
  assert.equal(p.meeting, null);
  assert.equal(p.conversation.at(-1).dir, "in");
});

test("the ICS builder escapes text and uses UTC times", () => {
  const ics = buildIcs({ uid: "u1", title: "Call; with, commas", start: Date.UTC(2026, 8, 22, 5, 30), end: Date.UTC(2026, 8, 22, 6, 0), organiser: { name: "JD", email: "jd@x.example" }, attendee: { name: "Sam", email: "sam@y.example" } });
  assert.match(ics, /SUMMARY:Call\\; with\\, commas/);
  assert.match(ics, /DTSTART:20260922T053000Z/);
  assert.match(ics, /DTEND:20260922T060000Z/);
});
