// Scores the ICP Fitment agent against the golden set (backend/eval/icp-golden.json).
//
//   node scripts/eval-icp.mjs                 the rule engine (free, no API key)
//   node scripts/eval-icp.mjs gemini          Gemini, with the free rule-based rejection shortcut on
//   node scripts/eval-icp.mjs gemini --no-shortcut   every case goes to Gemini
//
// A Gemini run makes up to one request per case (about 16) and uses your real quota. Counters go to a temp
// file, so the dashboard's daily numbers are not touched.
import os from "os";
import path from "path";

process.env.USAGE_FILE = path.join(os.tmpdir(), `usage-eval-${process.pid}.json`);
const { runIcpEval } = await import("../eval/icpEval.js");

const args = process.argv.slice(2);
const engine = args.find((a) => !a.startsWith("--")) || "rule";
const shortcut = !args.includes("--no-shortcut");

console.log(`ICP golden-set evaluation  (engine: ${engine}, rejection shortcut: ${shortcut ? "on" : "off"})\n`);
const r = await runIcpEval({ engine, shortcut });

const pad = (s, n) => String(s ?? "").padEnd(n);
console.log(`${pad("case", 26)}${pad("expected", 10)}${pad("got", 10)}${pad("score", 6)}${pad("engine", 15)}${pad("ms", 7)}result`);
for (const x of r.results) {
  const verdict = x.error ? `ERROR ${x.error.slice(0, 50)}` : x.pass === null ? "borderline (not scored)" : x.pass ? "PASS" : "FAIL";
  console.log(`${pad(x.id, 26)}${pad(x.expect ?? "-", 10)}${pad(x.got ?? "-", 10)}${pad(x.score ?? "-", 6)}${pad(x.engine ?? "-", 15)}${pad(x.ms, 7)}${verdict}`);
}
const misses = r.results.filter((x) => x.pass === false);
console.log(`\nAccuracy: ${r.correct}/${r.scored} (${Math.round(r.accuracy * 100)}%)   borderline cases not scored: ${r.borderline}   errors: ${r.errors}`);
console.log(`LLM requests: ${r.llmCalls}   decisions with no LLM call: ${r.avoided}   tokens in/out: ${r.tokensIn}/${r.tokensOut}   avg ${r.avgMs} ms per case`);
if (misses.length) {
  console.log("\nMisses:");
  for (const m of misses) console.log(`  ${m.id}: expected ${m.expect}, got ${m.got} (score ${m.score}). ${m.why}`);
}
process.exitCode = 0;
