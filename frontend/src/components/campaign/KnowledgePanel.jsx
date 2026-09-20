import React, { useState } from "react";
import Icon from "../ui/Icon.jsx";
import { Tag } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import { addCampaignSource, removeCampaignSource } from "../../services/api.js";
import AddSourceModal from "./AddSourceModal.jsx";
import { levelTitle } from "./ApprovalLevel.jsx";

const kb = (chars) => (chars ? `${Math.max(1, Math.round(chars / 1000))} KB` : "empty");

// A live campaign's knowledge base and approval policy. Sources are per campaign: agents in this
// campaign retrieve only from this list, so adding or removing a source changes their next decision.
export default function KnowledgePanel({ campaignId, sources, policy, cadence }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const add = async (values) => {
    await addCampaignSource(campaignId, values);
    setAdding(false);
    toast("Knowledge source added");
  };
  const remove = async (id) => {
    try {
      await removeCampaignSource(campaignId, id);
      toast("Knowledge source removed");
    } catch (e) {
      toast(e.message, "error");
    }
    setConfirming(null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Knowledge Base - {sources.length} {sources.length === 1 ? "source" : "sources"}</div>
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} stroke={2} />
            Add Source
          </button>
        </div>
        <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>Only this campaign's agents retrieve from these sources.</div>
        {sources.length === 0 && <div style={{ fontSize: 13, color: "var(--text-2)" }}>No sources yet. Agents have nothing to retrieve from.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sources.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8 }}>
              <Icon name="file" size={16} color="var(--text-3)" />
              <div style={{ flexGrow: 1, fontSize: 13 }}>{s.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{kb(s.chars)}</div>
              <Tag>{s.category}</Tag>
              {confirming === s.id ? (
                <>
                  <button type="button" className="link" style={{ fontSize: 12, color: "var(--danger)" }} onClick={() => remove(s.id)}>Remove</button>
                  <button type="button" className="link" style={{ fontSize: 12 }} onClick={() => setConfirming(null)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="link" aria-label={`Remove ${s.name}`} title="Remove this source" style={{ display: "flex", color: "var(--text-3)" }} onClick={() => setConfirming(s.id)}>
                  <Icon name="xcircle" size={16} stroke={1.7} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Approval Policy</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Level</span>
            <strong>{levelTitle(policy.level)}</strong>
          </div>
          {policy.level === "assisted" && (
            <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
              Auto-approves at fit {policy.autoMinScore}+ after {policy.autoAfterApproved} human approvals of that action.
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>First outreach</span><strong>{policy.firstOutreach ? "Needs approval" : "Automatic"}</strong></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Meeting time</span><strong>{policy.meetingTime ? "Needs approval" : "Automatic"}</strong></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Objections</span><strong>{policy.escalate ? "Human escalation" : "Agent handles"}</strong></div>
          {cadence && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Follow-up cadence</span><strong>{cadence.maxTouches} touches, {cadence.waitHours}h apart</strong></div>}
        </div>
      </div>

      {adding && <AddSourceModal onClose={() => setAdding(false)} onAdd={add} />}
    </div>
  );
}
