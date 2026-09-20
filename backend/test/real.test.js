// Real data and real sending, against fake Gmail and Twilio servers: nothing here touches the internet.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "crypto";
import os from "os";
import path from "path";
import express from "express";

process.env.DATA_FILE = path.join(os.tmpdir(), `real-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-real-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.EMBEDDINGS = "off";
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const contacts = await import("../src/services/contacts.js");
const { tickCampaign, processReply } = await import("../src/services/scheduler.js");
const { validSignature } = await import("../src/services/channels/twilio.js");
const { buildMime, stripQuoted, resetGmailTokenCache } = await import("../src/services/channels/gmail.js");
const voice = await import("../src/services/channels/voice.js");
const { webhooks } = await import("../src/routes/webhooks.js");
await initDb();

config.enforceLimits = false;
config.simReplyChance = 1; // if a simulated reply were ever generated for a real person, it would show up at once

// ---- fake Gmail + Twilio
const gmail = { sent: [], threadMessages: [] };
const twilio = { calls: [], texts: [] };
let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url === "/token") return json({ access_token: "tok", expires_in: 3600 });
      if (req.url === "/gmail/users/me/profile") return json({ emailAddress: "sdr@gmail.example.com", messagesTotal: 10 });
      if (req.url === "/gmail/users/me/messages/send") { const b = JSON.parse(raw); gmail.sent.push(b); return json({ id: `m${gmail.sent.length}`, threadId: b.threadId || `t${gmail.sent.length}` }); }
      if (req.url.startsWith("/gmail/users/me/threads/")) return json({ messages: gmail.threadMessages });
      if (req.url.endsWith("/Messages.json")) { twilio.texts.push(Object.fromEntries(new URLSearchParams(raw))); return json({ sid: "SM1" }, 201); }
      if (req.url.endsWith("/Calls.json")) { twilio.calls.push(Object.fromEntries(new URLSearchParams(raw))); return json({ sid: "CA1" }, 201); }
      json({ message: "unknown" }, 404);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(config, { realSending: true, realAutoSend: false, realAllowlist: [], publicUrl: "https://sdr.test" });
  Object.assign(config.gmail, { clientId: "id", clientSecret: "sec", refreshToken: "ref", sender: "sdr@gmail.example.com", apiBase: `${base}/gmail`, tokenUrl: `${base}/token`, pollMs: 0 });
  Object.assign(config.twilio, { accountSid: "AC1", authToken: "secret", smsFrom: "+15550001111", voiceFrom: "+15550001111", apiBase: `${base}/twilio` });
  resetGmailTokenCache();
});
after(() => server.close());

const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timed out"); };
const encode = (t) => Buffer.from(t, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const decodeRaw = (raw) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const realCampaign = (extra = {}) => {
  const { id } = data.createCampaign(
    {
      name: `Real ${Math.random()}`, description: "d", owner: "t", objective: "Book an intro call", offer: "A free workshop series on running student clubs.", mode: "single", sourcing: "real",
      target: { name: "Anita Rao", title: "Faculty Advisor", organisation: "IIT Madras", email: "anita@iitm.ac.in", phone: "+91 98765 43210", notes: "Advises the Tech Contingent" },
      channels: ["email"], dailyLimit: 100, workingHours: "12:00 AM – 11:59 PM", cadence: { maxTouches: 2, waitHours: 24 }, approvals: { firstOutreach: true, meetingTime: false, escalate: true, level: "manual" }, sources: [], ...extra,
    },
    { launch: true }
  );
  data.setCampaignReps(id, ["r_jd"]);
  return getState().campaigns.find((c) => c.id === id);
};
const prospectOf = (c) => getState().prospects.find((p) => p.campaignId === c.id);

test("real contacts need a real address or number, and made-up addresses are refused", async () => {
  await assert.rejects(() => contacts.addContact({ name: "Bad", email: "bad@x.example" }), (e) => /made-up/.test(e.fields.email));
  await assert.rejects(() => contacts.addContact({ name: "" }), (e) => Boolean(e.fields.name && e.fields.email));
  await assert.rejects(() => contacts.addContact({ name: "N", phone: "12" }), (e) => Boolean(e.fields.phone));
  const c = await contacts.addContact({ name: "Dr. Meera Nair", title: "Director", organisation: "Cochin Startup Hub", email: "Meera@Hub.in", phone: "+91 90000 11111", notes: "Runs a startup accelerator\nHosts a yearly demo day" });
  assert.equal(c.email, "meera@hub.in");
  assert.equal(c.phone, "+919000011111");
  await assert.rejects(() => contacts.addContact({ name: "Dup", email: "meera@hub.in" }), (e) => /already/.test(e.fields.email));
});

test("a real campaign draws prospects only from the real contacts, ranked by fit, and never gets a simulated reply", async () => {
  await contacts.addContact({ name: "Rohan Das", title: "Chef", organisation: "Tiffin Co", email: "rohan@tiffin.in", notes: "Runs a food truck" });
  const before = getState().prospects.length;
  const { id } = data.createCampaign(
    { name: "Startup hub outreach", description: "d", owner: "t", objective: "Book a call", offer: "An accelerator partnership.", icpText: "Directors of startup accelerators and hubs", geography: ["India"], personas: ["Director"], channels: ["email"], sourcing: "real", qualificationPrompt: "Qualify accelerator directors.", dailyLimit: 50, workingHours: "9:00 AM – 6:00 PM", approvals: { firstOutreach: true, meetingTime: false, escalate: true, level: "manual" }, sources: [] },
    { launch: true }
  );
  const c = getState().campaigns.find((x) => x.id === id);
  data.setCampaignReps(id, ["r_jd"]);
  await tickCampaign(c);
  const mine = getState().prospects.filter((p) => p.campaignId === id);
  assert.ok(mine.length >= 1 && getState().prospects.length > before);
  assert.equal(mine[0].name, "Dr. Meera Nair", "the best match comes first");
  assert.ok(mine.every((p) => p.source.real === true && p.contactId));
  assert.ok(mine.every((p) => !/\.example$/.test(p.email)));
  for (let i = 0; i < 3; i++) await tickCampaign(c);
  assert.ok(mine.every((p) => p.conversation.every((m) => m.dir === "out")), "no invented replies for real people");
  data.completeCampaign(id);
});

test("a real message waits for a human, and approving it sends a real email in a thread, with an opt-out line", async () => {
  const c = realCampaign();
  await tickCampaign(c);
  await tickCampaign(c);
  const p = prospectOf(c);
  assert.equal(p.touches.length, 0, "nothing goes out on its own");
  const pending = getState().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  assert.ok(pending, "the draft is in the approvals queue");
  assert.equal(gmail.sent.length, 0);

  data.decideApproval(pending.id, { action: "approve" });
  await waitFor(() => p.touches[0] && p.touches[0].delivery && p.touches[0].delivery.status !== "sending");
  assert.equal(p.touches[0].delivery.status, "sent");
  assert.equal(p.touches[0].delivery.provider, "gmail");
  assert.equal(gmail.sent.length, 1);
  const mime = decodeRaw(gmail.sent[0].raw);
  assert.match(mime, /To: anita@iitm\.ac\.in/);
  assert.match(mime, /From: JD <sdr@gmail\.example\.com>/);
  const body = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(body, /unsubscribe/i);
  assert.equal(p.emailThread, "t1");
});

test("a real reply in the Gmail thread is read and answered, and the answer goes out in the same thread", async () => {
  const c = getState().campaigns.find((x) => x.sourcing === "real" && x.mode === "single" && x.status === "live");
  const p = prospectOf(c);
  gmail.threadMessages = [
    { id: "m1", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "JD <sdr@gmail.example.com>" }], mimeType: "text/plain", body: { data: encode("hello") } } },
    { id: "r1", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Anita Rao <anita@iitm.ac.in>" }, { name: "Message-ID", value: "<abc@mail>" }], mimeType: "text/plain", body: { data: encode("This sounds interesting, could we set up a call?\n\nOn Mon, JD wrote:\n> hello") } } },
  ];
  await tickCampaign(c);
  assert.equal(p.conversation.filter((m) => m.dir === "in").length, 1);
  assert.equal(p.conversation.find((m) => m.dir === "in").text, "This sounds interesting, could we set up a call?");
  assert.equal(p.meeting && p.meeting.status, "pending-approval", "the reply was handled, and the times wait for a human because this is a real person");
  await tickCampaign(c);
  assert.equal(p.conversation.filter((m) => m.dir === "in").length, 1, "the same message is not handled twice");
  assert.deepEqual(p.seenMessageIds.filter((x) => x === "r1"), ["r1"]);
});

test("a simulated campaign never sends anything for real, and neither does a sandbox", async () => {
  const sentBefore = gmail.sent.length;
  const c = getState().campaigns.find((x) => x.sourcing !== "real" && x.status === "live" && !x.sandbox);
  assert.ok(c, "a simulated campaign exists");
  await tickCampaign(c);
  assert.equal(gmail.sent.length, sentBefore);
  const dev = await import("../src/services/dev.js");
  const box = dev.createSandbox({ objective: "Book a call", offer: "A workshop.", target: { name: "Test Person", organisation: "Uni", email: "test@uni.edu" } });
  await dev.runSandbox(box.id);
  assert.equal(gmail.sent.length, sentBefore, "a sandbox has real details but must not send");
});

test("with real sending off, or an address on no allow-list, approval is refused instead of pretending to send", async () => {
  const c = realCampaign({ name: `Guarded ${Math.random()}`, target: { name: "Guard Person", title: "Dean", organisation: "College", email: "dean@college.edu", notes: "Runs the alumni network" } });
  await tickCampaign(c);
  await tickCampaign(c);
  const p = prospectOf(c);
  const pending = getState().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  config.realAllowlist = ["someone.else@x.com"];
  assert.throws(() => data.decideApproval(pending.id, { action: "approve" }), /allow-list|ALLOWLIST/i);
  config.realAllowlist = [];
  config.realSending = false;
  assert.throws(() => data.decideApproval(pending.id, { action: "approve" }), /REAL_SENDING/);
  config.realSending = true;
});

test("the launch review blocks a real campaign that cannot send anywhere", () => {
  config.realSending = false;
  const c = realCampaign({ name: `Blocked ${Math.random()}`, target: { name: "Blocked Person", organisation: "Org", email: "b@org.in" } });
  const review = data.getLaunchReview(c.id);
  config.realSending = true;
  assert.ok(review.checks.some((x) => x.key === "real" && x.status === "block"));
});

test("Twilio webhooks must be signed, and a signed text from a real person is handled as their reply", async () => {
  const c = realCampaign({ name: `Texts ${Math.random()}`, channels: ["sms"], target: { name: "Sam Text", title: "Lead", organisation: "Club", phone: "+91 91234 56789", notes: "Leads a club" } });
  const p = prospectOf(c);
  p.stage = "contacted";
  p.touches.push({ n: 1, channel: "sms", kind: "first", ts: Date.now() });
  p.conversation.push({ dir: "out", text: "Hi", when: "Today", channel: "sms" });
  const app = express();
  app.use("/webhooks", webhooks);
  const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const port = srv.address().port;
  const params = { From: "+919123456789", Body: "Not interested, please stop" };
  const url = "https://sdr.test/webhooks/twilio/sms";
  const sig = crypto.createHmac("sha1", "secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
  assert.ok(validSignature(url, params, sig));

  const post = (signature) => fetch(`http://127.0.0.1:${port}/webhooks/twilio/sms`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(signature ? { "x-twilio-signature": signature } : {}) }, body: new URLSearchParams(params) });
  assert.equal((await post(null)).status, 403);
  assert.equal((await post("forged")).status, 403);
  assert.equal(p.conversation.filter((m) => m.dir === "in").length, 0);
  try {
    assert.equal((await post(sig)).status, 200);
    assert.equal(p.conversation.filter((m) => m.dir === "in").length, 1);
  } finally {
    srv.close();
  }
});

