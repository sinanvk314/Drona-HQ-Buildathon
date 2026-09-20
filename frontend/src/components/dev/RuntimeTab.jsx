import React from "react";
import LoadState from "../ui/LoadState.jsx";
import { useApi } from "../../hooks/useApi.js";
import { getRuntime } from "../../services/api.js";

const Row = ({ k, v }) => (
  <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
    <div style={{ color: "var(--text-2)" }}>{k}</div>
    <div style={{ wordBreak: "break-word" }}>{v}</div>
  </div>
);
const yn = (b) => (b ? "Yes" : "No");
const show = (x) => (x && typeof x === "object" ? Object.entries(x).map(([k, val]) => `${k}: ${typeof val === "object" ? JSON.stringify(val) : val}`).join(" · ") : String(x));

// What is actually in force right now, so nothing about a run is a mystery.
export default function RuntimeTab() {
  const { data: r, error } = useApi(() => getRuntime(), []);
  if (!r) return <LoadState error={error} what="the runtime settings" />;
  return (
    <div className="card" style={{ padding: 22, maxWidth: 840 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Runtime</div>
      <div className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>What is in force on this server right now. These are set by environment variables, so change them in the host's settings (see the README).</div>
      <Row k="Engines" v={show(r.engines)} />
      <Row k="Gemini key set" v={yn(r.gemini.keyConfigured)} />
      <Row k="Gemini models" v={r.gemini.models} />
      <Row k="Gemini calls per minute" v={r.gemini.ratePerMinute} />
      <Row k="LLM calls today" v={`${r.llm.callsToday} of ${r.llm.dailyCap}${r.llm.capReached ? " (cap reached: the rule engine is answering)" : ""}`} />
      <Row k="Tokens in / out" v={`${r.llm.tokensIn} / ${r.llm.tokensOut}`} />
      <Row k="Estimated LLM cost" v={`$${Number(r.llm.estCostUsd).toFixed(4)}`} />
      <Row k="Embeddings" v={show(r.embeddings)} />
      <Row k="Clock" v={r.clock.note} />
      <Row k="Meeting time zone" v={`${r.meetings.timezone}, ${r.meetings.minutes}-minute meetings`} />
      <Row k="Hard limits enforced" v={yn(r.limitsEnforced)} />
      <Row k="Simulated reply chance" v={r.simulatedReplyChance} />
      <Row k="Scheduler interval" v={`${r.schedulerIntervalMs / 1000} s`} />
      <Row k="Sign-in required" v={yn(r.signInRequired)} />
    </div>
  );
}
