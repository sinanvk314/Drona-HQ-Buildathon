// MOCK-ONLY: business rules that a backend will own later (lifecycle, scoping, simulated activity).
import { CAMPAIGN_TRANSITIONS } from "../data/constants.js";

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export const zeroFunnel = () => ({
  discovered: 0, researched: 0, qualified: 0, contacted: 0, engaged: 0, meeting: 0, opportunity: 0,
});

export function canTransition(from, to) {
  return (CAMPAIGN_TRANSITIONS[from] || []).includes(to);
}

// Scope rules:
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
  if (state.events.length > 200) state.events.length = 200;
}

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// MOCK-ONLY: simulates autonomous agent activity so the demo shows pause scoping.
// Only Live campaigns progress, and only when the global kill switch is off.
// Each stage is gated by the agent responsible for it; contacts also need an enabled channel.
export function tickState(state) {
  if (state.killSwitch.active) return false;
  const agentOn = (id) => state.agents.some((a) => a.id === id && a.enabled);
  const channelOn = (key) => state.channels.some((c) => c.key === key && c.enabled);

  state.tickCount = (state.tickCount || 0) + 1;
  let changed = false;
  const progressed = [];

  state.campaigns.forEach((c) => {
    if (c.status !== "live") return;
    const f = c.funnel;

    if (agentOn("lead")) {
      const d = rand(2, 5);
      f.discovered += d;
      f.researched = Math.min(f.discovered, f.researched + d - 1);
      changed = true;
      progressed.push(c);
    }
    if (agentOn("icp") && f.researched > f.qualified && Math.random() < 0.6) {
      f.qualified = Math.min(f.researched, f.qualified + rand(1, 2));
      changed = true;
    }
    const activeChannels = c.channels.filter(channelOn);
    if (agentOn("personalisation") && activeChannels.length && f.qualified > f.contacted && Math.random() < 0.6) {
      const n = rand(1, 2);
      f.contacted = Math.min(f.qualified, f.contacted + n);
      const key = activeChannels.includes("email") || activeChannels.includes("sms") ? "emails" : "linkedin";
      c.outreach[key] += n;
      changed = true;
    }
    if (agentOn("conversation") && f.contacted > f.engaged && Math.random() < 0.4) {
      f.engaged += 1;
      c.outreach.replies += 1;
      changed = true;
    }
  });

  if (changed && state.tickCount % 6 === 0 && progressed.length) {
    const c = progressed[rand(0, progressed.length - 1)];
    addEvent(state, {
      campaignId: c.id,
      type: "enrich",
      text: `Lead Research Agent enriched ${rand(3, 9)} new prospects for **${c.name}**`,
    });
  }
  return changed;
}
