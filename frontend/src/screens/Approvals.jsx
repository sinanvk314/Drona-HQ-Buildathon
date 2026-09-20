import React, { useEffect, useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import Icon from "../components/ui/Icon.jsx";
import { Badge, Tag } from "../components/ui/Badge.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useApi } from "../hooks/useApi.js";
import { decideApproval, editApproval, getApproval, getApprovals } from "../services/api.js";
import { initials, timeAgo } from "../utils/format.js";

export default function Approvals({ params }) {
  const toast = useToast();
  const { data: list } = useApi(() => getApprovals(), []);
  const [selectedId, setSelectedId] = useState(params.approvalId || null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const activeId = list ? (list.items.some((i) => i.id === selectedId) ? selectedId : list.items[0] ? list.items[0].id : null) : null;
  const { data: item } = useApi(() => (activeId ? getApproval(activeId) : Promise.resolve(null)), [activeId]);

  useEffect(() => {
    setEditing(false);
    setReason("");
    setReasonError(false);
    setRejecting(false);
  }, [activeId]);

  const count = list ? list.count : 0;
  const badge = list ? (
    count > 0 ? <Badge tone="warning">{count} pending</Badge> : <Badge tone="success">All clear</Badge>
  ) : null;

  const approve = async () => {
    try {
      if (editing) await editApproval(item.id, { draftBody: draftText });
      await decideApproval(item.id, { action: "approve" });
      toast("Approved");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const reject = async () => {
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    try {
      await decideApproval(item.id, { action: "reject", reason });
      toast("Rejected");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const saveEdit = async () => {
    try {
      await editApproval(item.id, { draftBody: draftText });
      setEditing(false);
      toast("Draft updated");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <Shell active="approvals" title="Approvals" badge={badge}>
      {list && list.count === 0 && (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>You're all caught up</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6 }}>No actions are waiting for approval right now.</div>
        </div>
      )}

      {list && list.count > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.8fr", gap: 20, alignItems: "start" }}>
          <div className="card" style={{ overflow: "hidden" }}>
            {list.items.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`approvalrow ${a.id === activeId ? "selected" : ""}`}
                aria-current={a.id === activeId ? "true" : undefined}
                onClick={() => setSelectedId(a.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                  <strong style={{ fontSize: 13.5 }}>{a.name}</strong>
                  <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{timeAgo(a.ts)}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-2)" }}>{a.company} · {a.campaignTag}</div>
                <Tag tone={a.tone === "danger" ? "danger" : undefined} style={{ width: "fit-content", ...(a.id === activeId && a.tone !== "danger" ? { background: "#fff" } : null) }}>
                  {a.tag}
                </Tag>
              </button>
            ))}
          </div>

          {item && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 44, height: 44, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-strong)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
                  }}
                >
                  {initials(item.name)}
                </div>
                <div style={{ flexGrow: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{item.name} - {item.company}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>{item.campaignName} · requested {timeAgo(item.requestedTs)}</div>
                </div>
                <Tag
                  tone={item.tagTone === "danger" ? "danger" : undefined}
                  style={item.tagTone === "danger" ? undefined : { background: "#fff", border: "1px solid var(--border-strong)" }}
                >
                  {item.tag}
                </Tag>
              </div>

              <div className="card" style={{ padding: "14px 18px", background: "var(--warning-soft)", borderColor: "#F3DDBB", display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name="info" size={17} stroke={1.7} color="var(--warning)" />
                <div style={{ fontSize: 13 }}>
                  This prospect's outreach is <strong>paused</strong> until you approve, edit, or reject this action.
                </div>
              </div>

              <div className="card" style={{ padding: 20 }}>
                <div className="section-title" style={{ marginBottom: 8 }}>AI Recommendation</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{item.recommendation.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{item.recommendation.body}</div>
              </div>

              {item.warnings && item.warnings.length > 0 && (
                <div className="card" style={{ padding: "14px 18px", background: "var(--danger-soft)", borderColor: "#F2C7C7" }}>
                  <div className="section-title" style={{ marginBottom: 6, color: "var(--danger)" }}>Grounding check failed</div>
                  <ul style={{ margin: "0 0 8px 0", paddingLeft: 16, listStyle: "disc", fontSize: 12.5, lineHeight: 1.6 }}>
                    {item.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                    This draft was not sent automatically. Edit it to remove the unsupported claim, or reject it.
                  </div>
                </div>
              )}

              <div className="card" style={{ padding: 20 }}>
                <div className="section-title" style={{ marginBottom: 8 }}>Draft Message</div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>{item.channel ? `Channel: ${item.channel} · ` : ""}Subject: {item.draft.subject}</div>
                  {editing ? (
                    <>
                      <textarea
                        className="input"
                        aria-label="Draft message"
                        rows={6}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button type="button" className="btn btn-primary" onClick={saveEdit}>Save Draft</button>
                        <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{item.draft.body}</div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn btn-success" style={{ flexGrow: 1 }} onClick={approve}>Approve &amp; Send</button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flexGrow: 1 }}
                  onClick={() => {
                    setDraftText(item.draft.body);
                    setEditing(true);
                  }}
                >
                  Edit Draft
                </button>
                <button type="button" className="btn btn-danger-outline" style={{ flexGrow: 1 }} onClick={() => setRejecting(true)}>Reject</button>
              </div>

              {rejecting && (
                <div className="card" style={{ padding: "16px 20px" }}>
                  <label htmlFor="rejection-reason" style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                    Why are you rejecting this?
                  </label>
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                    Required. Your reason is saved in the Decision Journal so the team can see why, and it shows what to fix in the prompts.
                  </div>
                  <input
                    id="rejection-reason"
                    autoFocus
                    className={`input ${reasonError ? "error" : ""}`}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setReasonError(false);
                    }}
                    placeholder="For example: the claim about pricing is not something we can promise"
                  />
                  {reasonError && <div className="field-error">Add a reason to reject this action.</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button type="button" className="btn btn-danger" onClick={reject}>Confirm rejection</button>
                    <button type="button" className="btn btn-secondary" onClick={() => { setRejecting(false); setReasonError(false); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
