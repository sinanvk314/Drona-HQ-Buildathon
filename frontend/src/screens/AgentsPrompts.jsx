import React, { useEffect, useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { Badge, Tag } from "../components/ui/Badge.jsx";
import { Modal } from "../components/ui/Modal.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useApi } from "../hooks/useApi.js";
import {
  activatePromptVersion, getAgent, getAgents, requestPromptCompare, requestPromptRollback, savePromptVersion,
} from "../services/api.js";
import { timeAgo } from "../utils/format.js";

const DOT = { running: "var(--success)", paused: "var(--warning)", stopped: "var(--danger)" };

export default function AgentsPrompts() {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState("personalisation");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [modal, setModal] = useState(null);
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

  const openStub = async (title, fn) => {
    const r = await fn();
    setModal({ title, body: r.message });
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

            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div className="section-title" style={{ marginBottom: 0 }}>Active Prompt / Harness</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => openStub("Compare versions", requestPromptCompare)}>Compare</button>
                  <button type="button" className="btn btn-secondary" onClick={() => openStub("Roll back", requestPromptRollback)}>Roll Back</button>
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
                        }, "Saved as a new active version")
                      }
                    >
                      Save as New Version
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
                            onClick={() => guard(() => activatePromptVersion(agent.id, v.version), `${v.version} is now active`)}
                          >
                            Activate
                          </button>
                        )}
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
    </Shell>
  );
}