test("a voice call is placed for a real campaign, follows the person's answers turn by turn, and records the outcome", async () => {
  const c = realCampaign({ name: `Calls ${Math.random()}`, channels: ["voice"], target: { name: "Vic Caller", title: "Founder", organisation: "Startup", phone: "+91 92222 33333", notes: "Founded a startup" } });
  const p = prospectOf(c);
  p.stage = "contacted";
  p.touches.push({ n: 1, channel: "voice", kind: "first", ts: Date.now(), repName: "JD" });
  const state = getState();
  await voice.startCall(state, c, p);
  assert.equal(twilio.calls.at(-1).To, "+919222233333");
  assert.match(twilio.calls.at(-1).Url, /webhooks\/twilio\/voice\?p=/);

  assert.match(voice.voiceStart(p.id), /<Gather[^>]*input="speech"/);
  const next = await voice.voiceTurn(p.id, "Yes, sure, tell me more");
  assert.match(next, /<Hangup\/>/, "a clear yes ends the call politely");
  assert.equal(p.voice.outcome, "interested");
  await voice.voiceEnd(p.id);
  assert.ok(p.conversation.some((m) => m.channel === "voice" && m.dir === "in" && /tell me more/.test(m.text)));
  assert.ok(getState().approvals.some((a) => a.prospectId === p.id && a.status === "pending" && /call/i.test(a.tag)), "a human is asked to book the meeting");

  const c2 = realCampaign({ name: `Calls2 ${Math.random()}`, channels: ["voice"], target: { name: "Opt Out", title: "X", organisation: "Y", phone: "+91 93333 44444", notes: "n" } });
  const p2 = prospectOf(c2);
  p2.touches.push({ n: 1, channel: "voice", kind: "first", ts: Date.now() });
  await voice.startCall(getState(), c2, p2);
  await voice.voiceTurn(p2.id, "Please do not call me again");
  await voice.voiceEnd(p2.id);
  assert.equal(p2.stage, "rejected");
  assert.ok(getState().suppression.some((x) => x.contact === "+919333344444"));
});

