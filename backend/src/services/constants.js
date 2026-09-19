// Ported 1:1 from the frontend's src/data/constants.js — must stay identical so
// funnel stages, channel keys and lifecycle transitions match the UI exactly.

export const STAGE_KEYS = [
  "discovered",
  "researched",
  "qualified",
  "contacted",
  "engaged",
  "meeting",
  "opportunity",
];

export const STAGE_LABELS = {
  discovered: "Discovered",
  researched: "Researched",
  qualified: "Qualified",
  contacted: "Contacted",
  engaged: "Engaged",
  meeting: "Meeting",
  opportunity: "Opportunity",
  rejected: "Rejected",
};

export const CHANNEL_KEYS = ["email", "linkedin", "sms", "voice"];

export const CHANNEL_LABELS = {
  email: "Email",
  linkedin: "LinkedIn",
  sms: "SMS",
  voice: "Voice",
};

export const CARD_CHANNEL_LABELS = {
  email: "Email",
  linkedin: "LinkedIn (sim.)",
  sms: "SMS",
  voice: "Voice (sim.)",
};

// Campaign lifecycle: Draft -> Live -> Paused -> Completed / Archived (PS Section 3).
export const CAMPAIGN_TRANSITIONS = {
  draft: ["live", "archived"],
  live: ["paused", "completed"],
  paused: ["live", "completed", "archived"],
  completed: ["archived"],
  archived: [],
};
