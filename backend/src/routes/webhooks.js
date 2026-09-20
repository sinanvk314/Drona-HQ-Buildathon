// Twilio calls these: they are not behind sign-in (Twilio cannot sign in), so every request must carry Twilio's signature, made
// with the account's auth token. A request without a valid signature is refused.
import express, { Router } from "express";
import { config } from "../config.js";
import { getState, persistState } from "../db/index.js";
import { validSignature, twiml } from "../services/channels/twilio.js";
import { normalisePhone } from "../services/contacts.js";
import { isRealCampaign } from "../services/realMode.js";
import { voiceEnd, voiceStart, voiceTurn } from "../services/channels/voice.js";
import { processReply } from "../services/scheduler.js";

export const webhooks = Router();
webhooks.use(express.urlencoded({ extended: false }));

// The signature is computed over the URL Twilio was given, so it is rebuilt from PUBLIC_URL, not from the incoming Host header.
webhooks.use((req, res, next) => {
  if (!config.publicUrl || !config.twilio.authToken) return res.status(503).type("text/plain").send("Not configured");
  if (!validSignature(`${config.publicUrl}${req.originalUrl}`, req.body || {}, req.get("x-twilio-signature"))) return res.status(403).type("text/plain").send("Bad signature");
  next();
});

const xmlRoute = (fn) => async (req, res) => {
  try {
    res.type("text/xml").send(await fn(req));
  } catch (e) {
    console.warn(`[webhook] ${req.path}: ${e.message}`);
    res.type("text/xml").send(twiml("<Hangup/>"));
  }
};

// A text message came in: match it to the real person by number and handle it like any other reply.
webhooks.post("/twilio/sms", xmlRoute(async (req) => {
  const s = getState();
  const from = normalisePhone(req.body.From);
  const p = from && s.prospects.find((x) => x.phone === from && isRealCampaign(s.campaigns.find((c) => c.id === x.campaignId)));
  if (!p) return twiml("");
  const campaign = s.campaigns.find((c) => c.id === p.campaignId);
  await processReply(s, campaign, p, { text: String(req.body.Body || "").slice(0, 2000), channel: "sms", kind: "real text reply" });
  await persistState();
  return twiml("");
}));

webhooks.post("/twilio/voice", xmlRoute((req) => voiceStart(String(req.query.p || ""))));
webhooks.post("/twilio/voice/turn", xmlRoute((req) => voiceTurn(String(req.query.p || ""), req.body.SpeechResult)));
webhooks.post("/twilio/voice/status", xmlRoute(async (req) => {
  await voiceEnd(String(req.query.p || ""));
  return twiml("");
}));