test("MIME building and reply trimming", () => {
  const raw = buildMime({ to: "a@b.in", fromName: "Zoë", fromAddress: "me@gmail.com", subject: "Héllo", body: "Line one\nLine two", attachments: [{ name: "meeting.ics", type: "text/calendar", content: "BEGIN:VCALENDAR" }] });
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /multipart\/mixed/);
  assert.match(raw, /filename="meeting\.ics"/);
  assert.equal(stripQuoted("Yes please.\n\nOn Tue, Sam wrote:\n> old text"), "Yes please.");
});

test("an audience of individuals (public figures) needs no organisation, and every address stays a made-up .example one", async () => {
  const { normalizeCandidates, sourceSystemFor } = await import("../src/services/agentEngine/geminiEngine.js");
  const out = normalizeCandidates({ candidates: [{ name: "Some Famous Author", title: "Author", organisation: "", email: "real@gmail.com", facts: ["Wrote a bestselling book"] }] }, { count: 3, individuals: true });
  assert.equal(out[0].company, "Independent");
  assert.match(out[0].email, /\.example$/);
  assert.throws(() => normalizeCandidates({ candidates: [{ name: "No Org", title: "x" }] }, { count: 3 }), /no usable candidates/);
  assert.match(sourceSystemFor({ audienceKind: "individuals" }), /well-known public figures/);
  assert.match(sourceSystemFor({ audienceKind: "organisations" }), /must be FICTIONAL/);
});

