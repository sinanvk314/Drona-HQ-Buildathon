// Sales representatives (PS: assignable to one or more campaigns, with control over which reps can execute a
// campaign, whose identity is used for outreach, daily limits, working hours and channel availability).
//
// A campaign with reps assigned sends every touch as one of them: the least-loaded assigned rep who is active, works
// that channel, is inside their working hours and under their own daily limit. If the campaign has no reps assigned, it
// behaves as before (the campaign's own limits only). If every assigned rep is unavailable, outreach is held.
import { simDay, withinWorkingHours } from "./simTime.js";

/** Touches this rep sent during the current simulated day, across all campaigns. */
export function repTouchesToday(state, repId, now = Date.now()) {
  const today = simDay(now);
  let n = 0;
  for (const p of state.prospects) for (const t of p.touches || []) if (t.repId === repId && simDay(t.ts) === today) n += 1;
  return n;
}

const assignedReps = (state, campaign) => (campaign.repIds || []).map((id) => (state.reps || []).find((r) => r.id === id)).filter(Boolean);

/** Why a rep cannot send this touch right now, or null if they can. */
export function repBlocker(state, rep, channel, now = Date.now()) {
  if (rep.status !== "active") return "offboarded";
  if (channel && !rep.channels.includes(channel)) return `not on ${channel}`;
  if (!withinWorkingHours({ workingHours: rep.workingHours }, now)) return "outside their working hours";
  if (rep.dailyLimit > 0 && repTouchesToday(state, rep.id, now) >= rep.dailyLimit) return "at their daily limit";
  return null;
}

/**
 * The rep who sends this touch, or null. `preferId` keeps a prospect with the same rep across touches when that rep
 * can still send. `strict: false` ignores limits and hours (used when a human has already approved the message).
 */
export function pickRep(state, campaign, channel, { now = Date.now(), preferId = null, strict = true } = {}) {
  const reps = assignedReps(state, campaign);
  const usable = reps.filter((r) => (strict && !campaign.sandbox ? !repBlocker(state, r, channel, now) : r.status === "active"));
  if (!usable.length) return null;
  const preferred = usable.find((r) => r.id === preferId);
  if (preferred) return preferred;
  return usable.reduce((best, r) => (repTouchesToday(state, r.id, now) < repTouchesToday(state, best.id, now) ? r : best));
}

/** For outreachAllowed: a reason outreach is held for want of a rep, or null. */
export function noRepReason(state, campaign, channel, now = Date.now()) {
  const reps = assignedReps(state, campaign);
  if (!reps.length) return null; // no reps assigned: the campaign's own limits apply
  if (pickRep(state, campaign, channel, { now })) return null;
  if (reps.every((r) => r.status !== "active")) return "All reps assigned to this campaign are offboarded. Reassign it";
  const why = reps.filter((r) => r.status === "active").map((r) => `${r.name} ${repBlocker(state, r, channel, now)}`);
  return `No assigned rep can send on ${channel || "this channel"} right now (${why.join("; ")})`;
}

/** Campaigns that have reps assigned but none of them active: they cannot send until reassigned. */
export function campaignsNeedingReps(state) {
  return state.campaigns
    .filter((c) => c.status === "live" || c.status === "paused" || c.status === "draft")
    .filter((c) => (c.repIds || []).length > 0 && assignedReps(state, c).every((r) => r.status !== "active"))
    .map((c) => ({ id: c.id, name: c.name, status: c.status }));
}
