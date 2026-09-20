import React, { useState } from "react";
import { Tag } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import {
  activateCampaignSystemPrompt, saveCampaignSystemPrompt, setCampaignOverride, setCampaignPin,
} from "../../services/api.js";
import { timeAgo } from "../../utils/format.js";
import PromptDiff from "./PromptDiff.jsx";
import PromptInspector from "./PromptInspector.jsx";
import { useApi } from "../../hooks/useApi.js";
import { getPerformance } from "../../services/api.js";

// This campaign's prompts and harness (PS: prompt/harness management). Everything here belongs to this campaign
// alone: its own system prompt (versioned, roll-back-able), which shared-library version each agent runs, and its
// overrides. Changing something here never changes another campaign; the log says who changed what and when.
export default function CampaignPromptsPanel({ campaignId, prompts, editable }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [compareWith, setCompareWith] = useState(null);
  const [override, setOverride] = useState(null); // { agentId, text }
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState("");
  const [inspect, setInspect] = useState(null);
  const { data: perf } = useApi(() => getPerformance(), [], { pollMs: 60000 });
  const health = perf && perf.campaigns.find((c) => c.id === campaignId);
  const versionRows = perf ? (perf.agents.find((a) => a.id === "personalisation").rows || []).filter((r) => r.campaignId === campaignId) : [];

  const { system } = prompts;
  const active = system.versions.find((v) => v.version === system.active);

  const guard = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Prompts &amp; Harness</div>
      <div className="field-hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Belongs to this campaign only. Changing it never changes another campaign, and every change is recorded below.
      </div>

      {health && (health.status === "struggling" || health.status === "watch") && (
        <div style={{ background: "var(--danger-soft)", border: "1px solid #F2C7C7", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 12.5, lineHeight: 1.6 }}>
          <strong>This campaign is not going well.</strong>
          <ul style={{ margin: "4px 0 4px 16px", padding: 0 }}>{health.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {health.suggestion}{editable && !editing ? " Edit the campaign prompt below: every change is kept as a version you can compare and roll back." : ""}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Campaign system prompt · v{system.active}</div>
        {editable && !editing && (
          <button type="button" className="btn btn-secondary" onClick={() => { setText(active.text); setEditing(true); }}>Edit</button>
        )}
      </div>
      {editing ? (
        <>
          <textarea className="input" aria-label="Campaign system prompt" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <label className="field-label" htmlFor="pm-message" style={{ marginTop: 10 }}>What did you change, and why?</label>
          <input id="pm-message" className={`input ${messageError ? "error" : ""}`} value={message} placeholder="A short note for the history, like a commit message" onChange={(e) => { setMessage(e.target.value); setMessageError(""); }} />
          {messageError ? <div className="field-error">{messageError}</div> : <div className="field-hint">Kept with this version, so later you can see which change helped and which did not.</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                if (message.trim().length < 3) { setMessageError("Describe what you changed and why."); return; }
                await guard(async () => { await saveCampaignSystemPrompt(campaignId, text, message); setEditing(false); setMessage(""); }, "Saved as a new version of this campaign's prompt");
              }}
            >
              Save as v{Math.max(...system.versions.map((v) => v.version)) + 1}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7, background: "var(--neutral-soft)", whiteSpace: "pre-wrap" }}>
          {active.text}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10, fontSize: 12.5 }}>
        <span style={{ color: "var(--text-3)" }}>Versions:</span>
        {system.versions.map((v) => (
          <span key={v.version} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px" }}>
            <strong>v{v.version}</strong>
            <span style={{ color: "var(--text-3)" }}>{v.by} · {timeAgo(v.ts)}</span>
            <span style={{ color: "var(--text-2)" }}>{v.message ? `"${v.message}"` : "initial version"}</span>
            {(() => {
              const rows = versionRows.filter((r) => r.brief === `v${v.version}`);
              const measured = rows.reduce((t, r) => t + r.measured, 0);
              const won = rows.reduce((t, r) => t + r.succeeded, 0);
              return measured ? <span title="Personalisation: opening messages that got a reply" style={{ color: "var(--text-3)" }}>{Math.round((won / measured) * 100)}% replied ({won}/{measured})</span> : null;
            })()}
            {v.version === system.active ? (
              <Tag tone="accent">active</Tag>
            ) : (
              <>
                <button type="button" className="link" onClick={() => setCompareWith(compareWith === v.version ? null : v.version)}>
                  {compareWith === v.version ? "Hide changes" : "Compare"}
                </button>
                {editable && (
                  <button type="button" className="link" onClick={() => guard(() => activateCampaignSystemPrompt(campaignId, v.version), `Rolled back to v${v.version}`)}>
                    Make active
                  </button>
                )}
              </>
            )}
          </span>
        ))}
      </div>
      {compareWith && (
        <div style={{ marginTop: 10 }}>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 6 }}>v{compareWith} → v{system.active} (active): green = added, red = removed</div>
          <PromptDiff from={system.versions.find((v) => v.version === compareWith).text} to={active.text} />
        </div>
      )}

      <div className="section-title" style={{ marginTop: 20, marginBottom: 8 }}>Agent prompts this campaign runs</div>
      <table>
        <thead>
          <tr><th>Agent</th><th>Library version</th><th>This campaign's extra instruction</th></tr>
        </thead>
        <tbody>
          {prompts.agents.map((a) => (
            <tr key={a.agentId}>
              <td>{a.title}</td>
              <td>
                <select
                  className="input"
                  aria-label={`${a.title} version`}
                  style={{ width: 96, padding: "4px 8px" }}
                  value={a.pinned}
                  disabled={!editable}
                  onChange={(e) => guard(() => setCampaignPin(campaignId, a.agentId, e.target.value), `${a.title} now runs ${e.target.value} in this campaign only`)}
                >
                  {a.versions.map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}
                </select>
                <button type="button" className="link" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setInspect({ agentId: a.agentId })}>View prompt</button>
                {a.pinned !== a.latest && <span style={{ marginLeft: 8, fontSize: 11.5, color: "var(--text-3)" }}>library default is {a.latest}</span>}
              </td>
              <td>
                {override && override.agentId === a.agentId ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="input" aria-label={`${a.title} instruction`} value={override.text} onChange={(e) => setOverride({ ...override, text: e.target.value })} />
                    <button type="button" className="btn btn-primary" onClick={() => guard(async () => { await setCampaignOverride(campaignId, a.agentId, override.text); setOverride(null); }, "Instruction saved for this campaign")}>Save</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setOverride(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ color: a.override ? "var(--text-2)" : "var(--text-3)", fontStyle: a.override ? "italic" : "normal" }}>
                      {a.override ? `"${a.override.text}"` : "None"}
                    </span>
                    {editable && (
                      <button type="button" className="link" onClick={() => setOverride({ agentId: a.agentId, text: a.override ? a.override.text : "" })}>
                        {a.override ? "Edit" : "Add"}
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-title" style={{ marginTop: 20, marginBottom: 6 }}>Who changed what</div>
      {prompts.log.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>No prompt changes yet.</div>}
      {prompts.log.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "5px 0", borderBottom: i === prompts.log.length - 1 ? "none" : "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600, width: 90 }}>{l.by}</span>
          <span style={{ flexGrow: 1, color: "var(--text-2)" }}>{l.text}</span>
          <span style={{ color: "var(--text-3)" }}>{timeAgo(l.ts)}</span>
        </div>
      ))}
      {inspect && <PromptInspector campaignId={campaignId} agentId={inspect.agentId} harness={inspect.harness} onClose={() => setInspect(null)} />}
    </div>
  );
}
