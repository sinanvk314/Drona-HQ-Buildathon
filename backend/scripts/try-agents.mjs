// Tests the PERSONALISATION and CONVERSATION agents on the real Gemini API (try-icp.mjs covers ICP).
// 3 real calls. Needs GEMINI_API_KEY in backend/.env. Run from any folder:
//   node backend\scripts\try-agents.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });
const { config } = await import("../src/config.js");
const { buildSeed } = await import("../src/db/seed.js");
const { geminiDraftOutreach, geminiHandleConversation, GeminiError } = await import("../src/services/agentEngine/geminiEngine.js");

if (!config.gemini.apiKey) {
  console.error("GEMINI_API_KEY is not set in backend/.env");
  process.exit(1);
}
console.log(`Model: ${config.gemini.model}`);

const campaign = buildSeed(Date.now()).campaigns.find((c) => c.id === "c_us_saas");
const dana = {
  name: "Dana Whitfield", title: "CTO", email: "dana@cloudpeak.example", company: "CloudPeak Systems", industry: "SaaS",
  size: "220 employees", funding: "Series A, $12M raised", tech: ["AWS", "Kubernetes"], city: "Austin, TX",
  qual: { status: "Qualified", reasoning: "CTO at a growing SaaS company.", agent: "ICP Fitment Agent", harness: "v3.2" },
  history: [{ kind: "note", text: "Hiring a Platform Engineer and a FinOps lead." }], conversation: [],
};
const replying = (text) => ({ ...dana, conversation: [{ dir: "out", text: "Hi Dana, ..." }, { dir: "in", text }] });

let failed = 0;
const run = async (label, fn) => {
  process.stdout.write(`\n${label}\n`);
  const t = Date.now();
  try {
    const { ok, detail } = await fn();
    failed += ok ? 0 : 1;
    console.log(`   ${ok ? "PASS" : "FAIL"}  (${((Date.now() - t) / 1000).toFixed(1)}s)  ${detail}`);
  } catch (e) {
    failed += 1;
    console.log(`   FAIL  ${e instanceof GeminiError || e.constructor.name === "DronaHQError" ? e.message : e.stack}`);
  }
};

await run("Personalisation: draft a first message for Dana -> expect an enabled channel, a subject, a short real body", async () => {
  const r = await geminiDraftOutreach({ campaign, prospect: dana, promptText: "", override: null, knowledge: [] });
  const words = r.body.trim().split(/\s+/).length;
  console.log(`         channel=${r.channel} subject="${r.subject}" words=${words}\n         body: ${r.body.replace(/\s+/g, " ").slice(0, 260)}`);
  const mentionsFact = /platform|finops|hiring|cloudpeak|series a|kubernetes|aws/i.test(r.body);
  return { ok: campaign.channels.includes(r.channel) && words <= 120 && mentionsFact, detail: `channel ok, ${words} words, references a real fact: ${mentionsFact}` };
});

await run("Conversation: 'can you share your SOC 2 report and where data is stored?' -> expect escalate", async () => {
  const r = await geminiHandleConversation({ campaign, prospect: replying("Before we go further, can you share your SOC 2 report and where data is stored?"), promptText: "", override: null, knowledge: [] });
  return { ok: r.action === "escalate", detail: `action=${r.action}: ${r.reasoning.slice(0, 120)}` };
});

await run("Conversation: 'Interesting, could we do a quick call this week?' -> expect meeting", async () => {
  const r = await geminiHandleConversation({ campaign, prospect: replying("Interesting, could we do a quick call this week?"), promptText: "", override: null, knowledge: [] });
  return { ok: r.action === "meeting", detail: `action=${r.action}: ${r.reasoning.slice(0, 120)}` };
});

console.log(`\n${failed === 0 ? "All 3 passed." : `${failed} of 3 did not pass.`}`);
process.exitCode = failed === 0 ? 0 : 1;
