import express from "express";
import cors from "cors";
import { config, isLlmMode } from "./config.js";
import { router } from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { startScheduler } from "./services/scheduler.js";
import { initDb } from "./db/index.js";

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
  res.json({ ok: true, agentEngine: isLlmMode() ? "llm" : "rule", schedulerIntervalMs: config.schedulerIntervalMs })
);

app.use("/api", router);

app.use(notFound);
app.use(errorHandler);

async function main() {
  await initDb(); // loads/seeds Postgres or the local JSON file before anything can query it
  app.listen(config.port, () => {
    console.log(`Autonomous SDR backend listening on :${config.port}`);
    console.log(`Agent engine: ${isLlmMode() ? "llm (Anthropic API)" : "rule (deterministic, zero-cost)"}`);
    console.log(`Datastore: ${config.databaseUrl ? "Postgres (Neon)" : "local JSON file"}`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(", ")}`);
    startScheduler();
  });
}

main().catch((e) => {
  console.error("[server] Failed to start:", e.message);
  process.exit(1);
});
