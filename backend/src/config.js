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
  agentEngine: (process.env.AGENT_ENGINE || "rule").toLowerCase(), // "rule" | "llm" | "dronahq"
  // DronaHQ Agentic AI: each agent is called through its Webhook Trigger, with the trigger's
  // API key sent in the `api-key` header. Confirmed synchronous — the agent's output comes back
  // in the same HTTP response (see src/services/agentEngine/dronahqEngine.js).
  dronahq: {
    timeoutMs: Number(process.env.DRONAHQ_TIMEOUT_MS) || 90000,
    // "rule" (default): if a DronaHQ call fails, fall back to the rule engine for that one decision.
    // "none": rethrow instead, so failures are visible while integrating (nothing masks them).
    fallback: (process.env.DRONAHQ_FALLBACK || "rule").toLowerCase(),
    apiKey: process.env.DRONAHQ_API_KEY || "", // fallback when an agent has no key of its own
    webhooks: {
      icp: { url: process.env.DRONAHQ_WEBHOOK_ICP || "", apiKey: process.env.DRONAHQ_API_KEY_ICP || "" },
      personalisation: {
        url: process.env.DRONAHQ_WEBHOOK_PERSONALISATION || "",
        apiKey: process.env.DRONAHQ_API_KEY_PERSONALISATION || "",
      },
      conversation: {
        url: process.env.DRONAHQ_WEBHOOK_CONVERSATION || "",
        apiKey: process.env.DRONAHQ_API_KEY_CONVERSATION || "",
      },
    },
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  modelFast: process.env.AGENT_MODEL_FAST || "claude-3-5-haiku-latest",
  modelSmart: process.env.AGENT_MODEL_SMART || "claude-sonnet-4-5",
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS) || 12000,
  schedulerBatchSize: Number(process.env.SCHEDULER_BATCH_SIZE) || 3,
};

export function isLlmMode() {
  return config.agentEngine === "llm" && !!config.anthropicApiKey;
}

export function isDronahqMode() {
  return config.agentEngine === "dronahq";
}

/** Which engine will actually run: "dronahq" | "llm" | "rule". */
export function activeEngine() {
  if (isDronahqMode()) return "dronahq";
  return isLlmMode() ? "llm" : "rule";
}

/** For /health: which DronaHQ agents have a webhook configured (booleans only — never URLs or keys). */
export function dronahqStatus() {
  return Object.fromEntries(Object.entries(config.dronahq.webhooks).map(([k, w]) => [k, !!w.url]));
}
