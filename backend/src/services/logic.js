// Shared business rules — ported 1:1 from the frontend's src/services/logic.js so the
// campaign lifecycle and scoping semantics stay identical between the mock and the real backend.
import { CAMPAIGN_TRANSITIONS } from "./constants.js";

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export const zeroFunnel = () => ({
  discovered: 0,
  researched: 0,
  qualified: 0,
  contacted: 0,
  engaged: 0,
  meeting: 0,
  opportunity: 0,
});

export function canTransition(from, to) {
  return (CAMPAIGN_TRANSITIONS[from] || []).includes(to);
}

// Scope rules (unchanged from the frontend mock):
//  - Campaign pause changes only that campaign's own status.
//  - The global kill switch is a separate flag; it never rewrites campaign statuses.
//  - Agent and channel toggles are independent of both.
export function effectiveStatus(state, campaign) {
  if (state.killSwitch.active && (campaign.status === "live" || campaign.status === "paused")) {
    return "stopped";
  }
  return campaign.status;
}

export function isRunning(state, campaign) {
  return campaign.status === "live" && !state.killSwitch.active;
}

export function addEvent(state, { campaignId = null, type, text, featured = true, ts = Date.now() }) {
  state.seq += 1;
  state.events.unshift({ id: `e${state.seq}`, campaignId, type, text, ts, featured });
  if (state.events.length > 300) state.events.length = 300;
}

export function agentStatus(state, agent) {
  if (state.killSwitch.active) return "stopped";
  return agent.enabled ? "running" : "paused";
}

export function channelOn(state, key) {
  return state.channels.some((c) => c.key === key && c.enabled);
}

export function agentOn(state, id) {
  return state.agents.some((a) => a.id === id && a.enabled) && !state.killSwitch.active;
}
