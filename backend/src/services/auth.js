// Sign-in and who-did-it. Two modes, chosen by one environment variable:
//
//   APP_ACCESS_CODE unset  Open mode. The login page only asks for a name; the API stays open. Good for local work.
//   APP_ACCESS_CODE set    The API requires a signed-in session. The code is what protects the site; the name
//                          is who the actions are recorded against (approvals, prompt changes, pauses).
//
// A session is a signed token (HMAC-SHA256, expires after AUTH_TTL_HOURS) sent as `Authorization: Bearer ...`.
// Tokens hold only a display name, so there is nothing else to leak. Set AUTH_SECRET so sessions survive a restart.
import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { config } from "../config.js";

const DEFAULT_USER = "JD";
const secret = config.auth.secret || (config.auth.accessCode ? crypto.createHash("sha256").update(`sdr:${config.auth.accessCode}`).digest("hex") : crypto.randomBytes(32).toString("hex"));

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const context = new AsyncLocalStorage();

/** The signed-in user's name for the request being handled (or the default user outside a request, e.g. the scheduler). */
export const currentUser = () => (context.getStore() && context.getStore().user) || DEFAULT_USER;

export function cleanName(raw) {
  const name = String(raw || "").replace(/[^\p{L}\p{N} .'\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name || DEFAULT_USER;
}

export function issueToken(name, now = Date.now()) {
  const payload = b64(JSON.stringify({ name: cleanName(name), exp: now + config.auth.ttlHours * 3600 * 1000 }));
  return `${payload}.${sign(payload)}`;
}

/** -> { name } for a valid, unexpired token, otherwise null. */
export function verifyToken(token, now = Date.now()) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return data.exp > now && data.name ? { name: cleanName(data.name) } : null;
  } catch {
    return null;
  }
}

const codeMatches = (given) => {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(config.auth.accessCode).digest();
  return crypto.timingSafeEqual(a, b);
};

// A few wrong codes in a row from one address slows guessing down (in memory, per process).
const attempts = new Map();
function tooManyAttempts(ip, now = Date.now()) {
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 60 * 1000);
  attempts.set(ip, recent);
  return recent.length >= 8;
}

export const authConfig = () => ({ codeRequired: !!config.auth.accessCode });

export function login({ name, code }, ip = "local", now = Date.now()) {
  if (config.auth.accessCode) {
    if (tooManyAttempts(ip, now)) throw Object.assign(new Error("Too many attempts. Wait a minute and try again."), { status: 429 });
    if (!codeMatches(code)) {
      attempts.set(ip, [...(attempts.get(ip) || []), now]);
      throw Object.assign(new Error("Incorrect access code."), { status: 401 });
    }
  }
  const user = cleanName(name);
  return { token: issueToken(user, now), user: { name: user } };
}

/** Express middleware for /api: identifies the user, and refuses anonymous requests when an access code is set. */
export function authMiddleware(req, res, next) {
  if (req.path.startsWith("/auth/")) return next(); // login itself must be reachable
  const header = req.headers.authorization || "";
  const session = header.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;
  if (!session && config.auth.accessCode) {
    return res.status(401).json({ error: "Sign in required.", code: "auth" });
  }
  context.run({ user: session ? session.name : DEFAULT_USER }, next);
}

export const me = (req) => {
  const header = req.headers.authorization || "";
  const session = header.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;
  return session ? { name: session.name } : null;
};
