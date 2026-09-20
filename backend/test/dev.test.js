// The Dev tab: a sandbox with a real person as the prospect, the search playground, and real-data tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `dev-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-dev-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.EMBEDDINGS = "off";
process.env.MEETING_TIMEZONE = "Asia/Kolkata";
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const dev = await import("../src/services/dev.js");
await initDb();
config.enforceLimits = true; // as on a real deployment: a sandbox must work with the limits on
config.simReplyChance = 0;

let server, reply;
before(async () => {
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: "STOP" }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  config.gemini.baseUrl = `http://127.0.0.1:${server.address().port}/v1beta`;
  config.gemini.apiKey = "test-key";
  config.gemini.rpm = 600000;
  config.gemini.model = "test-model";
  config.gemini.retries = 0;
});
after(() => server.close());

const judge = {
  objective: "Book a 30-minute intro call", offer: "A free workshop series on running student clubs.",
  target: { name: "Prof. Sundar Raman", title: "Faculty Advisor, Tech Contingent", organisation: "IIT Madras", email: "sundar@iitm.example", notes: "Advises the Tech Contingent\nHelps run the inter-guild buildathon" },
};

test("a sandbox is a live single-target campaign for exactly the person entered, sending as a rep", () => {
  const box = dev.createSandbox(judge);
  const c = getState().campaigns.find((x) => x.id === box.id);
  assert.equal(c.sandbox, true);
  assert.equal(c.mode, "single");
  assert.equal(c.status, "live");
  assert.equal(c.approvals.level, "autonomous");
  assert.equal(box.prospect.name, "Prof. Sundar Raman");
  assert.equal(box.prospect.dossier.facts.length, 2, "the entered facts are in the dossier, labelled as entered");
  assert.ok(box.prospect.dossier.facts.every((f) => f.source === "entered by a person"));
  assert.ok(box.rep && box.rep.name);
  assert.equal(getState().prospects.filter((p) => p.campaignId === box.id).length, 1);
});

test("running the SDR researches the person, plans and writes to them, using only what was entered", async () => {
  const box = dev.listSandboxes()[0];
  const run = await dev.runSandbox(box.id);
  const p = run.prospect;
  assert.ok(p.research && p.research.summary, "research ran");
  assert.equal(p.stage, "contacted", "the first message went out");
  assert.equal(p.conversation.filter((m) => m.dir === "out").length, 1);
  assert.ok(p.plan && p.plan.sequence.length >= 1);
  assert.match(JSON.stringify(p.dossier.notes.map((n) => n.agent)), /Research Agent[\s\S]*Personalisation Agent/);
  const first = p.conversation[0].text;
  assert.doesNotMatch(first, /\d+%|SOC 2|guarantee/i, "nothing unsupported was said");
});

test("the person replies in their own words and the SDR offers times, then books the one they choose", async () => {
  const box = dev.listSandboxes()[0];
  const offered = await dev.sandboxReply(box.id, "This sounds interesting. Could we set up a call?");
  assert.equal(offered.outcome.handled, "meeting-proposed");
  const slots = offered.sandbox.prospect.meeting.slots;
  assert.equal(slots.length, 3);
  assert.ok(offered.sandbox.prospect.conversation.at(-1).text.includes(slots[0].label));

  const booked = await dev.sandboxReply(box.id, "The first one works for me, thank you.");
  assert.equal(booked.outcome.handled, "meeting-booked");
  const card = booked.sandbox.scorecard;
  assert.equal(card.verdict, "Meeting booked");
  assert.equal(card.meeting.label, slots[0].label);
  assert.equal(card.turns.fromPerson, 2);
  assert.ok(card.checks.every((c) => c.pass !== false), `every check passes: ${JSON.stringify(card.checks.filter((c) => c.pass === false))}`);
  assert.match(data.getMeetingIcs(booked.sandbox.prospect.id), /BEGIN:VEVENT/);
  assert.equal(booked.sandbox.prospect.meeting.ics, undefined, "the invite text is not sent with the sandbox view");
});

test("feedback from the person is recorded against the run", async () => {
  const box = dev.listSandboxes()[0];
  const f = await dev.setSandboxFeedback(box.id, { rating: 4, notes: "Times were sensible." });
  assert.equal(f.rating, 4);
  assert.equal(dev.getSandbox(box.id).feedback.notes, "Times were sensible.");
  await assert.rejects(() => dev.setSandboxFeedback(box.id, { rating: 9 }), /1 to 5/);
});

