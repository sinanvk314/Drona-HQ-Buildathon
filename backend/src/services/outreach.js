// The one place a touch (a message going out to a prospect) is recorded, whether it was auto-approved by the
// scheduler or approved by a human. Keeping it here means the touch history, counters, funnel and the
// follow-up clock can never disagree.
import { hoursToMs } from "./simTime.js";

const CHANNEL_LABEL = { email: "Email", linkedin: "LinkedIn", sms: "SMS", voice: "Voice" };
export const channelLabel = (key) => CHANNEL_LABEL[key] || key;

/** Touches allowed for this prospect: the campaign limit, and never more than the planned sequence. */
export function touchLimit(campaign, prospect) {
  const max = (campaign.cadence && campaign.cadence.maxTouches) || 3;
  return prospect.plan ? Math.min(max, prospect.plan.sequence.length) : 1;
}

/**
 * @param kind "first" (the opening message) or "followup" (a cadence follow-up after silence)
 */
export function recordTouch(state, campaign, prospect, { channel, kind, subject = "", body = "", ts = Date.now() }) {
  const n = prospect.touches.length + 1;
  prospect.touches.push({ n, channel, kind, subject, ts });
  prospect.conversation.push({ dir: "out", text: body, when: "Today", channel });
  prospect.history.push({
    kind: channel === "email" ? "email" : "chat",
    text: kind === "first" ? `Opening ${channel} sent — "${subject}"` : `Follow-up ${n - 1} sent on ${channel}`,
    when: "Today",
  });

  if (kind === "first") {
    campaign.outreach[channel === "email" ? "emails" : "linkedin"] += 1;
    campaign.funnel.contacted += 1;
    prospect.stage = "contacted";
    prospect.channel = channelLabel(channel);
    prospect.lastAction = `Opening ${channel} sent, {ago}`;
  } else {
    campaign.outreach.followups += 1;
    prospect.lastAction = `Follow-up ${n - 1} sent on ${channel}, {ago}`;
  }
  prospect.nextStep = "Awaiting reply";
  prospect.lastTs = ts;

  // Schedule the next follow-up on the simulated clock, or stop the sequence.
  const waitHours = (prospect.plan && prospect.plan.waitHours) || (campaign.cadence && campaign.cadence.waitHours) || 72;
  prospect.nextTouchTs = n < touchLimit(campaign, prospect) ? ts + hoursToMs(waitHours) : null;
  return n;
}
