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
export function buildMime({ to, fromName, fromAddress, subject, body, inReplyTo, attachments = [], unsubscribe }) {
  const boundary = `sdr_${Date.now().toString(36)}`;
  const headers = [
    `From: ${fromName ? `${mimeWord(fromName)} <${fromAddress}>` : fromAddress}`, `To: ${to}`, `Subject: ${mimeWord(subject)}`, "MIME-Version: 1.0",
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    ...(unsubscribe ? [`List-Unsubscribe: <mailto:${unsubscribe}?subject=unsubscribe>`] : []),
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
  const raw = buildMime({ to, fromName, fromAddress: config.gmail.sender, subject, body, inReplyTo, attachments, unsubscribe: config.gmail.sender });
  const sent = await api("/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: b64url(raw), ...(threadId ? { threadId } : {}) }) });
  return { id: sent.id, threadId: sent.threadId || threadId || null };
}

const decode = (data) => Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** The readable text of a message: the plain part if there is one, otherwise the HTML part with its tags removed. */
function plainText(part) {
  const find = (p, type) => {
    if (!p) return "";
    if (p.mimeType === type && p.body && p.body.data) return decode(p.body.data);
    for (const child of p.parts || []) {
      const t = find(child, type);
      if (t) return t;
    }
    return "";
  };
  const plain = find(part, "text/plain");
  if (plain.trim()) return plain;
  const html = find(part, "text/html");
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** The person's new words only: the quoted earlier message, however their mail program marks it, is cut. */
export function stripQuoted(text) {
  let t = String(text || "").replace(/\r/g, "");
  // "On Mon, 21 Sep 2026 at 21:00, Name <a@b.com> wrote:" (Gmail wraps it over two lines), or the same in other languages' forms.
  t = t.split(/\n[ \t]*On [\s\S]{0,300}?\bwrote:[ \t]*(\n|$)/)[0];
  t = t.split(/\n[ \t]*-{2,}\s*(Original Message|Forwarded message)/i)[0];
  t = t.split(/\n[ \t]*_{5,}\s*\n/)[0]; // Outlook divider
  t = t.split(/\n[ \t]*From:[ \t].+\n[ \t]*(Sent|Date):/i)[0]; // Outlook header block
  const kept = [];
  for (const line of t.split("\n")) {
    if (/^\s*>/.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/** Bounces and automatic replies are not answers from the person: a bounce means the address does not work, an auto-reply is an out-of-office. */
export function classifyMessage(headers, from, subject, text) {
  const h = (n) => String((headers.find((x) => x.name.toLowerCase() === n) || {}).value || "").toLowerCase();
  if (/mailer-daemon|postmaster/.test(from.toLowerCase()) || /^(delivery status notification|undeliverable|mail delivery (failed|subsystem)|returned mail)/i.test(subject) || /multipart\/report/.test(h("content-type"))) return "bounce";
  if ((h("auto-submitted") && h("auto-submitted") !== "no") || /auto[-_ ]?reply|autoreply/.test(h("x-autoreply") + h("x-autorespond") + h("precedence")) || /^(automatic reply|auto[- ]?reply|out of office|autosvar)/i.test(subject) || /\b(out of (the )?office|automatic reply|auto-?reply)\b/i.test(String(text).slice(0, 300))) return "auto";
  return "human";
}

/**
 * New messages in a thread that we did not send. A message counts as ours only if we sent it through the API (its id is in
 * `seen`), never by its From address: when the person is the same Gmail account as the sender (a test), their reply comes from
 * that same address and is still a reply.
 */
export async function newReplies({ threadId, seen = [] }) {
  const thread = await api(`/users/me/threads/${encodeURIComponent(threadId)}?format=full`);
  return (thread.messages || [])
    .filter((m) => !seen.includes(m.id))
    .map((m) => {
      const headers = (m.payload && m.payload.headers) || [];
      const get = (n) => (headers.find((x) => x.name.toLowerCase() === n.toLowerCase()) || {}).value || "";
      const raw = plainText(m.payload);
      return { id: m.id, from: get("From"), subject: get("Subject"), messageId: get("Message-ID"), ts: Number(m.internalDate) || Date.now(), text: stripQuoted(raw), kind: classifyMessage(headers, get("From"), get("Subject"), raw) };
    })
    .filter((m) => m.text || m.kind === "bounce");
}

/** Who the refresh token signs in as: proves the credentials work and shows which mailbox mail will come from. */
export async function profile() {
  const p = await api("/users/me/profile");
  return { address: p.emailAddress, messages: p.messagesTotal };
}

export const resetGmailTokenCache = () => { cached = { token: "", expires: 0 }; };
