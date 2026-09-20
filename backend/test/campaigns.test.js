// Campaign editing and duplication, run against the real service layer on a throwaway data file.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.DATA_FILE = path.join(os.tmpdir(), `campaigns-test-${process.pid}.json`);
process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-campaigns-${process.pid}.json`);
delete process.env.DATABASE_URL;
const { initDb, getState } = await import("../src/db/index.js");
const data = await import("../src/services/data.js");
await initDb();

test("editing a live campaign changes its settings and keeps its status and metrics", () => {
  const before = data.getCampaign("c_us_saas");
  const values = { ...data.getCampaignConfig("c_us_saas"), name: "US SaaS CTO (renamed)", dailyLimit: 25 };
  data.updateCampaign("c_us_saas", values);
  const after = data.getCampaign("c_us_saas");
  assert.equal(after.name, "US SaaS CTO (renamed)");
  assert.equal(after.rawStatus, "live");
  assert.deepEqual(after.funnel, before.funnel);
  assert.equal(getState().campaigns.find((c) => c.id === "c_us_saas").dailyLimit, 25);
});

test("an edit that leaves a launched campaign incomplete is rejected and changes nothing", () => {
  const values = { ...data.getCampaignConfig("c_us_saas"), icpText: "" };
  assert.throws(() => data.updateCampaign("c_us_saas", values), (e) => Boolean(e.fields && e.fields.icpText));
  assert.notEqual(getState().campaigns.find((c) => c.id === "c_us_saas").icpText, "");
});

test("a completed campaign cannot be edited", () => {
  data.completeCampaign("c_india_bfsi");
  assert.throws(() => data.updateCampaign("c_india_bfsi", data.getCampaignConfig("c_india_bfsi")), /cannot be edited/);
});

test("duplicating makes an independent Draft with the same setup and no metrics", () => {
  const src = getState().campaigns.find((c) => c.id === "c_ai_founders");
  const { id, status } = data.duplicateCampaign("c_ai_founders");
  assert.equal(status, "draft");
  const copy = getState().campaigns.find((c) => c.id === id);
  assert.equal(copy.name, `${src.name} (copy)`);
  assert.deepEqual(copy.channels, src.channels);
  assert.deepEqual(copy.approvals, src.approvals);
  assert.equal(copy.funnel.discovered, 0);
  assert.equal(copy.sources.length, src.sources.length);
  assert.ok(copy.sources.every((x) => !src.sources.some((y) => y.id === x.id)), "copied sources get their own ids");

  // Removing a source from the copy leaves the original alone.
  data.removeCampaignSource(id, copy.sources[0].id);
  assert.equal(getState().campaigns.find((c) => c.id === "c_ai_founders").sources.length, src.sources.length);

  // The per-campaign prompt overrides come along, so the variant behaves the same until it is changed.
  const overrides = getState().agents.flatMap((a) => a.overrides);
  assert.equal(overrides.some((o) => o.campaignId === "c_ai_founders"), overrides.some((o) => o.campaignId === id));
});

test("campaigns can be compared side by side, including a copy against its original", async () => {
  const { recordLlmUsage, recordAvoided } = await import("../src/services/usage.js");
  const { id: copyId } = data.duplicateCampaign("c_us_saas");
  recordLlmUsage({ agent: "icp", campaignId: "c_us_saas", tokensIn: 1000, tokensOut: 200, ms: 500 });
  recordAvoided("icpShortcut", "c_us_saas");
  recordAvoided("icpShortcut", "c_us_saas");

  const rows = data.getComparison(["c_us_saas", copyId]);
  assert.deepEqual(rows.map((r) => r.id), ["c_us_saas", copyId]);
  const [original, copy] = rows;
  assert.equal(copy.copiedFrom, "c_us_saas");
  assert.equal(copy.status, "draft");
  assert.equal(copy.prospects, 0, "a fresh copy has no results yet");
  assert.ok(original.llmDecisions >= 1 && original.decisionsWithoutLlm >= 2);
  assert.ok(original.avoidedPct >= 50 && original.costTodayUsd > 0);
  assert.equal(copy.costTodayUsd, 0, "cost is per campaign: the copy has spent nothing");
  assert.equal(copy.costPerQualified, null, "no qualified leads yet, so no cost per lead");
  assert.equal(data.getCampaign(copyId).copiedFrom.name, original.name);
  assert.ok(data.getComparison().length >= 3, "with no ids, every non-archived campaign is compared");
});

test("the launch review says what a manager needs to know before activating, and blocks what cannot launch", async () => {
  const { id } = data.createCampaign({ name: "Review me" }, { launch: false }); // a Draft with only a name
  const draft = data.getLaunchReview(id);
  assert.equal(draft.ready, false);
  assert.equal(draft.checks.find((k) => k.key === "config").status, "block", "an incomplete draft cannot launch");
  assert.equal(draft.checks.find((k) => k.key === "knowledge").status, "warn", "no knowledge sources is worth a warning");

  // A complete campaign that targets the same roles and region as a running one gets an overlap warning.
  const values = { ...data.getCampaignConfig("c_us_saas"), name: "Overlapping SaaS CTO campaign" };
  const created = data.createCampaign(values, { launch: false });
  const review = data.getLaunchReview(created.id);
  assert.equal(review.checks.find((k) => k.key === "config").status, "ok");
  assert.equal(review.checks.find((k) => k.key === "overlap").status, "warn");
  assert.match(review.checks.find((k) => k.key === "overlap").detail, /US SaaS CTO/);
  assert.equal(review.ready, true, "warnings do not stop a launch");

  // A paused channel is called out, and no enabled channel at all blocks.
  const state = getState();
  state.channels.find((c) => c.key === "linkedin").enabled = false;
  assert.equal(data.getLaunchReview(created.id).checks.find((k) => k.key === "channels").status, "warn");
  state.channels.find((c) => c.key === "email").enabled = false;
  assert.equal(data.getLaunchReview(created.id).checks.find((k) => k.key === "channels").status, "block");
  assert.equal(data.getLaunchReview(created.id).ready, false);
  state.channels.forEach((c) => (c.enabled = true));
});
