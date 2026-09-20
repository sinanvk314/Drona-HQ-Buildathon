import React from "react";
import Toggle from "../ui/Toggle.jsx";
import { useToast } from "../ui/Toast.jsx";
import { setCampaignAgentEnabled } from "../../services/api.js";

// Agent pause for this campaign only (PS "levels of control"): one agent stops here while the rest of the campaign,
// and every other campaign, continues. An agent also needs to be on for the whole platform (Settings).
export default function CampaignAgentsPanel({ campaignId, agents, editable }) {
  const toast = useToast();
  const change = async (agent, on) => {
    try {
      await setCampaignAgentEnabled(campaignId, agent.id, on);
      toast(`${agent.title} ${on ? "turned on" : "paused"} in this campaign`);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Agents in this campaign</div>
      <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
        Pause one agent here without stopping the rest of the campaign.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 24px" }}>
        {agents.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "6px 0" }}>
            <div>
              <div>{a.title}</div>
              {!a.globallyEnabled && <div style={{ fontSize: 11.5, color: "var(--warning)" }}>Off for the whole platform</div>}
            </div>
            <Toggle on={a.enabled} label={`${a.title} in this campaign`} disabled={!editable} onChange={(on) => change(a, on)} />
          </div>
        ))}
      </div>
    </div>
  );
}
