import express from "express";
import cors from "cors";
import { activeEngine, config, dronahqStatus, isDronahqMode, isGeminiMode } from "./config.js";
import { router } from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { startScheduler } from "./services/scheduler.js";
import { initDb } from "./db/index.js";
import { getUsage } from "./services/usage.js";
import { embeddingsStatus } from "./services/embeddings.js";

const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || config.allowedOrigins.includes(origin) || config.allowedOrigins.includes("*")) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed.`));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) =>
  res.json({
    ok: true,
    agentEngine: activeEngine(),
    ...(isDronahqMode() ? { dronahqWebhooksConfigured: dronahqStatus() } : {}),
    ...(isGeminiMode() ? { geminiKeyConfigured: !!config.gemini.apiKey, geminiModel: config.gemini.model } : {}),
    schedulerIntervalMs: config.schedulerIntervalMs,
    embeddings: embeddingsStatus(),
    llmUsageToday: (({ llmCalls, dailyCap, capReached, avoidedTotal }) => ({ llmCalls, dailyCap, capReached, decisionsWithoutLlm: avoidedTotal }))(getUsage()),
  })
);

app.use("/api", router);

app.use(notFound);
app.use(errorHandler);

async function main() {
  await initDb(); // loads/seeds Postgres or the local JSON file before anything can query it
  app.listen(config.port, () => {
    console.log(`Autonomous SDR backend listening on :${config.port}`);
    console.log(`Agent engine chain: ${activeEngine()}  (dronahq = DronaHQ webhooks, gemini = Google Gemini, llm = Anthropic, rule = deterministic)`);
    if (isDronahqMode()) {
      const missing = Object.entries(dronahqStatus()).filter(([, ok]) => !ok).map(([k]) => k);
      if (missing.length) console.warn(`[dronahq] No webhook configured for: ${missing.join(", ")} — those agents will ${config.dronahq.fallback === "none" ? "FAIL" : "move to the next engine"}.`);
    }
    if (isGeminiMode() && !config.gemini.apiKey) {
      console.warn(`[gemini] GEMINI_API_KEY is not set — Gemini calls will fail and ${config.gemini.fallback === "none" ? "FAIL" : "move to the next engine"}.`);
    }
    console.log(`Datastore: ${config.databaseUrl ? "Postgres (Neon)" : "local JSON file"}`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(", ")}`);
    startScheduler();
  });
}

main().catch((e) => {
  console.error("[server] Failed to start:", e.message);
  process.exit(1);
});
