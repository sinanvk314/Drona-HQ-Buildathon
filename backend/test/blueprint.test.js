// The SDR as one thing: a shared dossier every agent reads and writes, and a blueprint that is the pipeline that runs.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `blueprint-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-blueprint-${process.pid}.json`);
process.env.AGENT_ENGINE = "rule";
process.env.EMBEDDINGS = "off";
process.env.SIM_MS_PER_HOUR = "3600000";
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const { tick } = await import("../src/services/scheduler.js");
const { addFact, addNote, dossierFor, ensureDossier } = await import("../src/services/dossier.js");
const { composePrompt } = await import("../src/services/prompts.js");
const { SDR_STEPS } = await import("../src/services/sdrSteps.js");
await initDb();

config.simReplyChance = 0;
config.enforceLimits = false;
config.schedulerBatchSize = 50;

test("the dossier keeps facts with their source, drops duplicates, and hands everything to the next agent", () => {
  const p = { qual: { status: "Qualified", agent: "ICP Fitment Agent", harness: "v3.2", reasoning: "Good fit." }, history: [{ text: "Opening email sent" }] };
  assert.equal(addFact(p, { text: "Leads the robotics club", source: "entered by a person", kind: "profile" }), true);
  assert.equal(addFact(p, { text: "leads the robotics club", source: "again" }), false, "the same fact is stored once");
  addNote(p, { agent: "Outreach Strategy Agent", harness: "v1.0", note: "Plan email then linkedin." });

  const entries = dossierFor(p);
  const text = JSON.stringify(entries);
  assert.match(text, /Good fit/);
  assert.match(text, /profile: Leads the robotics club/);
  assert.match(text, /Plan email then linkedin/);
  assert.match(text, /Opening email sent/);

  for (let i = 0; i < 60; i++) addNote(p, { agent: "x", note: `note ${i}` });
  assert.equal(ensureDossier(p).notes.length, 40, "notes are capped so the dossier stays a size an agent can read");
});

test("as a prospect moves through the SDR, each step leaves a hand-off note in the same dossier", async () => {
  for (let i = 0; i < 6; i++) await tick();
  const withNotes = getState().prospects.filter((p) => p.id.startsWith("p_gen") && p.dossier && p.dossier.notes.some((n) => /Outreach Strategy/.test(n.agent)));
  assert.ok(withNotes.length >= 1, "at least one generated prospect went through strategy");
  const p = withNotes[0];
  const agents = p.dossier.notes.map((n) => n.agent);
  assert.ok(agents.includes("ICP Fitment Agent"), "the ICP agent left a note");
  assert.ok(agents.indexOf("ICP Fitment Agent") < agents.indexOf("Outreach Strategy Agent"), "in the order the SDR works");
  assert.match(JSON.stringify(dossierFor(p)), /Qualified at \d+\/100/, "the next agent is given the earlier agent's note");
});

test("the blueprint is the pipeline that runs, with each step's pinned prompt and its decisions", () => {
  const b = data.getBlueprint("c_us_saas");
  assert.deepEqual(b.steps.map((s) => s.key), SDR_STEPS.map((s) => s.key));
  assert.ok(b.steps.every((s) => s.purpose && s.reads.length && s.writes.length && s.pinned));
  assert.ok(b.mission.offer && b.mission.objective && b.mission.brief, "mission, offer and brief are part of the definition");
  assert.ok(b.steps.find((s) => s.key === "icp").decisions >= 0);
  assert.ok(b.policies.some((p) => p.label === "Approvals"));
  assert.ok(b.tools.some((t) => /Knowledge/.test(t.name)));
  assert.ok(b.memory.description);
});

test("pausing an agent in a campaign shows in the blueprint, and the persona changes what every agent is given", () => {
  data.setCampaignAgentEnabled("c_us_saas", "followup", false);
  assert.equal(data.getBlueprint("c_us_saas").steps.find((s) => s.key === "followup").enabled, false);
  assert.equal(data.getBlueprint("c_ai_founders").steps.find((s) => s.key === "followup").enabled, true, "another campaign is unaffected");

  data.setCampaignPersona("c_us_saas", { tone: "warm and brief, peer to peer", signOff: "The SDR team" });
  const agent = getState().agents.find((a) => a.id === "personalisation");
  const prompt = composePrompt(agent, getState().campaigns.find((c) => c.id === "c_us_saas")).text;
  assert.match(prompt, /Voice: write warm and brief, peer to peer; the sign-off "The SDR team" is added automatically, so do not write one./);
  assert.doesNotMatch(composePrompt(agent, getState().campaigns.find((c) => c.id === "c_ai_founders")).text, /Voice:/);
  assert.match(data.getCampaign("c_us_saas").prompts.log[0].text, /Persona: warm and brief/, "a persona change is in the campaign's prompt history");
});
