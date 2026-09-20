import React from "react";

const LABEL = { fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" };

const Stat = ({ label, value, tone }) => (
  <div>
    <div style={LABEL}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 3, color: tone || "var(--text)" }}>{value}</div>
  </div>
);

// Two cards from the PS's dashboard list: agent activity (in-flight / completed / failed workflows, pending approvals,
// escalations) and outcomes (how replies split, and conversion between stages).
export default function CampaignActivity({ activity, outcomes }) {
  const split = [
    ["Positive", outcomes.positive, "var(--success)"],
    ["Neutral", outcomes.neutral, "var(--text-3)"],
    ["Negative", outcomes.negative, "var(--danger)"],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Agent Activity</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          <Stat label="In flight" value={activity.inFlight} />
          <Stat label="Completed" value={activity.completed} />
          <Stat label="Failed" value={activity.failed} tone={activity.failed ? "var(--danger)" : undefined} />
          <Stat label="Pending approvals" value={activity.pendingApprovals} tone={activity.pendingApprovals ? "var(--warning)" : undefined} />
          <Stat label="Escalations open" value={activity.escalations} tone={activity.escalations ? "var(--danger)" : undefined} />
        </div>
        <div className="field-hint" style={{ marginBottom: 0 }}>
          A workflow is one agent step for one prospect. A failed step is contained to this campaign, recorded in the Decision Journal and retried.
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Outcomes</div>
        {outcomes.total === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>No replies yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--neutral-soft)", marginBottom: 10 }}>
              {split.map(([name, n, color]) => n > 0 && <div key={name} title={`${name}: ${n}`} style={{ width: `${(n / outcomes.total) * 100}%`, background: color }} />)}
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 12.5, marginBottom: 14 }}>
              {split.map(([name, n, color]) => (
                <span key={name}><span className="dot" style={{ background: color, marginRight: 5 }} />{name} <strong>{n}</strong></span>
              ))}
              <span style={{ color: "var(--text-3)" }}>{outcomes.positiveRate}% positive · {outcomes.negativeRate}% negative</span>
            </div>
          </>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, paddingTop: outcomes.total === 0 ? 12 : 0 }}>
          <Stat label="Qualify rate" value={`${outcomes.rates.qualify}%`} />
          <Stat label="Reply rate" value={`${outcomes.rates.reply}%`} />
          <Stat label="Meeting rate" value={`${outcomes.rates.meeting}%`} />
          <Stat label="Meeting → opp." value={`${outcomes.rates.opportunity}%`} />
        </div>
      </div>
    </div>
  );
}
