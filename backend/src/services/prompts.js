// Prompt / harness management (PS: "a change to one campaign's prompts must never silently change another's").
//
// Two layers, both versioned, both recorded with who and when:
//   - The agent prompt LIBRARY (state.agents[].versions): shared templates, one "active" version that new
//     campaigns start from. Saving or activating a library version never changes a running campaign.
//   - Each CAMPAIGN pins one library version per agent (campaign.promptPins) and has its own system prompt
//     (campaign.systemPrompt, versioned). A campaign changes behaviour only when someone changes ITS pin,
//     its system prompt or its override; the same action is recorded on the campaign.
//
// What an agent is actually given = the campaign system prompt + the campaign's pinned agent version
// (+ that campaign's override for the agent). The harness label written to every Decision Journal entry
// names all of it, so "which configuration produced this outcome" is always answerable.

export const activeVersionOf = (agent) => agent.versions.find((v) => v.status === "active") || agent.versions[0];

export function defaultSystemPrompt(c) {
  return (
    `You are an SDR working the "${c.name}" campaign. Objective: ${c.objective || "book qualified meetings"}. ` +
    `Audience: ${c.icpSummary || c.icpText || "the campaign's ICP"}. ` +
    `Stay within this campaign's approved knowledge, never contact anyone outside its ICP, and escalate anything you cannot answer from that knowledge.`
  );
}

/** Gives a campaign a pin for every agent it lacks one for, a system prompt and a change log. Never overwrites. Returns true if it added anything. */
export function initCampaignPrompts(campaign, agents, by = "system", now = Date.now()) {
  let changed = false;
  if (!campaign.promptPins) { campaign.promptPins = {}; changed = true; }
  for (const agent of agents) {
    if (!campaign.promptPins[agent.id]) { campaign.promptPins[agent.id] = activeVersionOf(agent).version; changed = true; }
  }
  if (!campaign.systemPrompt) {
    campaign.systemPrompt = { active: 1, versions: [{ version: 1, text: defaultSystemPrompt(campaign), by, ts: now }] };
    changed = true;
  }
  if (!campaign.promptLog) { campaign.promptLog = []; changed = true; }
  return changed;
}

/** The library version this campaign is pinned to for this agent (the library's active one if it has no pin). */
export function pinnedVersion(agent, campaign) {
  const pinned = campaign && campaign.promptPins && campaign.promptPins[agent.id];
  return agent.versions.find((v) => v.version === pinned) || activeVersionOf(agent);
}

export function activeSystemPrompt(campaign) {
  const sp = campaign && campaign.systemPrompt;
  if (!sp) return null;
  const v = sp.versions.find((x) => x.version === sp.active);
  return v ? { version: v.version, text: v.text } : null;
}

/** What an agent is given for this campaign: the composed instruction text, the harness label and any override. */
export function composePrompt(agent, campaign) {
  const version = pinnedVersion(agent, campaign);
  const system = activeSystemPrompt(campaign);
  const override = agent.overrides.find((o) => o.campaignId === campaign.id);
  return {
    text: [system && system.text, version ? version.text : ""].filter(Boolean).join("\n\n"),
    harness: `${version ? version.version : "v0"}${system ? ` + campaign prompt v${system.version}` : ""}`,
    override: override ? override.text : null,
  };
}

export function logPromptChange(campaign, by, text, now = Date.now()) {
  campaign.promptLog = campaign.promptLog || [];
  campaign.promptLog.unshift({ ts: now, by, text });
  if (campaign.promptLog.length > 50) campaign.promptLog.length = 50;
}
