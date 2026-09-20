// The simulated clock behind follow-up waits, working hours and daily limits (see config.simMsPerHour).
// It is a pure function of the real clock, so it survives restarts and needs no stored state.
import { config } from "../config.js";

export const hoursToMs = (hours) => hours * config.simMsPerHour;
export const simDay = (now = Date.now()) => Math.floor(now / (24 * config.simMsPerHour));
export const simMinuteOfDay = (now = Date.now()) => Math.floor((now / config.simMsPerHour) * 60) % 1440;

export function simClockLabel(now = Date.now()) {
  const m = simMinuteOfDay(now);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function toMinutes(hour, minute, meridiem) {
  let h = Number(hour) % 24;
  if (meridiem) {
    h = Number(hour) % 12;
    if (/pm/i.test(meridiem)) h += 12;
  }
  return h * 60 + Number(minute || 0);
}

/** "9:00 AM – 6:00 PM, prospect local time" -> { start, end } in minutes, or null when it cannot be read. */
export function parseWorkingHours(text) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:–|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text || "");
  if (!m) return null;
  const end = toMinutes(m[4], m[5], m[6]);
  // "9 – 6 PM": a start with no AM/PM takes the opposite of the end's meridiem when that keeps it before the end.
  let start = toMinutes(m[1], m[2], m[3] || null);
  if (!m[3] && m[6] && start >= end) start = toMinutes(m[1], m[2], /pm/i.test(m[6]) ? "am" : "pm");
  return start === end ? null : { start, end };
}

/** True when the campaign may send right now on the simulated clock (or when its hours cannot be read). */
export function withinWorkingHours(campaign, now = Date.now()) {
  const w = parseWorkingHours(campaign.workingHours);
  if (!w) return true;
  const m = simMinuteOfDay(now);
  return w.start <= w.end ? m >= w.start && m < w.end : m >= w.start || m < w.end;
}
