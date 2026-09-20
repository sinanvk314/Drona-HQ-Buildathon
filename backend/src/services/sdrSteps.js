// The SDR, defined once. This list IS the pipeline: the scheduler runs these steps in this order, and the SDR Blueprint
// screen shows the same list, so what a manager reads is what actually runs. Adding a step here (with its runner in
// scheduler.js) adds it to both.
//
// One SDR, not seven bots: the steps share one memory (the prospect dossier, services/dossier.js), each reads all of it and
// leaves a hand-off note, and all of them work inside the same campaign brief, offer, persona, approval rules and limits.

export const SDR_STEPS = [
  {
    key: "discovery", agentId: "lead", title: "Lead Research",
    purpose: "Finds the people this campaign is aimed at and gathers the first facts about each.",
    reads: ["Campaign target (ICP, roles, region)", "Knowledge sources"],
    writes: ["A new prospect with its first facts in the dossier"],
  },
  {
    key: "research", agentId: "research", title: "Research",
    purpose: "Turns what is known about a prospect into a brief: facts, reasons they might care, and what is still unknown. Uses only known facts and never invents.",
    reads: ["What is already in the dossier", "Campaign offer and knowledge"],
    writes: ["Facts, reasons to reach out and gaps in the dossier, a hand-off note"],
  },
  {
    key: "icp", agentId: "icp", title: "ICP Fitment",
    purpose: "Judges whether each prospect fits the campaign's target and decides who qualifies.",
    reads: ["The whole dossier", "Qualification criteria", "Exclusion criteria"],
    writes: ["Qualified or rejected, a fit score, the evidence, a hand-off note"],
  },
  {
    key: "strategy", agentId: "strategy", title: "Outreach Strategy",
    purpose: "Plans the touch sequence: which channels, in what order, how long to wait.",
    reads: ["The whole dossier", "Enabled channels", "Touch limit"],
    writes: ["The prospect's plan, a hand-off note"],
  },
  {
    key: "personalisation", agentId: "personalisation", title: "Personalisation",
    purpose: "Writes the opening message for the planned channel, grounded in the dossier and the knowledge.",
    reads: ["The whole dossier", "The plan", "Campaign offer and knowledge", "Persona and tone"],
    writes: ["A draft for approval or auto-send, a hand-off note"],
  },
  {
    key: "conversation", agentId: "conversation", title: "Conversation",
    purpose: "Reads a reply and decides what it needs: a meeting, a human, or an answer.",
    reads: ["The whole dossier", "The conversation so far", "Knowledge"],
    writes: ["The next action and a drafted reply, a hand-off note"],
  },
  {
    key: "followup", agentId: "followup", title: "Follow-up",
    purpose: "Follows up when a prospect goes quiet, on the next channel in the plan, and stops at the limit.",
    reads: ["The whole dossier", "The plan and touches so far"],
    writes: ["The next touch or the reason the sequence ended, a hand-off note"],
  },
];
