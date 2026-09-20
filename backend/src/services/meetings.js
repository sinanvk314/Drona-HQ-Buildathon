// Meeting scheduling: real dates and times (not the simulated clock), because a meeting is for people.
//
//   proposeSlots  picks a few free times inside the rep's working hours, on weekdays, in the campaign's time zone
//   bookMeeting   confirms one of them: a meeting record on the prospect and a calendar invite (.ics)
//   readReply     understands a prospect's answer to the proposed times (pick one, decline, or ask for another time)
//
// Times are computed in MEETING_TIMEZONE (default Asia/Kolkata). There is no calendar API yet: a booked meeting is a record
// plus a downloadable invite the rep opens in their own calendar.
import { config } from "../config.js";
import { parseWorkingHours } from "./simTime.js";

const TZ_ABBR = { "Asia/Kolkata": "IST", UTC: "UTC", "America/New_York": "ET", "America/Los_Angeles": "PT", "Europe/London": "UK time" };
const tz = () => config.meetingTimezone;

/** The offset (ms) of a time zone from UTC at a given moment. */
function offsetMs(zone, date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second) - date.getTime();
}

/** The real moment at which the wall clock in `zone` shows this date and time. */
function localToEpoch(zone, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - offsetMs(zone, new Date(guess));
}

function localDate(zone, epoch) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epoch));
  const m = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  return { y: m.year, mo: m.month, d: m.day };
}

export function formatSlot(startEpoch) {
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: tz(), weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(startEpoch));
  return `${label.replace(",", "")} ${TZ_ABBR[tz()] || tz()}`;
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** Confirmed meetings already on a rep's calendar, so two prospects are never booked into the same slot. */
function busyFor(state, repId) {
  return state.prospects.filter((p) => p.meeting && p.meeting.status === "confirmed" && p.meeting.repId === repId).map((p) => [p.meeting.chosen.start, p.meeting.chosen.end]);
}

/**
 * Up to `count` free slots on different days, inside the rep's working hours (or the campaign's), never on a weekend,
 * starting no sooner than `leadHours` from now. `exclude` are start times already offered.
 */
export function proposeSlots(state, { rep, campaign, count = 3, now = Date.now(), leadHours = 20, exclude = [] }) {
  const zone = tz();
  const window = parseWorkingHours(rep && rep.workingHours) || parseWorkingHours(campaign && campaign.workingHours) || { start: 9 * 60, end: 18 * 60 };
  const minutes = config.meetingMinutes;
  const busy = rep ? busyFor(state, rep.id) : [];
  const earliest = now + leadHours * 3600 * 1000;
  // Preferred start times of day, spread across the window: late morning, mid-afternoon, then early morning.
  const span = window.end - window.start - minutes;
  const preferred = [0.25, 0.7, 0.05, 0.5].map((f) => window.start + Math.max(0, Math.round((span * f) / 30) * 30));

  const slots = [];
  const { y, mo, d } = localDate(zone, now);
  for (let offset = 0; slots.length < count && offset < 21; offset++) {
    const day = new Date(Date.UTC(y, mo - 1, d + offset));
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const startMin of preferred) {
      const start = localToEpoch(zone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(startMin / 60), startMin % 60);
      const end = start + minutes * 60 * 1000;
      if (start < earliest || exclude.includes(start)) continue;
      if (busy.some(([bs, be]) => overlaps(start, end, bs, be))) continue;
      slots.push({ id: `s${slots.length + 1}`, start, end, label: formatSlot(start) });
      break; // one slot per day, so the options are genuinely different
    }
  }
  return slots;
}

export const slotsText = (slots) => slots.map((s, i) => `${i + 1}) ${s.label}`).join("\n");

