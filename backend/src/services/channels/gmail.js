// Gmail API client: send a message (optionally with an attachment, in a thread) and read the replies in a thread.
// Authentication is an OAuth refresh token (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN); the access token
// it yields is cached until shortly before it expires. Scopes needed: gmail.send and gmail.readonly.
import { config } from "../../config.js";

let cached = { token: "", expires: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.expires - 60000) return cached.token;
  const res = await fetch(config.gmail.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.gmail.clientId, client_secret: config.gmail.clientSecret, refresh_token: config.gmail.refreshToken, grant_type: "refresh_token" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Gmail sign-in failed: ${body.error_description || body.error || res.status}`);
  cached = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3000) * 1000 };
  return cached.token;
}

async function api(path, options = {}) {
  const token = await accessToken();
  const res = await fetch(`${config.gmail.apiBase}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail said: ${(body.error && (body.error.message || body.error)) || res.status}`);
  return body;
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mimeWord = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`);
const wrap64 = (text) => Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");

/** The raw RFC 822 message. Exported for tests. */
export function buildMime({ to, fromName, fromAddress, subject, body, inReplyTo, attachments = [] }) {
  const boundary = `sdr_${Date.now().toString(36)}`;
  const headers = [
    `From: ${fromName ? `${mimeWord(fromName)} <${fromAddress}>` : fromAddress}`, `To: ${to}`, `Subject: ${mimeWord(subject)}`, "MIME-Version: 1.0",
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
  ];
  const text = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap64(body)];
  if (!attachments.length) return [...headers, ...text].join("\r\n");
  const parts = [`--${boundary}`, ...text];
  for (const a of attachments) parts.push(`--${boundary}`, `Content-Type: ${a.type}; name="${a.name}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${a.name}"`, "", wrap64(a.content));
  parts.push(`--${boundary}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

/** Sends one email. Returns { id, threadId }. */
export async function sendEmail({ to, fromName, subject, body, threadId, inReplyTo, attachments }) {
  const raw = buildMime({ to, fromName, fromAddress: config.gmail.sender, subject, body, inReplyTo, attachments });
  const sent = await api("/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: b64url(raw), ...(threadId ? { threadId } : {}) }) });
  return { id: sent.id, threadId: sent.threadId || threadId || null };
}

const header = (msg, name) => ((msg.payload && msg.payload.headers) || []).find((h) => h.name.toLowerCase() === name.toLowerCase());

function plainText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body && part.body.data) return Buffer.from(part.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  for (const p of part.parts || []) {
    const t = plainText(p);
    if (t) return t;
  }
  return "";
}

/** The person's new words only: the quoted earlier message and signatures are cut. */
export function stripQuoted(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const line of lines) {
    if (/^>/.test(line) || /^On .+ wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^From:\s.+/.test(line) && out.length) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Messages in a thread that are not ours and not yet seen. */
export async function newReplies({ threadId, seen = [] }) {
  const thread = await api(`/users/me/threads/${encodeURIComponent(threadId)}?format=full`);
  const own = config.gmail.sender.toLowerCase();
  return (thread.messages || [])
    .filter((m) => !seen.includes(m.id))
    .filter((m) => !String((header(m, "From") || {}).value || "").toLowerCase().includes(own))
    .map((m) => ({ id: m.id, from: (header(m, "From") || {}).value || "", subject: (header(m, "Subject") || {}).value || "", messageId: (header(m, "Message-ID") || header(m, "Message-Id") || {}).value || "", ts: Number(m.internalDate) || Date.now(), text: stripQuoted(plainText(m.payload)) }))
    .filter((m) => m.text);
}

export const resetGmailTokenCache = () => { cached = { token: "", expires: 0 }; };
