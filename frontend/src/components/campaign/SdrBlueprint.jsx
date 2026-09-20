import React, { useState } from "react";
import { Tag } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import LoadState from "../ui/LoadState.jsx";
import { useApi } from "../../hooks/useApi.js";
import { getBlueprint, setCampaignPersona } from "../../services/api.js";

const LABEL = { fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const STATUS_TONE = { on: "success", simulated: "neutral", off: "danger", empty: "danger" };

// The complete definition of this campaign's SDR on one page (PS: one SDR, not five bots): its mission, voice, the steps
// it runs, its tools, its shared memory and its rules. The steps are the same list the scheduler executes.
export default function SdrBlueprint({ campaignId, editable }) {
  const toast = useToast();
  const { data: b, error } = useApi(() => getBlueprint(campaignId), [campaignId]);
  const [persona, setPersona] = useState(null);

  if (!b) return <LoadState error={error} what="the SDR blueprint" />;

  const save = async () => {
    try {
      await setCampaignPersona(campaignId, persona);
      setPersona(null);
      toast("Voice saved for this campaign. Every agent receives it from the next decision.");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="card" style={{ padding: 22 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>SDR Blueprint</div>
      <div className="field-hint" style={{ marginTop: 2, marginBottom: 16 }}>
        This campaign's SDR, defined in one place. It is one SDR working from one shared memory, not separate bots: each step reads the
        whole prospect dossier and leaves a hand-off note for the next.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 22 }}>
        <div>
          <div style={LABEL}>Mission</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div><strong>Objective:</strong> {b.mission.objective || "not set"}</div>
            <div><strong>Offer:</strong> {b.mission.offer || "not set"}</div>
            <div><strong>Target:</strong> {b.mission.target || "not set"}</div>
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={LABEL}>Voice</div>
            {editable && !persona && <button type="button" className="link" style={{ fontSize: 12 }} onClick={() => setPersona({ ...b.persona })}>Edit</button>}
          </div>
          {persona ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea className="input" rows={2} aria-label="Tone" placeholder="How the SDR should sound (tone, style, things to avoid)" value={persona.tone} onChange={(e) => setPersona({ ...persona, tone: e.target.value })} />
              <input className="input" aria-label="Sign-off" placeholder="How messages are signed off" value={persona.signOff} onChange={(e) => setPersona({ ...persona, signOff: e.target.value })} />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-primary" onClick={save}>Save</button>
                <button type="button" className="btn btn-secondary" onClick={() => setPersona(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: b.persona.tone || b.persona.signOff ? "var(--text)" : "var(--text-3)" }}>
              {b.persona.tone || b.persona.signOff ? `${b.persona.tone || "No tone set"}${b.persona.signOff ? ` · signs off as "${b.persona.signOff}"` : ""}` : "No voice set. The campaign brief alone shapes the tone."}
            </div>
          )}
        </div>
      </div>

      <div style={{ ...LABEL, marginTop: 20 }}>Pipeline: the steps this SDR runs, in order</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {b.steps.map((s, i) => (
          <div key={s.key} style={{ display: "grid", gridTemplateColumns: "26px 1.1fr 1.6fr 1.6fr 110px", gap: 12, alignItems: "start", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, opacity: s.enabled ? 1 : 0.55 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-strong)", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>prompt {s.pinned}</div>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              {s.purpose}
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>Reads: {s.reads.join("; ")}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
              <strong>Produces:</strong> {s.writes.join("; ")}
            </div>
            <div style={{ fontSize: 12, textAlign: "right" }}>
              <Tag tone={s.enabled ? "success" : "danger"}>{s.enabled ? "on" : s.globallyEnabled ? "paused here" : "off"}</Tag>
              <div style={{ color: "var(--text-3)", marginTop: 4 }}>{s.decisions} decisions{s.llmDecisions ? ` · ${s.llmDecisions} by LLM` : ""}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginTop: 20 }}>
        <div>
          <div style={LABEL}>Tools</div>
          {b.tools.map((t) => (
            <div key={t.name} style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "4px 0", alignItems: "baseline" }}>
              <Tag tone={STATUS_TONE[t.status]}>{t.status}</Tag>
              <span><strong>{t.name}.</strong> <span style={{ color: "var(--text-2)" }}>{t.note}</span></span>
            </div>
          ))}
          <div style={{ ...LABEL, marginTop: 14 }}>Shared memory</div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            {b.memory.description} {b.memory.prospectsWithDossier} prospects have a dossier so far: {b.memory.facts} facts and {b.memory.notes} hand-off notes.
          </div>
        </div>
        <div>
          <div style={LABEL}>Rules the SDR always follows</div>
          {b.policies.map((p) => (
            <div key={p.label} style={{ fontSize: 12.5, padding: "4px 0" }}>
              <strong>{p.label}:</strong> <span style={{ color: "var(--text-2)" }}>{p.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
