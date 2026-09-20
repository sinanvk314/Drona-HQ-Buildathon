// Central place for env-driven configuration. Every value has a working default
// so the server runs with zero setup (`npm install && npm start`).
import "dotenv/config";

/** "a@x.com, <B@y.com>; '+91 98765 43210'" -> ["a@x.com", "b@y.com", "+919876543210"]: tolerant of the slips people make in an env setting. */
export function parseAllowlist(raw) {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((x) => x.trim().replace(/^["'<\s]+|["'>\s]+$/g, "").toLowerCase())
    .map((x) => (x.includes("@") ? x : x.replace(/[\s()-]/g, "")))
    .filter(Boolean);
}

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
    // One model or a comma-separated list tried in order. Free-tier quotas are PER MODEL, so a second model
    // keeps the demo alive when the first one's quota runs out. Google also retires models often
    // (gemini-2.5-flash returned "no longer available to new users"). List what your key can use with:
    //   node backend\scripts\gemini-models.mjs
    // The lite model answers in ~2s (vs ~8s), so it goes first.
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite,gemini-3.6-flash",
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
  // Sign-in. With APP_ACCESS_CODE set the API requires it (the name entered at login is who actions are recorded
  // against); unset, the login page only asks for a name. AUTH_SECRET signs sessions: set it so they survive restarts.
  auth: {
    accessCode: process.env.APP_ACCESS_CODE || "",
    secret: process.env.AUTH_SECRET || "",
    ttlHours: Number(process.env.AUTH_TTL_HOURS) || 168,
  },
  // Real sending. Everything here is off until deliberately set up. A campaign whose data is "real" (its prospects are people
  // entered by hand in the Dev tab) may send real email (Gmail API), SMS and calls (Twilio), and only when REAL_SENDING=on.
  realSending: process.env.REAL_SENDING === "on",
  // Real messages to a real person always wait for a human, unless this is on.
  realAutoSend: process.env.REAL_AUTO_SEND === "on",
  // Optional safety net: when set, real messages go only to these addresses or numbers (comma-separated).
  realAllowlist: parseAllowlist(process.env.REAL_SEND_ALLOWLIST),
  // The public address of this deployment (no trailing slash): Twilio calls back to it for replies and calls.
  publicUrl: String(process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || "", clientSecret: process.env.GMAIL_CLIENT_SECRET || "", refreshToken: process.env.GMAIL_REFRESH_TOKEN || "",
    sender: process.env.GMAIL_SENDER || "", // the Gmail address the refresh token belongs to
    apiBase: process.env.GMAIL_API_BASE || "https://gmail.googleapis.com/gmail/v1", tokenUrl: process.env.GMAIL_TOKEN_URL || "https://oauth2.googleapis.com/token",
    pollMs: Number(process.env.GMAIL_POLL_MS) || 30000,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "", authToken: process.env.TWILIO_AUTH_TOKEN || "",
    smsFrom: process.env.TWILIO_SMS_FROM || "", voiceFrom: process.env.TWILIO_VOICE_FROM || process.env.TWILIO_SMS_FROM || "",
    apiBase: process.env.TWILIO_API_BASE || "https://api.twilio.com/2010-04-01",
  },
  // Meetings use real dates and times (a meeting is for people), in this time zone, for this long.
  meetingTimezone: process.env.MEETING_TIMEZONE || "Asia/Kolkata",
  meetingMinutes: Number(process.env.MEETING_MINUTES) || 30,
  // Simulated clock for cadence and working hours. Real sends do not exist yet, and a real 72-hour follow-up wait
  // cannot be shown in a demo, so one simulated hour lasts this many real milliseconds (3000 = a simulated day is
  // 72 seconds). Set it to 3600000 for real time. The daily limit and working hours use the same clock.
  simMsPerHour: Number(process.env.SIM_MS_PER_HOUR) || 3000,
  // Chance per scheduler tick that a contacted prospect replies. Replies are simulated until a mailbox is connected;
  // 0 means nobody ever replies (useful for testing the follow-up cadence).
  simReplyChance: process.env.SIM_REPLY_CHANCE !== undefined ? Number(process.env.SIM_REPLY_CHANCE) : 0.08,
  // "off" stops the scheduler from holding outreach back for the daily limit, working hours and frequency cap.
  enforceLimits: (process.env.ENFORCE_LIMITS || "on").toLowerCase() !== "off",
  // Cost control. Every LLM call is counted per day (data/usage.json). Past LLM_DAILY_CALL_CAP the
  // chain skips LLM engines and the rule engine decides, so a demo can never burn the free quota
  // dry. 0 disables the cap.
  llmDailyCallCap: process.env.LLM_DAILY_CALL_CAP !== undefined ? Number(process.env.LLM_DAILY_CALL_CAP) : 300,
  // Clear-cut ICP REJECTIONS skip the LLM: the rule engine's score is at least this far below the campaign
  // threshold (or a hard exclusion fired). Qualifications always go to the LLM. 0 turns the shortcut off.
  icpShortcutMargin: process.env.ICP_SHORTCUT_MARGIN !== undefined ? Number(process.env.ICP_SHORTCUT_MARGIN) : 20,
  // Embedding routing of clean-cut replies (unsubscribe / hostile / out-of-office) with no LLM call.
  replyRouting: {
    enabled: (process.env.REPLY_ROUTING || "on").toLowerCase() !== "off",
    minScore: Number(process.env.REPLY_MIN_SCORE) || 0.80,
    minMargin: Number(process.env.REPLY_MIN_MARGIN) || 0.05,
  },
  // "off" never loads the embedding model (saves ~300MB of RAM on small hosts). Retrieval then uses keyword
  // search and reply routing sends every reply to the Conversation Agent.
  embeddingsEnabled: (process.env.EMBEDDINGS || "on").toLowerCase() !== "off",
  // Cost estimates for the dashboard. With token counts from the provider the cost is tokens x these prices
  // (USD per million tokens; set them to your model's real prices). EST_COST_PER_LLM_CALL is the fallback when
  // no token counts are available.
  estCostPerMTokIn: Number(process.env.EST_COST_PER_MTOK_IN) || 0.1,
  estCostPerMTokOut: Number(process.env.EST_COST_PER_MTOK_OUT) || 0.4,
  estCostPerLlmCall: Number(process.env.EST_COST_PER_LLM_CALL) || 0.0015,
};

/** The engines to try, in order, from AGENT_ENGINE ("dronahq,gemini" -> ["dronahq", "gemini"]). */
export function engineChain() {
  return config.agentEngine.split(",").map((s) => s.trim()).filter(Boolean);
}

export function isLlmMode() {
  return engineChain().includes("llm") && !!config.anthropicApiKey;
}

/** The Gemini models to try, in order, from GEMINI_MODEL ("a,b" -> ["a", "b"]). */
export function geminiModels() {
  return String(config.gemini.model).split(",").map((s) => s.trim()).filter(Boolean);
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
