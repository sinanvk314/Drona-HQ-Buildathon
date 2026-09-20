// Prompt isolation: a change to one campaign's prompts never changes another's, and shared-library edits never
// silently change a running campaign. Runs against the real service layer on a throwaway data file.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `prompts-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-prompts-${process.pid}.json`);
delete process.env.DATABASE_URL;
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
const { composePrompt } = await import("../src/services/prompts.js");
await initDb();

const s = () => getState();
const campaign = (id) => s().campaigns.find((c) => c.id === id);
const agent = (id) => s().agents.find((a) => a.id === id);
const promptFor = (agentId, campaignId) => composePrompt(agent(agentId), campaign(campaignId));

test("every campaign starts pinned to the active library versions and has its own system prompt", () => {
  for (const c of s().campaigns) {
    for (const a of s().agents) {
      const active = a.versions.find((v) => v.status === "active").version;
      assert.equal(c.promptPins[a.id], active, `${c.name} / ${a.title}`);
    }
    assert.equal(c.systemPrompt.versions.length, 1);
  }
  assert.match(promptFor("icp", "c_us_saas").text, /working the "US SaaS CTO Outreach" campaign/);
});

test("saving or activating a shared library version does not change any running campaign", () => {
  const before = { saas: promptFor("icp", "c_us_saas"), bfsi: promptFor("icp", "c_india_bfsi") };
  const { version } = data.savePromptVersion("icp", "You are a completely different ICP agent.");
  assert.notEqual(version, before.saas.harness.split(" ")[0]);
  assert.deepEqual(promptFor("icp", "c_us_saas"), before.saas, "US SaaS is unchanged");
  assert.deepEqual(promptFor("icp", "c_india_bfsi"), before.bfsi, "India BFSI is unchanged");

  data.activatePromptVersion("icp", before.saas.harness.split(" ")[0]); // switch the library default back and forth
  assert.deepEqual(promptFor("icp", "c_us_saas"), before.saas);
});

test("a campaign created after a library change starts from the library's current version", () => {
  const latest = agent("icp").versions.find((v) => v.status === "active").version;
  const { id } = data.createCampaign({ name: "Brand new campaign" }, { launch: false });
  assert.equal(campaign(id).promptPins.icp, latest);
});

test("moving one campaign to another version changes only that campaign, and is recorded", () => {
  const versions = agent("icp").versions.map((v) => v.version);
  const other = versions.find((v) => v !== campaign("c_us_saas").promptPins.icp);
  const bfsiBefore = promptFor("icp", "c_india_bfsi");
  const logBefore = campaign("c_us_saas").promptLog.length;

  data.setCampaignPin("c_us_saas", "icp", other);
  assert.equal(promptFor("icp", "c_us_saas").harness.split(" ")[0], other);
  assert.deepEqual(promptFor("icp", "c_india_bfsi"), bfsiBefore, "another campaign did not move");
  assert.equal(campaign("c_us_saas").promptLog.length, logBefore + 1);
  assert.match(campaign("c_us_saas").promptLog[0].text, new RegExp(`→ ${other.replace(".", "\\.")}`));
  assert.throws(() => data.setCampaignPin("c_us_saas", "icp", "v99.9"), /Version not found/);
});

test("the campaign system prompt is versioned per campaign and can be rolled back", () => {
  const other = promptFor("icp", "c_ai_founders").text;
  const original = campaign("c_us_saas").systemPrompt.versions[0].text;

  const { version } = data.saveCampaignSystemPrompt("c_us_saas", "Only ever mention cloud cost, never security.");
  assert.equal(version, 2);
  assert.match(promptFor("icp", "c_us_saas").text, /Only ever mention cloud cost/);
  assert.match(promptFor("icp", "c_us_saas").harness, /campaign prompt v2/);
  assert.equal(promptFor("icp", "c_ai_founders").text, other, "another campaign is unchanged");
  assert.throws(() => data.saveCampaignSystemPrompt("c_us_saas", "   "), /cannot be empty/);

  data.activateCampaignSystemPrompt("c_us_saas", 1); // roll back
  assert.equal(campaign("c_us_saas").systemPrompt.active, 1);
  assert.equal(campaign("c_us_saas").systemPrompt.versions.length, 2, "nothing is deleted by a roll-back");
  assert.match(promptFor("icp", "c_us_saas").text, new RegExp(original.slice(0, 30)));
  assert.match(promptFor("icp", "c_us_saas").harness, /campaign prompt v1/);
});

test("an override belongs to one campaign and can be removed", () => {
  data.setCampaignOverride("c_ai_founders", "icp", "Be extra strict about company size.");
  assert.equal(promptFor("icp", "c_ai_founders").override, "Be extra strict about company size.");
  assert.equal(promptFor("icp", "c_us_saas").override, null);
  data.setCampaignOverride("c_ai_founders", "icp", "");
  assert.equal(promptFor("icp", "c_ai_founders").override, null);
});

test("a duplicate starts with the same prompts and then diverges independently", () => {
  data.saveCampaignSystemPrompt("c_ai_founders", "Founders variant A prompt.");
  const { id } = data.duplicateCampaign("c_ai_founders");
  assert.deepEqual(campaign(id).promptPins, campaign("c_ai_founders").promptPins);
  assert.match(promptFor("icp", id).text, /Founders variant A prompt/);

  data.saveCampaignSystemPrompt(id, "Founders variant B prompt.");
  assert.match(promptFor("icp", id).text, /variant B/);
  assert.match(promptFor("icp", "c_ai_founders").text, /variant A/, "the original is unchanged");
});

test("the campaign page gets everything it needs to manage prompts", () => {
  const view = data.getCampaign("c_us_saas").prompts;
  assert.ok(view.system.versions.length >= 2 && view.system.active === 1);
  assert.equal(view.agents.length, s().agents.length);
  assert.ok(view.agents.every((a) => a.pinned && a.latest && a.versions.length >= 1));
  assert.ok(view.log.length >= 1 && view.log[0].by);
  assert.ok(data.getAgent("icp").campaignPins.length >= 3, "the agent page shows which campaigns use which version");
});

test("an archived campaign's prompts cannot be edited", () => {
  data.archiveCampaign("c_india_bfsi");
  assert.throws(() => data.saveCampaignSystemPrompt("c_india_bfsi", "x y z"), /archived/);
});
