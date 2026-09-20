// Regression guard for ICP fitment on the golden set, using the free rule engine (no API key, deterministic).
// The floor is the accuracy the rule engine achieves today; its known misses are the cases that need judgment
// (a competitor named only in the research notes, a regulated-entity check, an industry mismatch), which is
// why qualifications go to the LLM. Run `node scripts/eval-icp.mjs gemini` to score the LLM path.
import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-golden-${process.pid}.json`);
process.env.EMBEDDINGS = "off";
const { runIcpEval } = await import("../eval/icpEval.js");

test("rule engine keeps its accuracy on the golden set", async () => {
  const r = await runIcpEval({ engine: "rule", shortcut: true });
  assert.equal(r.errors, 0);
  assert.ok(r.accuracy >= 0.7, `accuracy fell to ${Math.round(r.accuracy * 100)}% (${r.correct}/${r.scored})`);
});

test("the free rejection shortcut is never wrong on the golden set", async () => {
  const r = await runIcpEval({ engine: "rule", shortcut: true });
  const shortcut = r.results.filter((x) => x.engine === "rule-shortcut" && x.pass !== null);
  assert.ok(shortcut.length >= 3, "the shortcut should settle the clear rejections");
  assert.deepEqual(shortcut.filter((x) => !x.pass).map((x) => x.id), []);
});

test("a weak profile with a buying signal in the research notes is not rejected by the shortcut", async () => {
  const r = await runIcpEval({ engine: "rule", shortcut: true });
  for (const id of ["border-01-slightly-small", "border-02-slightly-large"]) {
    assert.notEqual(r.results.find((x) => x.id === id).engine, "rule-shortcut", id);
  }
});
