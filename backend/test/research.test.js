// The Research agent (works only from what is known), and sourcing through the imitated people search.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `research-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-research-${process.pid}.json`);
process.env.EMBEDDINGS = "off";
process.env.SIM_MS_PER_HOUR = "3600000";
delete process.env.DATABASE_URL;
const { config } = await import("../src/config.js");
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const engine = await import("../src/services/agentEngine/index.js");
const { ruleResearch } = await import("../src/services/agentEngine/ruleEngine.js");
const { tick } = await import("../src/services/scheduler.js");
const { newProspect } = await import("../src/services/prospects.js");
await initDb();

let server, reply, status;
before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(typeof reply === "function" ? reply(JSON.parse(raw)) : reply) }] }, finishReason: "STOP" }] } : { error: { message: "boom" } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  config.gemini.baseUrl = `http://127.0.0.1:${server.address().port}/v1beta`;
  config.gemini.apiKey = "test-key";
  config.gemini.rpm = 600000;
  config.gemini.model = "test-model";
  config.gemini.retries = 0;
  config.simReplyChance = 0;
  config.enforceLimits = false;
  config.schedulerBatchSize = 50;
});
after(() => server.close());

const state = () => getState();
const campaign = (id) => state().campaigns.find((c) => c.id === id);
const agent = (id) => state().agents.find((a) => a.id === id);

const student = () =>
  newProspect(campaign("c_ai_founders"), { name: "Meera Iyer", title: "President, Robotics Club", company: "Coastal Institute of Technology", size: "about 4,000 students", city: "Chennai", attributes: { college: "Coastal Institute of Technology", year: "third year" } }, { provider: "entered by a person", real: true });

test("the rule research restates only what is known, and lists what is not", () => {
  const p = student();
  p.dossier.facts.push({ text: "Organised the annual robotics showcase", source: "entered by a person", kind: "profile", ts: 1 });
  const r = ruleResearch({ campaign: campaign("c_ai_founders"), prospect: p });
  const all = JSON.stringify(r.facts);
  assert.match(all, /Meera Iyer is President, Robotics Club at Coastal Institute/);
  assert.match(all, /college: Coastal Institute of Technology/);
  assert.ok(r.hooks.some((h) => /robotics showcase/.test(h)), "a hook is grounded in an entered fact");
  assert.ok(r.gaps.some((g) => /confirmed contact address/.test(g)), "a made-up address is flagged as unconfirmed");
  assert.ok(r.gaps.some((g) => /decides/.test(g)));
});

test("a research fact whose figures are not in the prospect's own data is dropped, never stored", async () => {
  status = 200;
  reply = {
    summary: "Meera leads the robotics club.", confidence: "medium", reasoning: "r", hooks: ["She organises events"], gaps: ["Budget"],
    facts: [{ text: "Meera is President, Robotics Club", kind: "profile" }, { text: "The club grew membership by 300% last year", kind: "signal" }],
  };
  config.agentEngine = "gemini";
  const r = await engine.researchProspect({ campaign: campaign("c_ai_founders"), prospect: student(), researchAgent: agent("research") });
  assert.equal(r.engine, "gemini");
  assert.deepEqual(r.facts.map((f) => f.text), ["Meera is President, Robotics Club"]);
  assert.equal(r.dropped, 1);
});

test("the imitated search returns fictional people on the reserved .example domain, for any audience", async () => {
  status = 200;
  let seen;
  reply = (body) => {
    seen = JSON.parse(body.contents[0].parts[0].text);
    return {
      candidates: [
        { name: "Aarav Menon", title: "Secretary, Debate Society", organisation: "Southern Arts College", email: "aarav@southernarts.com", industry: "Higher education", size: "about 2,000 students", location: "Coimbatore", facts: ["Runs the inter-college debate league"], attributes: [{ key: "college", value: "Southern Arts College" }] },
        { name: "Existing Person", title: "x", organisation: "y", email: "e@y.example", industry: "z", size: "s", location: "l", facts: [] },
        { name: "Diya Nair", title: "Chair, Entrepreneurship Cell", organisation: "Harbour University", email: "diya.nair@harbouruniversity.example", industry: "Higher education", size: "about 9,000 students", location: "Kochi", facts: ["Founded a campus start-up fair", "Speaks at hackathons"], attributes: [] },
      ],
    };
  };
  config.agentEngine = "gemini";
  const c = { ...campaign("c_us_saas"), icpText: "Student leaders at colleges", personas: ["Club president"] };
  const found = await engine.sourceProspects({ campaign: c, count: 3, avoid: ["Existing Person"], leadAgent: agent("lead") });
  assert.equal(seen.avoid[0], "Existing Person", "names already found are passed so they are not repeated");
  assert.deepEqual(found.candidates.map((x) => x.name), ["Aarav Menon", "Diya Nair"], "an already-found name is dropped");
  assert.ok(found.candidates.every((x) => x.email.endsWith(".example")), "no address can belong to a real person");
  assert.equal(found.candidates[0].email, "aarav.menon@southernartscollege.example");
  assert.equal(found.candidates[0].attributes.college, "Southern Arts College");
});