test("a sandbox never appears in the dashboard, the approvals queue, the journal or a comparison", () => {
  const cc = data.getCommandCenter();
  assert.ok(!cc.campaigns.some((c) => /Sandbox/.test(c.name)));
  assert.ok(!data.getComparison().some((c) => /Sandbox/.test(c.name)));
  assert.ok(!data.getDecisions({ limit: 500 }).items.some((d) => /Sundar/.test(d.headline)));
  assert.ok(!data.getApprovals().items.some((a) => /Sundar/.test(a.name)));
});

test("a reply before the SDR has written is refused, and an empty one too", async () => {
  const box = dev.createSandbox({ ...judge, target: { ...judge.target, name: "Dr. Not Yet" } });
  await assert.rejects(() => dev.sandboxReply(box.id, "hello"), /Press Run the SDR first/);
  await dev.runSandbox(box.id);
  await assert.rejects(() => dev.sandboxReply(box.id, "   "), /Type a reply/);
});

test("deleting a sandbox removes everything it created and only that", async () => {
  const s = getState();
  const before = { campaigns: s.campaigns.length, real: s.campaigns.filter((c) => !c.sandbox).length };
  const target = dev.listSandboxes().find((b) => /Not Yet/.test(b.name));
  await dev.deleteSandbox(target.id);
  assert.equal(getState().campaigns.length, before.campaigns - 1);
  assert.equal(getState().campaigns.filter((c) => !c.sandbox).length, before.real);
  assert.ok(!getState().prospects.some((p) => p.campaignId === target.id));
  assert.throws(() => dev.getSandbox(target.id), /Sandbox not found/);
});

test("the search playground returns fictional people for any audience and saves nothing", async () => {
  config.agentEngine = "gemini";
  reply = { candidates: [{ name: "Ishaan Bose", title: "Captain, Debate Team", organisation: "Eastern Law College", email: "ishaan@easternlaw.com", industry: "Higher education", size: "about 1,500 students", location: "Kolkata", facts: ["Won the national moot court"], attributes: [{ key: "year", value: "second year" }] }] };
  const before = getState().prospects.length;
  const r = await dev.devSearch({ audience: "Student leaders at law colleges", count: 3 });
  assert.equal(r.real, false);
  assert.equal(r.candidates.length, 1);
  assert.ok(r.candidates[0].email.endsWith(".example"));
  assert.equal(getState().prospects.length, before, "nothing was saved");
  await assert.rejects(() => dev.devSearch({ audience: " " }), /Describe who/);
  config.agentEngine = "rule";
});

test("real-data tests: enter people with the answer you expect, and see how often the ICP agent agrees", async () => {
  await dev.addDevTest({ name: "Good Fit", organisation: "Acme Cloud", title: "CTO", size: "120 employees", expected: "Qualified", notes: "Hiring platform engineers" });
  await dev.addDevTest({ name: "Wrong Role", organisation: "Acme Cloud", title: "Marketing Manager", size: "120 employees", expected: "Rejected" });
  await dev.addDevTest({ name: "Tiny Shop", organisation: "TinyApp", title: "CTO", size: "3 employees", expected: "Rejected" });
  await assert.rejects(() => dev.addDevTest({ name: "x" }), (e) => Boolean(e.fields && e.fields.organisation && e.fields.expected));

  const run = await dev.runDevTests("c_us_saas");
  assert.equal(run.total, 3);
  assert.ok(run.results.every((r) => r.got && !r.error));
  assert.ok(run.accuracy >= 2 / 3, `agreed on ${run.correct} of ${run.total}`);
  await assert.rejects(() => dev.runDevTests("no-such-campaign"), /Choose a campaign/);
  for (const t of dev.listDevTests()) await dev.removeDevTest(t.id);
  assert.equal(dev.listDevTests().length, 0);
});

test("the runtime view says what is in force", () => {
  const r = dev.getRuntime();
  assert.ok(r.engines && r.clock.note && r.meetings.timezone === "Asia/Kolkata");
  assert.equal(typeof r.llm.dailyCap, "number");
});