// ---------------------------------------------------------------- the email bugs found by using it
const approveFirst = async (c) => {
  await tickCampaign(c);
  await tickCampaign(c);
  const p = prospectOf(c);
  const pending = getState().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  data.decideApproval(pending.id, { action: "approve" });
  await waitFor(() => p.touches[0] && p.touches[0].delivery && p.touches[0].delivery.status !== "sending");
  return p;
};
const human = (id, text, from) => ({ id, internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: from }, { name: "Message-ID", value: `<${id}@mail>` }], mimeType: "text/plain", body: { data: encode(text) } } });

test("an opening email reads like a professional email: greeting, reasons, the offer, one ask, and a signature added once", async () => {
  const c = realCampaign({ name: `Pro ${Math.random()}`, target: { name: "Prof. Kavita Iyer", title: "Dean of Students", organisation: "NIT Trichy", email: "kavita@nitt.edu", notes: "Leads the student innovation council" } });
  const p = await approveFirst(c);
  const mime = decodeRaw(gmail.sent.at(-1).raw);
  const body = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(body, /^Hello Prof\. Iyer,/);
  assert.ok(body.split(/\s+/).length >= 60, `long enough to be a real email (${body.split(/\s+/).length} words)`);
  assert.match(body, /short conversation/);
  assert.equal((body.match(/Best regards,/g) || []).length, 1, "one sign-off");
  assert.match(body, /Best regards,\nJD/);
  assert.match(mime, /List-Unsubscribe: <mailto:/);
  assert.match(mime, /Subject: A note for Prof\. Iyer at NIT Trichy/);
  assert.equal(p.touches[0].delivery.status, "sent");
});

