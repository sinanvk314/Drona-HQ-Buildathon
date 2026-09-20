// Hard limits on outreach that no agent may override (PS: daily limits, working hours, contact frequency).
// They gate every new touch: an agent may propose one, but this decides whether it may go out now.
import { config } from "../config.js";
import { isRealCampaign, channelBlocker } from "./realMode.js";
import { hoursToMs, simClockLabel, simDay, withinWorkingHours } from "./simTime.js";
import { noRepReason } from "./reps.js";

const FREQUENCY_WINDOW_HOURS = 7 * 24;
const FREQUENCY_MAX_TOUCHES = 4;

/** Touches this campaign sent during the current simulated day. */
export function sentToday(state, campaign, now = Date.now()) {
  const today = simDay(now);
  let n = 0;
  for (const p of state.prospects) {
    if (p.campaignId !== campaign.id) continue;
    for (const t of p.touches || []) if (simDay(t.ts) === today) n += 1;
  }
  return n;
}

/** Touches to one person (matched by email) from ALL campaigns inside the frequency window. */
export function recentTouchesTo(state, prospect, now = Date.now()) {
  if (!prospect.email) return (prospect.touches || []).length;
  const since = now - hoursToMs(FREQUENCY_WINDOW_HOURS);
  let n = 0;
  for (const p of state.prospects) {
    if (!p.email || p.email.toLowerCase() !== prospect.email.toLowerCase()) continue;
    for (const t of p.touches || []) if (t.ts >= since) n += 1;
  }
  return n;
}

/** -> { ok, reason }. `reason` is written into the Decision Journal and shown on the campaign. */
export function outreachAllowed(state, campaign, prospect, now = Date.now(), channel = null) {
  // A sandbox is a person testing the SDR in real time: the simulated clock's working hours and limits would only get in the way.
  if (isRealCampaign(campaign) && channel) {
    const blocked = channelBlocker(channel);
    if (blocked) return { ok: false, reason: `Real ${channel} cannot be sent: ${blocked}` };
  }
  if (!config.enforceLimits || campaign.sandbox) return { ok: true };
  if (!withinWorkingHours(campaign, now)) {
    return { ok: false, reason: `Outside working hours (simulated time ${simClockLabel(now)}; window ${campaign.workingHours})` };
  }
  const limit = Number(campaign.dailyLimit) || 0;
  if (limit > 0 && sentToday(state, campaign, now) >= limit) {
    return { ok: false, reason: `Daily limit reached (${limit} touches today)` };
  }
  if (prospect && recentTouchesTo(state, prospect, now) >= FREQUENCY_MAX_TOUCHES) {
    return { ok: false, reason: `Contact frequency cap reached (${FREQUENCY_MAX_TOUCHES} touches in ${FREQUENCY_WINDOW_HOURS / 24} days)` };
  }
  const noRep = noRepReason(state, campaign, channel || (campaign.channels || [])[0], now);
  if (noRep) return { ok: false, reason: noRep };
  return { ok: true };
}
