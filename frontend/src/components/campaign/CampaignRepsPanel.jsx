import React, { useState } from "react";
import { Tag } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import { setCampaignReps } from "../../services/api.js";

// Who this campaign sends as. Adding or removing a rep changes only this campaign.
export default function CampaignRepsPanel({ campaignId, reps, options, editable }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState([]);

  const start = () => {
    setChosen(reps.filter((r) => r.status === "active").map((r) => r.id));
    setEditing(true);
  };
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const save = async () => {
    try {
      await setCampaignReps(campaignId, chosen);
      setEditing(false);
      toast("Reps updated for this campaign");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Representatives</div>
        {editable && !editing && <button type="button" className="btn btn-secondary" onClick={start}>Change</button>}
      </div>
      <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
        Every touch in this campaign is sent as one of these reps, within their channels, hours and daily limit.
      </div>
      {editing ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {options.map((o) => (
              <button key={o.id} type="button" aria-pressed={chosen.includes(o.id)} className={`chip ${chosen.includes(o.id) ? "selected" : ""}`} onClick={() => toggle(o.id)}>{o.name}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={save}>Save</button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : reps.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>No reps assigned. The campaign sends under its own limits, with no named sender.</div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {reps.map((r) => (
            <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, opacity: r.status === "active" ? 1 : 0.55 }}>
              <strong>{r.name}</strong> {r.status !== "active" && <Tag tone="danger">offboarded</Tag>}
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{r.sentToday} touches today</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
