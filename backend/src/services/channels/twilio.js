// Twilio client: send an SMS, place a call, and check that a webhook really came from Twilio.
import crypto from "crypto";
import { config } from "../../config.js";

async function post(path, params) {
  const { accountSid, authToken, apiBase } = config.twilio;
  const res = await fetch(`${apiBase}/Accounts/${accountSid}/${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio said: ${body.message || res.status}`);
  return body;
}

/** Digits with a leading +, the way Twilio wants a number. */
export const e164 = (n) => { const d = String(n || "").replace(/[^\d+]/g, ""); return d.startsWith("+") ? d : d ? `+${d}` : ""; };

export async function sendSms({ to, body }) {
  const r = await post("Messages.json", { To: e164(to), From: config.twilio.smsFrom, Body: body });
  return { id: r.sid };
}

/** Places a call; when it is answered Twilio asks `url` what to say. */
export async function placeCall({ to, url, statusUrl }) {
  const r = await post("Calls.json", { To: e164(to), From: config.twilio.voiceFrom, Url: url, Method: "POST", ...(statusUrl ? { StatusCallback: statusUrl, StatusCallbackEvent: "completed" } : {}) });
  return { id: r.sid };
}

/** Twilio signs each webhook: HMAC-SHA1 of the full URL plus the sorted form fields, with the auth token. */
export function validSignature(url, params, signature) {
  if (!signature || !config.twilio.authToken) return false;
  const data = url + Object.keys(params || {}).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", config.twilio.authToken).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
export const xml = (t) => String(t || "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