test("a campaign on the imitated search gets fictional prospects, labelled as such, that go through research with facts in the dossier", async () => {
  status = 200;
  config.agentEngine = "gemini";
  reply = (body) => {
    const p = body.systemInstruction.parts[0].text;
    if (/people-search tool/.test(p)) {
      return { candidates: [{ name: "Kavya Rao", title: "Vice President, Tech Club", organisation: "Lakeside Engineering College", email: "kavya@lakeside.example", industry: "Higher education", size: "about 3,000 students", location: "Pune", facts: ["Leads a 60-member tech club"], attributes: [{ key: "year", value: "final year" }] }] };
    }
    return { summary: "Kavya leads a tech club.", confidence: "medium", reasoning: "r", hooks: ["Leads a 60-member tech club"], gaps: ["Budget"], facts: [{ text: "Leads a 60-member tech club", kind: "profile" }] };
  };
  const c = campaign("c_ai_founders");
  c.sourcing = "simulated-search";
  c.lastSourcedAt = 0;
  await tick();
  const found = state().prospects.find((p) => p.name === "Kavya Rao");
  assert.ok(found, "the searched person was added");
  assert.equal(found.source.real, false);
  assert.match(found.source.provider, /imitated search/);
  assert.ok(found.research && found.research.summary, "research ran in the same tick");
  assert.notEqual(found.stage, "discovered", "and the prospect moved on to ICP scoring");
  assert.ok(found.dossier.facts.some((f) => /60-member tech club/.test(f.text)));
  assert.ok(found.dossier.notes.some((n) => n.agent === "Research Agent"));
  assert.ok(state().decisions.some((d) => d.agent === "Research Agent" && d.prospectId === found.id));
  assert.ok(state().decisions.some((d) => /Found 1 person/.test(d.headline) && d.agent === "Lead Research Agent"));
  c.sourcing = "synthetic";
});

test("when the AI search fails, the campaign waits and reports it instead of inventing people from name lists", async () => {
  status = 500;
  config.agentEngine = "gemini";
  const c = campaign("c_ai_founders");
  c.sourcing = "simulated-search";
  c.lastSourcedAt = 0;
  const failuresBefore = (c.failures && c.failures.total) || 0;
  const before = state().prospects.filter((p) => p.campaignId === c.id).length;
  await tick();
  assert.equal(state().prospects.filter((p) => p.campaignId === c.id).length, before, "nobody was invented");
  assert.ok(c.failures.total > failuresBefore, "the failure is visible");
  c.sourcing = "synthetic";
});

test("a single-target campaign never searches, and its named person qualifies without scoring", async () => {
  status = 500; // even with the model down, nothing here needs it
  config.agentEngine = "rule";
  const c = campaign("c_us_saas");
  c.mode = "single";
  const p = newProspect(c, { name: "Prof. Sundar Raman", title: "Faculty Advisor", company: "Coastal Institute of Technology" }, { provider: "entered by a person", real: true });
  state().prospects.push(p);
  const others = state().prospects.filter((x) => x.campaignId === c.id).length;
  await tick();
  assert.equal(state().prospects.filter((x) => x.campaignId === c.id).length, others, "no new people were searched for");
  assert.equal(p.stage, "qualified");
  assert.equal(p.fit, 100);
  assert.match(p.qual.reasoning, /Named target/);
  c.mode = "bulk";
});
