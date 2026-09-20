// The Voice SDR: a real outbound phone call, for real campaigns only. Twilio places the call and does the speech-to-text and
// text-to-speech; this file decides what to say, one turn at a time, through the same engine chain as every other agent (Gemini,
// with a plain rule fallback). Twilio calls three webhooks on this server (see routes/webhooks.js):
//   voiceStart  the call was answered: say the opening
//   voiceTurn   the person spoke: decide the reply, or end the call
//   voiceEnd    the call finished: write the transcript into the conversation and hand the outcome on
import { config } from "../../config.js";
import { getState, persistState } from "../../db/index.js";
import * as engine from "../agentEngine/index.js";
import { placeCall, twiml, xml } from "./twilio.js";

const MAX_TURNS = 6;
const SAY_OPTS = 'voice="Polly.Aditi" language="en-IN"';

const findProspect = (s, id) => s.prospects.find((p) => p.id === id);
const say = (text) => `<Say ${SAY_OPTS}>${xml(text)}</Say>`;
const gather = (prospectId, text) =>
  `<Gather input="speech" language="en-IN" speechTimeout="auto" timeout="6" action="${xml(`${config.publicUrl}/webhooks/twilio/voice/turn?p=${prospectId}`)}" method="POST">${say(text)}</Gather>${say("I did not hear anything, so I will let you go. Goodbye.")}<Hangup/>`;

/** Prepares the call (the opening line is decided now, so it is ready the instant the person answers) and dials. */
export async function startCall(state, campaign, prospect) {
  const voiceAgent = state.agents.find((a) => a.id === "voice");
  const first = await engine.voiceTurn({ campaign, prospect, transcript: [], voiceAgent });
  prospect.voice = { transcript: [{ who: "sdr", text: first.say }], startedTs: Date.now(), harness: first.harness, engine: first.engine, done: false };
  const url = `${config.publicUrl}/webhooks/twilio/voice?p=${encodeURIComponent(prospect.id)}`;
  const statusUrl = `${config.publicUrl}/webhooks/twilio/voice/status?p=${encodeURIComponent(prospect.id)}`;
  return placeCall({ to: prospect.phone, url, statusUrl });
}

export function voiceStart(prospectId) {
  const p = findProspect(getState(), prospectId);
  if (!p || !p.voice) return twiml(say("Sorry, this call was not expected. Goodbye.") + "<Hangup/>");
  return twiml(gather(prospectId, p.voice.transcript[0].text));
}

export async function voiceTurn(prospectId, speech) {
  const s = getState();
  const p = findProspect(s, prospectId);
  const campaign = p && s.campaigns.find((c) => c.id === p.campaignId);
  if (!p || !p.voice || !campaign) return twiml(say("Goodbye.") + "<Hangup/>");
  const v = p.voice;
  v.transcript.push({ who: "person", text: String(speech || "").trim().slice(0, 500) || "(unclear)" });
  const spoken = v.transcript.filter((t) => t.who === "sdr").length;
  const voiceAgent = s.agents.find((a) => a.id === "voice");
  const next = await engine.voiceTurn({ campaign, prospect: p, transcript: v.transcript, voiceAgent });
  const end = next.end || spoken >= MAX_TURNS;
  v.transcript.push({ who: "sdr", text: next.say });
  v.outcome = end ? (next.end ? next.outcome : "interested") : "continue";
  v.summary = next.summary;
  if (end) v.done = true;
  await persistState();
  return twiml(end ? `${say(next.say)}<Hangup/>` : gather(prospectId, next.say));
}

/** The call is over (whichever way it ended): record what was said and hand the outcome to the rest of the SDR. */
export async function voiceEnd(prospectId) {
  const s = getState();
  const p = findProspect(s, prospectId);
  if (!p || !p.voice || p.voice.recorded) return;
  const campaign = s.campaigns.find((c) => c.id === p.campaignId);
  p.voice.recorded = true;
  const { completeCall } = await import("../scheduler.js"); // scheduler -> outreach -> dispatch -> here: imported late to avoid a cycle
  completeCall(s, campaign, p);
  await persistState();
}
