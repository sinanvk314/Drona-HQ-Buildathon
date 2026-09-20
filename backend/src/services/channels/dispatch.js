// Turns a recorded message into a real one, for real campaigns only. recordTouch and recordReply (outreach.js) call this
// right after they record the message; for any other campaign it does nothing, so simulated campaigns behave exactly as before.
//
// Sending is asynchronous, so the record is annotated with a `delivery` that tells the truth: "sending", then "sent" (with the
// provider's id) or "failed" (with the reason). A failure is never hidden: it shows on the prospect and in the event feed.
import { persistState } from "../../db/index.js";
import { addEvent } from "../logic.js";
import { channelBlocker, isRealCampaign, recipientBlocker } from "../realMode.js";
import { sendEmail } from "./gmail.js";
import { sendSms } from "./twilio.js";
import { startCall } from "./voice.js";

const FOOTER = (who) => `\n\n--\n${who || "The team"}\nIf you would rather not hear from us, just reply "unsubscribe" and we will not contact you again.`;

function finish(state, campaign, prospect, entries, result) {
  for (const e of entries) e.delivery = result;
  if (result.status === "failed") {
    prospect.nextStep = `Not delivered: ${result.error}`;
    addEvent(state, { campaignId: campaign.id, type: "escalate", text: `A real message to **${prospect.name}** was **not delivered**: ${result.error}`, featured: true });
  }
}

/**
 * @param entries  the records to annotate (the touch and the conversation entry)
 * @param msg      { channel, subject, body, rep, kind }
 */
export function dispatch(state, campaign, prospect, msg, entries) {
  if (!isRealCampaign(campaign)) return;
  const { channel } = msg;
  for (const e of entries) e.delivery = { status: "sending" };
  const blocked = channelBlocker(channel) || recipientBlocker(channel, prospect);
  if (blocked) {
    finish(state, campaign, prospect, entries, { status: "failed", error: blocked });
    return;
  }
  (async () => {
    try {
      if (channel === "email") {
        const first = (prospect.touches[0] || {}).subject || "Hello";
        const attachments = [];
        const m = prospect.meeting;
        if (m && m.status === "confirmed" && m.ics && !m.inviteSent) {
          attachments.push({ name: "meeting.ics", type: "text/calendar; method=REQUEST", content: m.ics });
          m.inviteSent = true;
        }
        const r = await sendEmail({
          to: prospect.email, fromName: msg.rep && msg.rep.name, subject: msg.subject || `Re: ${first}`, body: msg.body + FOOTER(msg.rep && msg.rep.name),
          threadId: prospect.emailThread || undefined, inReplyTo: prospect.lastMessageId || undefined, attachments,
        });
        prospect.emailThread = prospect.emailThread || r.threadId;
        prospect.seenMessageIds = [...(prospect.seenMessageIds || []), r.id];
        finish(state, campaign, prospect, entries, { status: "sent", provider: "gmail", id: r.id, ts: Date.now() });
      } else if (channel === "sms") {
        const r = await sendSms({ to: prospect.phone, body: msg.body });
        finish(state, campaign, prospect, entries, { status: "sent", provider: "twilio", id: r.id, ts: Date.now() });
      } else if (channel === "voice") {
        const r = await startCall(state, campaign, prospect, msg.rep);
        for (const e of entries) if (e.text !== undefined) e.text = "Phone call placed. The transcript will appear here when it ends.";
        finish(state, campaign, prospect, entries, { status: "sent", provider: "twilio-voice", id: r.id, ts: Date.now() });
      } else {
        finish(state, campaign, prospect, entries, { status: "failed", error: `${channel} cannot be sent for real` });
      }
    } catch (e) {
      finish(state, campaign, prospect, entries, { status: "failed", error: e.message });
    }
    try { await persistState(); } catch { /* the next tick saves it */ }
  })();
}