test("BUG: a reply from the same Gmail account that sends (a test on yourself) is retrieved, not thrown away as our own message", async () => {
  const me = "sdr@gmail.example.com";
  const c = realCampaign({ name: `Self ${Math.random()}`, target: { name: "Test Myself", title: "Founder", organisation: "Me Inc", email: me, notes: "Testing the SDR" } });
  const p = await approveFirst(c);
  const ourId = p.seenMessageIds[0];
  gmail.threadMessages = [
    human(ourId, "our opening email", `JD <${me}>`),
    human("mine1", "Yes, this looks interesting. Can we talk?\n\nOn Tue, 22 Sep 2026 at 09:15, JD <sdr@gmail.example.com>\nwrote:\n> our opening email", `Test Myself <${me}>`),
  ];
  await tickCampaign(c);
  assert.equal(p.conversation.filter((m) => m.dir === "in").length, 1, "the reply was read");
  assert.equal(p.conversation.find((m) => m.dir === "in").text, "Yes, this looks interesting. Can we talk?", "the quoted email and its wrapped 'On ... wrote:' line are cut");
  await tickCampaign(c);
  assert.equal(p.conversation.filter((m) => m.dir === "in").length, 1, "and only once");
});

test("a reply that is only HTML is still read", async () => {
  const c = realCampaign({ name: `Html ${Math.random()}`, target: { name: "Html Person", title: "Lead", organisation: "Org", email: "html@org.in", notes: "n" } });
  const p = await approveFirst(c);
  gmail.threadMessages = [
    human(p.seenMessageIds[0], "ours", "JD <sdr@gmail.example.com>"),
    { id: "h1", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Html Person <html@org.in>" }], mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: encode("<div>Sounds <b>good</b>, please send times.</div><div class=\"gmail_quote\">quoted</div>") } }] } },
  ];
  await tickCampaign(c);
  assert.match(p.conversation.find((m) => m.dir === "in").text, /^Sounds good, please send times\./);
});

