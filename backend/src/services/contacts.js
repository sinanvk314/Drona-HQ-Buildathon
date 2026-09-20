// Real contacts: people (or public figures) a person has entered by hand, with real contact details. A campaign whose data is
// "real" draws its prospects only from here. Nothing is searched for and nothing is invented: what is entered is what the SDR
// knows. The list is kept in the saved state (state.realContacts), so it needs no migration.
import { getState, persistState } from "../db/index.js";
import { currentUser } from "./auth.js";

const contactsOf = (s) => (s.realContacts ||= []);
const clean = (x, max) => String(x || "").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Digits with a leading +, or "" when it does not look like a phone number. */
export function normalisePhone(x) {
  const d = String(x || "").replace(/[^\d+]/g, "");
  return /^\+?\d{8,15}$/.test(d) ? (d.startsWith("+") ? d : `+${d}`) : "";
}

export function listContacts() {
  const s = getState();
  return contactsOf(s).map((c) => ({ ...c, usedIn: s.prospects.filter((p) => p.contactId === c.id).map((p) => ({ campaignId: p.campaignId, stage: p.stage })) }));
}

export async function addContact(v = {}) {
  const s = getState();
  const e = {};
  const email = clean(v.email, 160).toLowerCase();
  const phone = normalisePhone(v.phone);
  if (!clean(v.name, 120)) e.name = "Enter their name.";
  if (!email && !clean(v.phone, 40)) e.email = "Enter an email address or a phone number.";
  if (email && !EMAIL.test(email)) e.email = "That does not look like an email address.";
  else if (/\.example$/.test(email)) e.email = "This is a made-up address. Real contacts need a real one.";
  if (clean(v.phone, 40) && !phone) e.phone = "Enter the number with its country code, for example +91 98765 43210.";
  if (email && contactsOf(s).some((c) => c.email === email)) e.email = "This email is already in the list.";
  if (Object.keys(e).length) throw Object.assign(new Error("Please fix the highlighted fields."), { fields: e });
  s.seq += 1;
  const notes = (Array.isArray(v.notes) ? v.notes : String(v.notes || "").split(/\r?\n/)).map((x) => clean(x, 300)).filter(Boolean).slice(0, 20);
  const c = {
    id: `rc${s.seq}`, name: clean(v.name, 120), title: clean(v.title, 160), organisation: clean(v.organisation, 160), email, phone,
    kind: v.kind === "public figure" ? "public figure" : "person", notes, addedBy: currentUser(), ts: Date.now(),
  };
  contactsOf(s).push(c);
  await persistState();
  return c;
}

export async function removeContact(id) {
  const s = getState();
  const before = contactsOf(s).length;
  s.realContacts = contactsOf(s).filter((c) => c.id !== id);
  if (s.realContacts.length === before) throw new Error("Contact not found.");
  await persistState();
  return { id };
}

const tokens = (t) => (String(t || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);

/** Contacts not yet taken by this campaign, best match to its audience first (plain word overlap: nothing to pay for or wait on). */
export function rankContacts(s, campaign) {
  const taken = new Set(s.prospects.filter((p) => p.campaignId === campaign.id).map((p) => p.contactId));
  const wanted = new Set(tokens([campaign.icpText, campaign.objective, ...(campaign.personas || []), ...(campaign.geography || []), campaign.companyCriteria].join(" ")));
  return contactsOf(s)
    .filter((c) => !taken.has(c.id))
    .map((c) => {
      const own = tokens([c.title, c.organisation, c.kind, ...c.notes].join(" "));
      return { c, score: own.filter((t) => wanted.has(t)).length };
    })
    .sort((a, b) => b.score - a.score || a.c.ts - b.c.ts)
    .map((x) => x.c);
}

export const pickContacts = (s, campaign, n) => rankContacts(s, campaign).slice(0, n);
