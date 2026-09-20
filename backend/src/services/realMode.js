// What "real" means. A campaign is real when its prospects come from real people entered by hand (sourcing "real"). Only a real
// campaign can send real email, SMS or calls; a sandbox never can. Sending also needs the switch on and each channel's
// credentials set, and unless REAL_AUTO_SEND is on every message to a real person waits for a human.
import { config } from "../config.js";

export const isRealCampaign = (c) => !!c && c.sourcing === "real" && !c.sandbox;

export const gmailReady = () => !!(config.gmail.clientId && config.gmail.clientSecret && config.gmail.refreshToken && config.gmail.sender);
export const smsReady = () => !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.smsFrom);
export const voiceReady = () => !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.voiceFrom && config.publicUrl);

/** Why this channel cannot really send right now, or null if it can. */
export function channelBlocker(channel) {
  if (!config.realSending) return "Real sending is switched off (set REAL_SENDING=on)";
  if (channel === "email") return gmailReady() ? null : "Gmail is not set up (GMAIL_* settings)";
  if (channel === "sms") return smsReady() ? null : "Twilio SMS is not set up (TWILIO_* settings)";
  if (channel === "voice") return voiceReady() ? null : "Voice needs Twilio and PUBLIC_URL to be set";
  return `${channel} cannot be sent for real: there is no way to send it`; // LinkedIn has no sending API here
}

/** Channels a real campaign can actually use right now. */
export const realChannels = (channels) => (channels || []).filter((k) => !channelBlocker(k));

/** A real message may only go to a real address or number, and to the allow-list when one is set. */
export function recipientBlocker(channel, prospect) {
  const to = channel === "email" ? prospect.email : prospect.phone;
  if (!to) return `No ${channel === "email" ? "email address" : "phone number"} for this person`;
  if (channel === "email" && /\.example$/i.test(to)) return "This is a made-up address, not a real one";
  if (config.realAllowlist.length && !config.realAllowlist.includes(String(to).toLowerCase())) return "The recipient is not on REAL_SEND_ALLOWLIST";
  return null;
}
