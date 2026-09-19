// Central place for env-driven configuration. Every value has a working default
// so the server runs with zero setup (`npm install && npm start`).
import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 8080,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dataFile: process.env.DATA_FILE || "./data/state.json",
  // When set, the JSON file store is bypassed entirely and Postgres (Neon) is the source of
  // truth — see src/db/index.js. Leave unset to keep the zero-setup local JSON file behavior.
  databaseUrl: process.env.DATABASE_URL || "",
  agentEngine: (process.env.AGENT_ENGINE || "rule").toLowerCase(), // "rule" | "llm"
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  modelFast: process.env.AGENT_MODEL_FAST || "claude-3-5-haiku-latest",
  modelSmart: process.env.AGENT_MODEL_SMART || "claude-sonnet-4-5",
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS) || 12000,
  schedulerBatchSize: Number(process.env.SCHEDULER_BATCH_SIZE) || 3,
};

export function isLlmMode() {
  return config.agentEngine === "llm" && !!config.anthropicApiKey;
}
