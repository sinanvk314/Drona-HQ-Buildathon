// Sends 4 known prospects to the ICP Fitment agent and checks each answer. Two engines:
//   DronaHQ (default): the real DronaHQ webhook. Needs DRONAHQ_WEBHOOK_ICP and DRONAHQ_API_KEY_ICP.
//   Gemini:            add the word "gemini". Needs GEMINI_API_KEY in backend/.env.
// Both live in backend/.env.
//
// Run it from ANY folder (letters A-D pick cases; each real call costs credits or quota):
//   node backend\scripts\try-icp.mjs            all 4 cases, DronaHQ
//   node backend\scripts\try-icp.mjs A          only case A, DronaHQ
//   node backend\scripts\try-icp.mjs gemini     all 4 cases, Gemini
//   node backend\scripts\try-icp.mjs A gemini   only case A, Gemini
//
// Nothing here prints your webhook URL or key. An LLM can vary a little between runs, so treat a
// single FAIL as "look at it", and a pattern of FAILs as "tune the agent's Instructions".
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load backend/.env by its exact location (not "whatever folder you happen to be in"), BEFORE the
// app's config module reads the environment.
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
dotenv.config({ path: envFile });

const { config } = await import("../src/config.js");
const { buildSeed } = await import("../src/db/seed.js");
const { DronaHQError, dronahqScoreICP } = await import("../src/services/agentEngine/dronahqEngine.js");
const { geminiScoreICP, GeminiError } = await import("../src/services/agentEngine/geminiEngine.js");

const args = process.argv.slice(2);
const useGemini = args.some((a) => a.toLowerCase() === "gemini");
const scoreICP = useGemini ? geminiScoreICP : dronahqScoreICP;
console.log(`Engine under test: ${useGemini ? `Gemini (${config.gemini.model})` : "DronaHQ webhook"}`);

const icp = config.dronahq.webhooks.icp;
const missing = [];
if (useGemini) {
  if (!config.gemini.apiKey) missing.push("GEMINI_API_KEY");
} else {
  if (!icp.url) missing.push("DRONAHQ_WEBHOOK_ICP");
  if (!(icp.apiKey || config.dronahq.apiKey)) missing.push("DRONAHQ_API_KEY_ICP");
}
if (missing.length) {
  console.error(`\nNot set yet: ${missing.join(" and ")}`);
  console.error(`Open this file, fill the value(s) in, save, and run again:\n  ${path.resolve(envFile)}\n`);
  process.exitCode = 1;
  process.exit();
}

// The seeded "US SaaS CTO Outreach" campaign, exactly as the backend holds it.
const campaign = buildSeed(Date.now()).campaigns.find((c) => c.id === "c_us_saas");

const person = (over) => ({
  name: "", title: "", email: "", company: "", industry: "", size: "", funding: "", tech: [], city: "",
  qual: { status: "Pending" }, history: [], ...over,
});

const cases = [
  {
    label: "A  strong fit                    -> expect Qualified, score >= 70",
    prospect: person({
      name: "Dana Whitfield", title: "CTO", email: "dana@cloudpeak.example", company: "CloudPeak Systems",
      industry: "SaaS", size: "220 employees", funding: "Series A, $12M raised", tech: ["AWS", "Kubernetes"], city: "Austin, TX",
      history: [{ kind: "note", text: "Title confirmed as CTO. Hiring a Platform Engineer and a FinOps lead." }],
    }),
    check: (r) => r.qualified === true && r.score >= 70,
  },
  {
    label: "B  wrong role, far too small      -> expect Rejected",
    prospect: person({
      name: "Sam Ortiz", title: "Marketing Manager", email: "sam@tinyloop.example", company: "TinyLoop",
      industry: "SaaS", size: "8 employees", funding: "Pre-seed", tech: ["GCP"], city: "Denver, CO",
    }),
    check: (r) => r.qualified === false,
  },
  {
    label: "C  strong profile but a customer  -> expect Rejected (exclusion)",
    prospect: person({
      name: "Priya Nair", title: "VP Engineering", email: "priya@datalane.example", company: "Datalane",
      industry: "SaaS", size: "300 employees", funding: "Series B, $30M raised", tech: ["AWS"], city: "New York, NY",
      history: [{ kind: "note", text: "Datalane is already a paying customer (existing customer, exclusion applies)." }],
    }),
    check: (r) => r.qualified === false,
  },
  {
    label: "D  critical facts missing         -> expect Escalate",
    prospect: person({ name: "Jordan Lee", title: null, email: "jordan@northgate.example", company: "Northgate", industry: null, size: null, funding: null, city: null }),
    check: (r) => /^\[Agent escalated\]/.test(r.reasoning),
  },
];

// Optional: run only some cases to save credits (each real call costs ~15-20 DronaHQ credits).
//   node backend\scripts\try-icp.mjs A      -> only case A
//   node backend\scripts\try-icp.mjs BC     -> cases B and C
const only = (args.find((a) => a.toLowerCase() !== "gemini") || "").toUpperCase();
const selected = only ? cases.filter((c) => only.includes(c.label[0])) : cases;
if (selected.length === 0) {
  console.error(`No cases match "${only}". Use letters A, B, C, D (for example: A or AD).`);
  process.exit(1);
}

let failed = 0;
for (const c of selected) {
  process.stdout.write(`\n${c.label}\n`);
  const started = Date.now();
  try {
    const r = await scoreICP({ campaign, prospect: c.prospect, promptText: "", knowledge: [] });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const ok = c.check(r);
    failed += ok ? 0 : 1;
    console.log(`   ${ok ? "PASS" : "FAIL"}  qualified=${r.qualified}  score=${r.score}  (${secs}s)`);
    console.log(`         reasoning: ${r.reasoning.slice(0, 160)}`);
  } catch (e) {
    failed += 1;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`   FAIL  ${e instanceof DronaHQError || e instanceof GeminiError ? e.message : e.stack}  (${secs}s)`);
  }
}

console.log(`\n${failed === 0 ? `All ${selected.length} passed.` : `${failed} of ${selected.length} did not pass.`}`);
// Set the exit code and let Node exit on its own. Calling process.exit() right after network
// requests can crash Node on Windows with "UV_HANDLE_CLOSING" and lose the real exit code.
process.exitCode = failed === 0 ? 0 : 1;
