import React, { useEffect, useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { Badge, Tag } from "../components/ui/Badge.jsx";
import { Modal } from "../components/ui/Modal.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useApi } from "../hooks/useApi.js";
import { useNav } from "../components/shell/NavContext.jsx";
import PromptDiff from "../components/campaign/PromptDiff.jsx";
import PromptInspector from "../components/campaign/PromptInspector.jsx";
import { activatePromptVersion, getAgent, getAgents, savePromptVersion } from "../services/api.js";
import { timeAgo } from "../utils/format.js";

const DOT = { running: "var(--success)", paused: "var(--warning)", stopped: "var(--danger)" };

export default function AgentsPrompts() {
  const toast = useToast();
  const { navigate } = useNav();
  const [compare, setCompare] = useState(null);
  const [selectedId, setSelectedId] = useState("personalisation");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [modal, setModal] = useState(null);
  const [previewCampaign, setPreviewCampaign] = useState("");
  const [inspect, setInspect] = useState(null);
  const { data: agents } = useApi(() => getAgents(), []);
  const { data: agent } = useApi(() => getAgent(selectedId), [selectedId]);

  useEffect(() => {
    setEditing(false);
  }, [selectedId]);

  const guard = async (fn, okMessage) => {
    try {
      await fn();
      if (okMessage) toast(okMessage);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <Shell active="agents" title="Agents & Prompts">
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          {(agents || []).map((a, i, arr) => (
            <button
              key={a.id}
              type="button"
              className={`agentrow ${a.id === selectedId ? "selected" : ""}`}
              aria-current={a.id === selectedId ? "true" : undefined}
              style={i === arr.length - 1 ? { borderBottom: "none" } : undefined}
              onClick={() => setSelectedId(a.id)}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: DOT[a.status], flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: a.id === selectedId ? 600 : 400 }}>{a.listName}</span>
            </button>
          ))}
        </div>

        {agent && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700 }}>{agent.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4, marginBottom: 12 }}>{agent.description}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {agent.scope.map((s) => <Tag key={s}>{s}</Tag>)}
              </div>
            </div>

            {agent.step && (
              <div className="card" style={{ padding: 20 }}>
                <div className="section-title">What this agent does in the SDR</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{agent.step.purpose}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>It reads</div>
                    <ul style={{ margin: "0 0 0 16px", padding: 0, fontSize: 12.5, lineHeight: 1.6 }}>{agent.step.reads.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>It writes</div>
                    <ul style={{ margin: "0 0 0 16px", padding: 0, fontSize: 12.5, lineHeight: 1.6 }}>{agent.step.writes.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                </div>
              </div>
            )}

            {agent.fixedPrompt && (
              <div className="card" style={{ padding: 20 }}>
                <div className="section-title">Fixed instruction (built into the platform)</div>
                <div className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                  Every run of this agent starts from this text: its role, its limits and the exact shape of what it must return. It is part of the code and is versioned with it, so it is shown here but edited by a developer, not from this page.
                  The campaign prompt and the library prompt below are added after it.
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7, background: "var(--neutral-soft)", whiteSpace: "pre-wrap" }}>{agent.fixedPrompt}</div>
              </div>
            )}

            <div className="card" style={{ padding: 20 }}>
              <div className="section-title">Preview: what this agent receives</div>
              <div className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>Pick a campaign to see the campaign prompt, the persona voice, this library prompt and that campaign's extra instruction, in the order they are joined.</div>
              <div style={{ display: "flex", gap: 10 }}>
                <select className="input" aria-label="Campaign to preview" style={{ maxWidth: 320 }} value={previewCampaign} onChange={(e) => setPreviewCampaign(e.target.value)}>
                  <option value="">Choose a campaign</option>
                  {agent.campaignPins.map((c) => <option key={c.campaignId} value={c.campaignId}>{c.campaignName} (runs {c.version})</option>)}
                </select>
                <button type="button" className="btn btn-secondary" disabled={!previewCampaign} onClick={() => setInspect({ campaignId: previewCampaign, agentId: agent.id })}>Show</button>
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div className="section-title" style={{ marginBottom: 0 }}>Library Default Prompt</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={agent.versions.length < 2}
                    onClick={() => setCompare({ a: agent.versions[1].version, b: agent.versions[0].version })}
                  >
                    Compare
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setEditText(agent.active.text);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
              <div className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                This is the shared library. New campaigns start from the default version; a running campaign stays on the version it is
                pinned to, so saving a version here never changes how any existing campaign behaves. Move a campaign to a version on the
                campaign's page.
              </div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10 }}>
                <strong>{agent.active.version}</strong> · Active
                {agent.active.activatedBy && ` · activated by ${agent.active.activatedBy} · ${timeAgo(agent.active.activatedTs)}`}
              </div>
              {editing ? (
                <>
                  <textarea className="input" aria-label="Prompt text" rows={8} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        guard(async () => {
                          await savePromptVersion(agent.id, editText);
                          setEditing(false);
                        }, "Saved as a new library version. No running campaign was changed.")
                      }
                    >
                      Save as New Library Version
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", fontSize: 12.5,
                    color: "var(--text-2)", lineHeight: 1.7, background: "var(--neutral-soft)", whiteSpace: "pre-wrap",
                  }}
                >
                  {agent.active.text}
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ padding: "16px 20px 4px 20px", fontSize: 13.5, fontWeight: 700 }}>Version History</div>
              <table>
                <thead>
                  <tr><th>Version</th><th>Changed by</th><th>Date</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {agent.versions.map((v) => (
                    <tr key={v.version}>
                      <td>{v.version}</td>
                      <td>{v.changedBy}</td>
                      <td>{v.date}</td>
                      <td>
                        <Badge tone={v.status === "active" ? "success" : "neutral"}>{v.status === "active" ? "Active" : "Archived"}</Badge>
                      </td>
                      <td>
                        {v.status === "active" ? (
                          <button type="button" className="link" onClick={() => setModal({ title: `${v.version} — prompt`, body: v.text })}>View</button>
                        ) : (
                          <button
                            type="button"
                            className="link"
                            onClick={() => guard(() => activatePromptVersion(agent.id, v.version), `${v.version} is now the library default. No running campaign was changed.`)}
                          >
                            Make default
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div style={{ padding: "16px 20px 4px 20px", fontSize: 13.5, fontWeight: 700 }}>Version Used by Each Campaign</div>
              <table>
                <thead>
                  <tr><th>Campaign</th><th>Pinned version</th><th></th></tr>
                </thead>
                <tbody>
                  {agent.campaignPins.map((c) => (
                    <tr key={c.campaignId}>
                      <td>{c.campaignName}</td>
                      <td>
                        {c.version} {c.version !== agent.active.version && <Tag>not the library default</Tag>}
                      </td>
                      <td>
                        <button type="button" className="link" onClick={() => navigate("campaignDetail", { id: c.campaignId })}>Manage on campaign page →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div style={{ padding: "16px 20px 4px 20px", fontSize: 13.5, fontWeight: 700 }}>Campaign-Level Instructions</div>
              {agent.overrides.length === 0 ? (
                <div style={{ padding: "8px 20px 20px", fontSize: 13, color: "var(--text-2)" }}>No campaign-level instructions for this agent.</div>
              ) : (
                <table>
                  <thead>
                    <tr><th>Campaign</th><th>Override</th><th>Last Edited</th></tr>
                  </thead>
                  <tbody>
                    {agent.overrides.map((o) => (
                      <tr key={o.campaignName}>
                        <td>{o.campaignName}</td>
                        <td style={{ color: "var(--text-2)", fontStyle: "italic" }}>"{o.text}"</td>
                        <td>{timeAgo(o.ts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {compare && agent && (
        <Modal
          title="Compare versions"
          onClose={() => setCompare(null)}
          width={700}
          footer={<button type="button" className="btn btn-secondary" onClick={() => setCompare(null)}>Close</button>}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, fontSize: 13 }}>
            <select className="input" aria-label="From version" style={{ width: 130 }} value={compare.a} onChange={(e) => setCompare({ ...compare, a: e.target.value })}>
              {agent.versions.map((v) => <option key={v.version}>{v.version}</option>)}
            </select>
            <span>→</span>
            <select className="input" aria-label="To version" style={{ width: 130 }} value={compare.b} onChange={(e) => setCompare({ ...compare, b: e.target.value })}>
              {agent.versions.map((v) => <option key={v.version}>{v.version}</option>)}
            </select>
            <span style={{ color: "var(--text-3)", fontSize: 12 }}>green = added, red = removed</span>
          </div>
          <PromptDiff
            from={(agent.versions.find((v) => v.version === compare.a) || {}).text}
            to={(agent.versions.find((v) => v.version === compare.b) || {}).text}
          />
        </Modal>
      )}

      {modal && (
        <Modal
          title={modal.title}
          onClose={() => setModal(null)}
          width={520}
          footer={<button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Close</button>}
        >
          <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{modal.body}</div>
        </Modal>
      )}
      {inspect && <PromptInspector campaignId={inspect.campaignId} agentId={inspect.agentId} onClose={() => setInspect(null)} />}
    </Shell>
  );
}
