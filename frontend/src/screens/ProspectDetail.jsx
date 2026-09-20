import React, { useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import Icon from "../components/ui/Icon.jsx";
import { StageBadge, Tag, Badge } from "../components/ui/Badge.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useApi } from "../hooks/useApi.js";
import { decideApproval, editApproval, getProspect } from "../services/api.js";
import { initials, timeAgo } from "../utils/format.js";
import PromptInspector, { AGENT_IDS } from "../components/campaign/PromptInspector.jsx";

const CARD = { padding: 20 };
const ringColor = (s) => (s >= 80 ? "var(--success)" : s >= 60 ? "var(--warning)" : "var(--danger)");
const QUAL_TONE = { Qualified: "success", Rejected: "danger", Pending: "neutral" };

export default function ProspectDetail({ params }) {
  const { navigate } = useNav();
  const toast = useToast();
  const { data: p, error } = useApi(() => getProspect(params.id), [params.id]);
  const [editing, setEditing] = useState(false);
  const [inspect, setInspect] = useState(null);
  const [editText, setEditText] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  if (!p) {
    return (
      <Shell active="prospects" title="Prospect">
        {error && <div className="card" style={CARD}>{error}</div>}
      </Shell>
    );
  }

  const crumbs = [
    { label: p.campaign ? p.campaign.name : "Campaigns", onClick: () => (p.campaign ? navigate("campaignDetail", { id: p.campaign.id }) : navigate("campaigns")) },
    { label: "Prospects", onClick: () => navigate("prospects") },
  ];
  const ap = p.approval;
  const pending = ap && ap.status === "pending";

  const run = async (fn, okMessage) => {
    try {
      await fn();
      if (okMessage) toast(okMessage);
      setEditing(false);
      setRejecting(false);
      setReason("");
      setReasonError(false);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const approve = () =>
    run(async () => {
      if (editing) await editApproval(ap.id, { nextActionText: editText });
      await decideApproval(ap.id, { action: "approve" });
    }, "Approved");

  const confirmReject = () => {
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    run(() => decideApproval(ap.id, { action: "reject", reason }), "Rejected");
  };

  const openJournal = () => navigate("journal", { prospectId: p.id });

  return (
    <Shell active="prospects" title={p.name} crumbs={crumbs} badge={<StageBadge stage={p.stage} />}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={CARD}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div
                style={{
                  width: 44, height: 44, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-strong)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15,
                }}
              >
                {initials(p.name)}
              </div>
              <div>
                <div style={{ fontSize: 15.5, fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{p.title}, {p.company}</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14, fontSize: 12.5, color: "var(--text-2)" }}>
              <div>{p.email}</div>
              <div>{p.city}</div>
              {p.linkedin && <div style={{ color: "var(--accent-strong)", fontWeight: 600 }}>{p.linkedin} ↗</div>}
            </div>
          </div>

          <div className="card" style={CARD}>
            <div className="section-title">Company</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{p.company}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3 }}>
              {p.industry} · {p.size} · {p.funding}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {p.tech.map((t) => <Tag key={t}>{t}</Tag>)}
            </div>
          </div>

          <div className="card" style={CARD}>
            <div className="section-title">ICP Fit Score</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  width: 64, height: 64, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center",
                  justifyContent: "center", fontWeight: 700, fontSize: 16,
                  border: `6px solid ${p.fit == null ? "var(--border-strong)" : ringColor(p.fit)}`,
                }}
                aria-label={p.fit == null ? "Not scored yet" : `ICP fit score ${p.fit}`}
              >
                {p.fit == null ? "-" : p.fit}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, listStyle: "disc", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>
                {p.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          </div>

          <div className="card" style={CARD}>
            <div className="section-title">Qualification Decision</div>
            <Badge tone={QUAL_TONE[p.qual.status] || "neutral"} style={{ marginBottom: 8 }}>{p.qual.status}</Badge>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{p.qual.reasoning}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 10 }}>
              Decided by {p.qual.agent} · {p.qual.harness} · {timeAgo(p.qual.ts)} ·{" "}
              <button type="button" className="link" onClick={openJournal}>View in Decision Journal →</button>
            </div>
          </div>

          <div className="card" style={CARD}>
            <div className="section-title">Evidence &amp; Signals</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {p.evidence.map((e) => <Tag key={e} style={{ width: "fit-content" }}>{e}</Tag>)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={CARD}>
            <div className="section-title">Dossier: the SDR's shared memory</div>
            {(!p.dossier || (p.dossier.facts.length === 0 && p.dossier.notes.length === 0)) && (
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>Nothing recorded yet. Each step adds a hand-off note as it acts.</div>
            )}
            {p.dossier && p.dossier.facts.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 6 }}>What is known</div>
                {p.dossier.facts.map((f, i) => (
                  <div key={i} style={{ fontSize: 12.5, padding: "3px 0", lineHeight: 1.5 }}>
                    {f.text} <span style={{ color: "var(--text-3)" }}>· {f.source}</span>
                  </div>
                ))}
              </div>
            )}
            {p.dossier && p.dossier.notes.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 6 }}>Hand-off notes</div>
                {p.dossier.notes.map((n, i) => (
                  <div key={i} style={{ fontSize: 12.5, padding: "5px 0", lineHeight: 1.5, borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <strong>{n.agent}</strong> <span style={{ color: "var(--text-3)" }}>{n.harness ? `· ${n.harness}` : ""}</span>
                    {AGENT_IDS[n.agent] && n.harness && n.harness !== "policy" && (
                      <button type="button" className="link" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setInspect({ agentId: AGENT_IDS[n.agent], harness: n.harness })}>View prompt</button>
                    )}
                    <div style={{ color: "var(--text-2)" }}>{n.note}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {p.plan && (
            <div className="card" style={CARD}>
              <div className="section-title">Outreach Plan</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {p.plan.sequence.map((ch, i) => (
                  <Tag key={i} tone={i < p.touches.length ? "accent" : undefined}>{i + 1}. {ch}{i < p.touches.length ? " · sent" : ""}</Tag>
                ))}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 10, lineHeight: 1.5 }}>{p.plan.reasoning}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8 }}>
                Planned by the Outreach Strategy Agent · {p.plan.engine} · {p.plan.waitHours}h (simulated) between touches
                {p.closedOut ? " · sequence closed: no reply" : p.nextTouchTs ? ` · next follow-up in about ${Math.max(0, Math.round((p.nextTouchTs - Date.now()) / 1000))}s` : ""}
              </div>
            </div>
          )}

          <div className="card" style={CARD}>
            <div className="section-title">Outreach History</div>
            {p.history.length === 0 && <div style={{ fontSize: 13, color: "var(--text-2)" }}>No outreach yet.</div>}
            {p.history.map((h, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 12, padding: "9px 0", alignItems: "flex-start", borderBottom: i === p.history.length - 1 ? "none" : "1px solid var(--border)" }}
              >
                <div
                  style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: h.kind === "email" ? "var(--accent-soft)" : "var(--neutral-soft)",
                    color: h.kind === "email" ? "var(--accent-strong)" : "var(--text-2)",
                  }}
                >
                  <Icon name={h.kind === "email" ? "mail" : "chat"} size={13} stroke={1.7} />
                </div>
                <div style={{ flexGrow: 1, fontSize: 12.5 }}>{h.text}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{h.when}</div>
              </div>
            ))}
          </div>

          <div className="card" style={CARD}>
            <div className="section-title">Current Conversation</div>
            {p.conversation.length === 0 && <div style={{ fontSize: 13, color: "var(--text-2)" }}>No conversation yet.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {p.conversation.map((m, i) => {
                const out = m.dir === "out";
                return (
                  <div
                    key={i}
                    style={{
                      alignSelf: out ? "flex-end" : "flex-start", maxWidth: "78%", padding: "10px 14px", fontSize: 13, lineHeight: 1.5,
                      background: out ? "var(--accent)" : "var(--neutral-soft)", color: out ? "#fff" : "var(--text)",
                      borderRadius: out ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    }}
                  >
                    {m.text}
                    <div style={{ fontSize: 10.5, marginTop: 5, opacity: out ? 0.75 : 1, color: out ? "#fff" : "var(--text-3)" }}>{m.when}{m.channel ? ` · ${m.channel}` : ""}{out && m.sender ? ` · sent as ${m.sender}` : ""}{out ? (m.delivery ? (m.delivery.status === "sent" ? ` · really sent via ${m.delivery.provider}` : m.delivery.status === "failed" ? ` · NOT DELIVERED: ${m.delivery.error}` : " · sending…") : (m.channel === "voice" ? " · phone call" : " · simulated, not really sent")) : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card" style={{ ...CARD, background: "var(--accent-soft)", borderColor: "#C9DBFF" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Icon name="sparkle" size={16} stroke={1.7} color="var(--accent-strong)" />
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-strong)" }}>Next Recommended Action</div>
            </div>

            {!ap && <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>No action is recommended for this prospect right now.</div>}

            {ap && (
              <>
                {editing ? (
                  <textarea
                    className="input"
                    aria-label="Recommended action"
                    rows={3}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    style={{ marginBottom: 10 }}
                  />
                ) : (
                  <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.5, marginBottom: 6 }}>{ap.nextActionText}</div>
                )}
                <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 14 }}>
                  {ap.source} ·{" "}
                  {pending
                    ? "awaiting approval"
                    : ap.status === "approved"
                    ? `approved by ${ap.decidedBy} · ${timeAgo(ap.decidedTs)}`
                    : `rejected by ${ap.decidedBy} · ${timeAgo(ap.decidedTs)}`}
                </div>

                {!pending && ap.status === "rejected" && ap.reason && (
                  <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>Reason: {ap.reason}</div>
                )}

                {pending && (
                  <>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="btn btn-success" onClick={approve}>Approve</button>
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => run(() => editApproval(ap.id, { nextActionText: editText }), "Recommendation updated")}
                          >
                            Save
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setEditText(ap.nextActionText);
                            setEditing(true);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      <button type="button" className="btn btn-danger-outline" onClick={() => (rejecting ? confirmReject() : setRejecting(true))}>
                        {rejecting ? "Confirm Reject" : "Reject"}
                      </button>
                    </div>
                    {rejecting && (
                      <div style={{ marginTop: 12 }}>
                        <label className="field-label" htmlFor="reject-reason">Escalation reason (required to reject)</label>
                        <input
                          id="reject-reason"
                          className={`input ${reasonError ? "error" : ""}`}
                          value={reason}
                          onChange={(e) => {
                            setReason(e.target.value);
                            setReasonError(false);
                          }}
                          placeholder="e.g. Pricing needs manager sign-off before sharing externally"
                        />
                        {reasonError && <div className="field-error">Add a reason to reject this action.</div>}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {inspect && p.campaign && <PromptInspector campaignId={p.campaign.id} agentId={inspect.agentId} harness={inspect.harness} onClose={() => setInspect(null)} />}
    </Shell>
  );
}
