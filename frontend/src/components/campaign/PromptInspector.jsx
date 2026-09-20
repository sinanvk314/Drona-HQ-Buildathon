import React from "react";
import { Modal } from "../ui/Modal.jsx";
import LoadState from "../ui/LoadState.jsx";
import { useApi } from "../../hooks/useApi.js";
import { inspectPrompt } from "../../services/api.js";

// The agent names the hand-off notes use, mapped to the agents they belong to.
export const AGENT_IDS = {
  "Research Agent": "research", "ICP Fitment Agent": "icp", "Outreach Strategy Agent": "strategy",
  "Personalisation Agent": "personalisation", "Conversation Agent": "conversation", "Follow-up Agent": "followup",
};

// The instructions an agent was given, in the order it received them. With a harness label it rebuilds the versions used
// at the time; without one it shows what the agent would receive right now.
export default function PromptInspector({ campaignId, agentId, harness, onClose }) {
  const { data, error } = useApi(() => inspectPrompt(campaignId, agentId, harness), [campaignId, agentId, harness], { pollMs: 0 });
  return (
    <Modal title={data ? `${data.agent}: the prompt it ran with` : "The prompt it ran with"} onClose={onClose} width={720}>
      {!data ? (
        <LoadState error={error} what="the prompt" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field-hint" style={{ marginTop: 0 }}>
            For "{data.campaign}"{harness ? `, rebuilt from the versions named ${harness}` : ", as it would be sent now"}. The agent receives these parts in order, joined into one instruction.
            {harness && !data.exact ? " That library version no longer exists, so the current one is shown." : ""}
          </div>
          {data.parts.map((p, i) => (
            <div key={i}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{i + 1}. {p.label}</div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.65, background: "var(--neutral-soft)", whiteSpace: "pre-wrap" }}>{p.text}</div>
            </div>
          ))}
          <div className="field-hint" style={{ marginTop: 0 }}>{data.fixed}</div>
        </div>
      )}
    </Modal>
  );
}