/** Reads a reply to proposed times without a model: an ordinal, a day or time that matches one slot, a decline, or a counter-offer. */
export function readReplyRule(text, slots) {
  const t = String(text || "").toLowerCase();
  if (/(not interested|no thanks|no thank you|can'?t make|cannot make|don'?t have time|not a good time|maybe later|remove me|stop)/.test(t) && !/\b(works|sounds good|book)\b/.test(t)) {
    return { choice: -1, declined: true, alternative: "", reasoning: "The reply declines the meeting." };
  }
  const ordinal = /\b(first|1st|option 1|1\))\b/.test(t) ? 0 : /\b(second|2nd|option 2|2\))\b/.test(t) ? 1 : /\b(third|3rd|option 3|3\))\b/.test(t) ? 2 : -1;
  if (ordinal >= 0 && slots[ordinal]) return { choice: ordinal, declined: false, alternative: "", reasoning: `The reply picks option ${ordinal + 1}.` };

  // Does the reply name one of the offered times? A day alone is enough; if it names a clock time, that time must match too,
  // otherwise it is a counter-offer ("Tuesday at 4pm" when Tuesday 11 am was offered).
  const timeMentioned = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/.test(t);
  const facts = slots.map((s, i) => {
    const date = new Date(s.start);
    const dayName = new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "short" }).format(date).toLowerCase();
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: tz(), hour: "numeric", hour12: true }).format(date).toLowerCase().replace(/\s/g, "");
    const [, h, ampm] = /^(\d+)(am|pm)$/.exec(hour) || [];
    return {
      i,
      day: new RegExp(`\\b${dayName}\\w*\\b`).test(t),
      hour: Boolean(h) && new RegExp(`\\b${h}(:00)?\\s?${ampm}\\b`).test(t),
    };
  });
  const anyDay = facts.some((f) => f.day);
  const matches = facts.filter((f) => (timeMentioned ? f.hour && (f.day || !anyDay) : f.day));
  if (matches.length === 1) return { choice: matches[0].i, declined: false, alternative: "", reasoning: "The reply names one of the offered times." };
  if (slots.length === 1 && !timeMentioned && !anyDay && /\b(yes|works|sounds good|perfect|great|confirm|ok|okay)\b/.test(t)) return { choice: 0, declined: false, alternative: "", reasoning: "The reply accepts the only offered time." };

  const counter = /\b(mon|tue|wed|thu|fri|sat|sun)\w*|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\bnext week\b|\btomorrow\b/.test(t);
  return { choice: -1, declined: false, alternative: counter ? String(text).trim().slice(0, 200) : "", reasoning: counter ? "The reply asks for a different time." : "The reply does not choose a time." };
}

/** Escapes text for an .ics field. */
const esc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (epoch) => new Date(epoch).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildIcs({ uid, title, start, end, description = "", organiser, attendee }) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Autonomous SDR//Meeting//EN", "CALSCALE:GREGORIAN", "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTAMP:${icsTime(Date.now())}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(description)}`,
    organiser && organiser.email ? `ORGANIZER;CN=${esc(organiser.name)}:mailto:${organiser.email}` : null,
    attendee && attendee.email ? `ATTENDEE;CN=${esc(attendee.name)};RSVP=TRUE:mailto:${attendee.email}` : null,
    "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n") + "\r\n";
}

/** Confirms a slot: the meeting record (with its invite) goes on the prospect and the rep's calendar. */
export function bookMeeting(campaign, prospect, slot, rep) {
  const title = `${campaign.objective ? `${campaign.objective}: ` : "Intro call: "}${prospect.name} and ${rep ? rep.name : "our team"}`.slice(0, 140);
  const description = `Booked by the SDR for the "${campaign.name}" campaign.\nWith: ${prospect.name}, ${prospect.title || ""} at ${prospect.company}.`;
  prospect.meeting = {
    ...(prospect.meeting || {}), status: "confirmed", chosen: slot, title,
    repId: rep ? rep.id : null, repName: rep ? rep.name : null, bookedTs: Date.now(),
    ics: buildIcs({ uid: `${prospect.id}-${slot.start}@autonomous-sdr`, title, start: slot.start, end: slot.end, description, organiser: rep, attendee: prospect }),
  };
  return prospect.meeting;
}