test("a bounce marks the address as not working and stops; an out-of-office is noted and never answered", async () => {
  const c = realCampaign({ name: `Bounce ${Math.random()}`, target: { name: "Bounce Person", title: "Lead", organisation: "Org", email: "nobody@org.in", notes: "n" } });
  const p = await approveFirst(c);
  gmail.threadMessages = [
    human(p.seenMessageIds[0], "ours", "JD <sdr@gmail.example.com>"),
    { id: "b1", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" }, { name: "Subject", value: "Delivery Status Notification (Failure)" }], mimeType: "text/plain", body: { data: encode("Address not found") } } },
  ];
  await tickCampaign(c);
  assert.equal(p.stage, "rejected");
  assert.match(p.nextStep, /bounced/i);
  assert.equal(p.touches[0].delivery.status, "failed");
  assert.equal(p.conversation.filter((m) => m.dir === "in").length, 0, "a bounce is not a reply");

  const c2 = realCampaign({ name: `Ooo ${Math.random()}`, target: { name: "Away Person", title: "Lead", organisation: "Org", email: "away@org.in", notes: "n" } });
  const p2 = await approveFirst(c2);
  gmail.threadMessages = [
    human(p2.seenMessageIds[0], "ours", "JD <sdr@gmail.example.com>"),
    { id: "o1", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Away Person <away@org.in>" }, { name: "Subject", value: "Automatic reply: Away" }, { name: "Auto-Submitted", value: "auto-replied" }], mimeType: "text/plain", body: { data: encode("I am out of the office until Monday.") } } },
  ];
  const before = getState().approvals.filter((a) => a.prospectId === p2.id).length;
  await tickCampaign(c2);
  assert.equal(p2.conversation.filter((m) => m.dir === "in").length, 0);
  assert.equal(getState().approvals.filter((a) => a.prospectId === p2.id).length, before, "nothing was drafted in answer");
  assert.match(p2.nextStep, /out of office/i);
});

test("the email tools: connection check, a test email that respects the allow-list, and an immediate inbox check", async () => {
  const dev = await import("../src/services/dev.js");
  const conn = await dev.testEmailConnection();
  assert.equal(conn.account, "sdr@gmail.example.com");
  assert.equal(conn.match, true);
  const sentBefore = gmail.sent.length;
  config.realAllowlist = ["only@me.in"];
  await assert.rejects(() => dev.sendTestEmail({ to: "other@x.com" }), /ALLOWLIST/);
  await assert.rejects(() => dev.sendTestEmail({ to: "not an address" }), /real email address/);
  const ok = await dev.sendTestEmail({ to: "only@me.in" });
  assert.equal(ok.ok, true);
  assert.equal(gmail.sent.length, sentBefore + 1);
  config.realAllowlist = [];
  const check = await dev.checkInboxNow();
  assert.equal(typeof check.checked, "number");
  const status = dev.getEmailStatus();
  assert.ok(status.recent.length > 0 && status.recent[0].status);
  assert.equal(status.ready, true);
});

test("BUG: approving a drafted reply to a real person actually sends it (it used to be recorded but never emailed)", async () => {
  const c = realCampaign({ name: `Reply ${Math.random()}`, target: { name: "Reply Person", title: "Lead", organisation: "Org", email: "reply@org.in", notes: "Runs a club" } });
  const p = await approveFirst(c);
  gmail.threadMessages = [
    human(p.seenMessageIds[0], "ours", "JD <sdr@gmail.example.com>"),
    human("q1", "Interesting. Can you tell me more about what the workshop covers?", "Reply Person <reply@org.in>"),
  ];
  await tickCampaign(c);
  const pending = getState().approvals.find((a) => a.prospectId === p.id && a.status === "pending");
  assert.ok(pending, "the drafted answer waits for a human");
  const sentBefore = gmail.sent.length;
  data.decideApproval(pending.id, { action: "approve" });
  await waitFor(() => gmail.sent.length > sentBefore);
  const reply = p.conversation.filter((m) => m.dir === "out").at(-1);
  await waitFor(() => reply.delivery && reply.delivery.status !== "sending");
  assert.equal(reply.delivery.status, "sent");
  assert.equal(gmail.sent.at(-1).threadId, p.emailThread, "in the same thread as the conversation");
});

test("typing a real address into a simulated campaign is flagged at launch, because nothing would be sent", () => {
  const { id } = data.createCampaign(
    { name: `Simulated with real address ${Math.random()}`, description: "d", owner: "t", objective: "Book a call", offer: "A workshop.", mode: "single", sourcing: "simulated-search", target: { name: "Real Address", organisation: "Org", email: "someone@org.in" }, channels: ["email"], dailyLimit: 10, workingHours: "9:00 AM – 6:00 PM", approvals: {}, sources: [] },
    { launch: false }
  );
  const review = data.getLaunchReview(id);
  assert.ok(review.checks.some((x) => x.key === "simulated-real" && x.status === "warn"));
});

test("the allow-list setting tolerates the slips people make: quotes, angle brackets, spaces, semicolons, capitals", async () => {
  const { parseAllowlist } = await import("../src/config.js");
  assert.deepEqual(parseAllowlist(' "Mohammed.Sinan@Gmail.com" ; <other@x.com>, \'+91 98765-43210\' '), ["mohammed.sinan@gmail.com", "other@x.com", "+919876543210"]);
  assert.deepEqual(parseAllowlist(""), []);
  assert.deepEqual(parseAllowlist(undefined), []);
});
