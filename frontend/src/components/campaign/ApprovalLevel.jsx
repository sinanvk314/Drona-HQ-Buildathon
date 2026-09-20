import React from "react";

export const APPROVAL_LEVELS = [
  { key: "manual", title: "Manual", body: "Every action you tick above waits in the Approvals queue. Safest; best while a campaign is new." },
  { key: "assisted", title: "Assisted", body: "Once you have approved a few of an action type yourself, high-scoring prospects skip the queue." },
  { key: "autonomous", title: "Autonomous", body: "First outreach and meetings are sent without waiting for a human. Escalated objections still always need one." },
];

export const levelTitle = (key) => (APPROVAL_LEVELS.find((l) => l.key === key) || APPROVAL_LEVELS[0]).title;

// Approval level: when may a human be skipped? (The toggles above it say which actions need a human at all.)
export default function ApprovalLevel({ value, onChange }) {
  const level = value.level || "manual";
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Approval level</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {APPROVAL_LEVELS.map((l) => (
          <button
            key={l.key}
            type="button"
            aria-pressed={level === l.key}
            onClick={() => set({ level: l.key })}
            style={{
              textAlign: "left", fontFamily: "inherit", cursor: "pointer", padding: "10px 12px", borderRadius: 8,
              border: `1.5px solid ${level === l.key ? "var(--accent)" : "var(--border)"}`,
              background: level === l.key ? "var(--accent-soft)" : "#fff",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{l.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.45 }}>{l.body}</div>
          </button>
        ))}
      </div>
      {level === "assisted" && (
        <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center", fontSize: 12.5, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Auto-approve when fit score is at least
            <input type="number" min={50} max={100} className="input" style={{ width: 70 }} value={value.autoMinScore ?? 85} onChange={(e) => set({ autoMinScore: e.target.value })} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            and I have approved at least
            <input type="number" min={0} max={50} className="input" style={{ width: 70 }} value={value.autoAfterApproved ?? 3} onChange={(e) => set({ autoAfterApproved: e.target.value })} />
            of that action
          </label>
        </div>
      )}
    </div>
  );
}
