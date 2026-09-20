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
  // Which engine(s) decide. One of "rule" | "llm" | "dronahq" | "gemini", or a comma-separated CHAIN
  // tried in order, e.g. "dronahq,gemini" (then the rule engine is the final fallback).
  agentEngine: (process.env.AGENT_ENGINE || "rule").toLowerCase(),
  // Google Gemini (free tier available). Structured JSON output is enforced by the API itself.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    // Google retires models often (gemini-2.5-flash returned "no longer available to new users" in
    // testing). List what your key can use with:  node backend\scripts\gemini-models.mjs
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 30000,
    // Temporary errors (HTTP 429 rate limit, 500/502/503/504 "high demand") are retried with a growing
    // pause: retryDelayMs, then 2x, 3x... A Retry-After header from Google overrides the pause.
    retries: process.env.GEMINI_RETRIES ? Number(process.env.GEMINI_RETRIES) : 2,
    retryDelayMs: Number(process.env.GEMINI_RETRY_DELAY_MS) || 2000,
    // Client-side throttle: requests per minute. The free tier is roughly 15 RPM, so stay under it.
    rpm: Number(process.env.GEMINI_RPM) || 12,
    // "rule" (default): on failure fall through to the next engine. "none": rethrow, so failures show.
    fallback: (process.env.GEMINI_FALLBACK || "rule").toLowerCase(),
  },
  // DronaHQ Agentic AI: each agent is called through its Webhook Trigger, with the trigger's
  // API key sent in the `api-key` header. NOTE: in testing, the webhook reply did NOT carry the
  // agent's output (Response=Standard returned `response: null`, None returned "started in
  // background"), even though the run's trace shows the correct JSON was produced. This engine
  // works if a setup that returns the output is found; until then use the chain with gemini.
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

/** The engines to try, in order, from AGENT_ENGINE ("dronahq,gemini" -> ["dronahq", "gemini"]). */
export function engineChain() {
  return config.agentEngine.split(",").map((s) => s.trim()).filter(Boolean);
}

export function isLlmMode() {
  return engineChain().includes("llm") && !!config.anthropicApiKey;
}

export function isDronahqMode() {
  return engineChain().includes("dronahq");
}

export function isGeminiMode() {
  return engineChain().includes("gemini");
}

/** Human-readable engine label for logs and /health, e.g. "dronahq > gemini > rule". */
export function activeEngine() {
  const chain = engineChain().filter((e) => e !== "rule" && (e !== "llm" || isLlmMode()));
  return [...chain, "rule"].join(" > ");
}

/** For /health: which DronaHQ agents have a webhook configured (booleans only — never URLs or keys). */
export function dronahqStatus() {
  return Object.fromEntries(Object.entries(config.dronahq.webhooks).map(([k, w]) => [k, !!w.url]));
}
