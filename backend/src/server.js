import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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

// Browsers send an Origin header on same-origin POSTs too, so when the backend also serves the UI (one
// deployment, one URL) the request's own host must be allowed; otherwise only ALLOWED_ORIGINS are.
app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    const sameOrigin = origin && req.headers.host && new URL(origin).host === req.headers.host;
    const allowed = !origin || sameOrigin || config.allowedOrigins.includes(origin) || config.allowedOrigins.includes("*");
    cb(allowed ? null : new Error(`Origin ${origin} is not allowed.`), { origin: allowed });
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

// One-service deployment: if the frontend has been built (frontend/dist), serve it from here, with the
// index page as the fallback for any non-API path. In development the Vite dev server serves the UI instead.
const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "frontend", "dist");
if (fs.existsSync(path.join(UI_DIR, "index.html"))) {
  app.use(express.static(UI_DIR));
  app.get(/^\/(?!api\/|health).*/, (req, res) => res.sendFile(path.join(UI_DIR, "index.html")));
}

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
    console.log(`UI: ${fs.existsSync(path.join(UI_DIR, "index.html")) ? "serving frontend/dist" : "not built (use the Vite dev server)"}`);
    console.log(`Datastore: ${config.databaseUrl ? "Postgres (Neon)" : "local JSON file"}`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(", ")}`);
    startScheduler();
  });
}

main().catch((e) => {
  console.error("[server] Failed to start:", e.message);
  process.exit(1);
});
