import React from "react";

const money = (n) => (n == null ? "n/a" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`);
const num = (n) => (n || 0).toLocaleString();

const Stat = ({ label, value, sub }) => (
  <div>
    <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
    <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{sub}</div>}
  </div>
);

// Cost and quota at a glance (PS: Cost & Performance, Measurement & Optimisation): how many decisions
// needed an LLM at all, versus being settled by matching (rules, embeddings) for free.
export default function EfficiencyPanel({ u }) {
  if (!u) return null;
  const a = u.avoided;
  const capPct = u.dailyCap ? Math.min(100, Math.round((u.llmCalls / u.dailyCap) * 100)) : 0;
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>AI Efficiency - Today</div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>Matching settles the clear-cut cases; the LLM only judges the close calls.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        <Stat label="LLM calls made" value={u.llmCalls} sub={`est. ${money(u.estCostUsd)} (estimate)`} />
        <Stat label="Decisions with no LLM call" value={u.avoidedTotal} sub={`${u.avoidedPct}% of decisions · saved ${money(u.estSavedUsd)}`} />
        <Stat label="Clear-cut ICP (rule shortcut)" value={a.icpShortcut} />
        <Stat label="Replies routed by embeddings" value={a.replyRouting} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <Stat label="Tokens (in / out)" value={`${num(u.tokensIn)} / ${num(u.tokensOut)}`} sub={u.avgLatencyMs ? `avg ${u.avgLatencyMs} ms per LLM decision` : "no LLM decisions yet"} />
        <Stat label="Cost per prospect scored" value={money(u.unitCosts?.perProspectScored)} sub={`${u.counts?.prospectsScored ?? 0} scored today`} />
        <Stat label="Cost per qualified lead" value={money(u.unitCosts?.perQualifiedLead)} sub={`${u.counts?.qualified ?? 0} qualified today`} />
        <Stat label="Cost per conversation" value={money(u.unitCosts?.perConversation)} sub="Conversation agent, per decision" />
      </div>
      {u.dailyCap > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)", marginBottom: 5 }}>
            <span>Daily LLM budget</span>
            <span>{u.llmCalls} / {u.dailyCap} calls{u.capReached ? " - cap reached, rule engine is deciding" : ""}</span>
          </div>
          <div style={{ height: 6, background: "var(--neutral-soft)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${capPct}%`, height: "100%", background: u.capReached ? "var(--danger)" : capPct > 80 ? "var(--warning)" : "var(--accent)" }} />
          </div>
        </div>
      )}
    </div>
  );
}
