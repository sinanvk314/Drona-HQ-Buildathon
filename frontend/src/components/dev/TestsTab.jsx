import React, { useState } from "react";
import { Badge } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import LoadState from "../ui/LoadState.jsx";
import { useApi } from "../../hooks/useApi.js";
import { addDevTest, getCommandCenter, getDevTests, removeDevTest, runDevTests } from "../../services/api.js";

const BLANK = { name: "", title: "", organisation: "", size: "", notes: "", expected: "Qualified", why: "" };

// Real-data tests: people you know the right answer for, run through a campaign's ICP agent to see how often it agrees.
export default function TestsTab() {
  const toast = useToast();
  const { data: tests, error } = useApi(() => getDevTests(), []);
  const { data: cc } = useApi(() => getCommandCenter(), [], { pollMs: 0 });
  const [v, setV] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));

  if (!tests) return <LoadState error={error} what="the real-data tests" />;
  const campaigns = cc ? cc.campaigns : [];

  const add = async () => {
    try {
      await addDevTest(v);
      setV(BLANK);
      setErrors({});
    } catch (e) {
      setErrors(e.fields || {});
      toast(e.message, "error");
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      setResult(await runDevTests(campaignId));
    } catch (e) {
      toast(e.message, "error");
    }
    setBusy(false);
  };
  const input = (label, key, placeholder, hint) => (
    <div>
      <label className="field-label" htmlFor={`t-${key}`}>{label}</label>
      <input id={`t-${key}`} className={`input ${errors[key] ? "error" : ""}`} value={v[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} />
      {errors[key] ? <div className="field-error">{errors[key]}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 940 }}>
      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Real-data tests</div>
        <div className="field-hint" style={{ marginTop: 2, marginBottom: 14 }}>
          Enter real people and say whether each should qualify for a campaign. Then run the campaign's ICP agent over all of them to see how often it agrees with you.
          This is the honest way to measure whether the criteria and the prompt are doing their job.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {input("Name", "name", "Full name")}
          {input("Role", "title", "Their job title")}
          {input("Organisation", "organisation", "Where they work")}
          {input("Size of the organisation", "size", "Employees, members or students", "Optional, but the criteria may depend on it.")}
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="field-label" htmlFor="t-notes">What is known about them</label>
          <textarea id="t-notes" className="input" rows={2} value={v.notes} placeholder="One fact per line" onChange={(e) => set("notes", e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <label className="field-label" htmlFor="t-expected">Should qualify?</label>
            <select id="t-expected" className={`input ${errors.expected ? "error" : ""}`} value={v.expected} onChange={(e) => set("expected", e.target.value)}>
              <option value="Qualified">Yes, qualified</option>
              <option value="Rejected">No, rejected</option>
            </select>
          </div>
          {input("Why (optional)", "why", "Your reasoning, for your own notes")}
        </div>
        <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={add}>Add person</button>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{tests.length} test{tests.length === 1 ? "" : "s"}</div>
        {tests.length === 0 && <div className="field-hint" style={{ marginTop: 0 }}>Nothing added yet.</div>}
        {tests.map((t) => (
          <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
            <div style={{ flexGrow: 1 }}>{t.name} <span style={{ color: "var(--text-2)" }}>· {t.title ? `${t.title}, ` : ""}{t.organisation}{t.size ? ` (${t.size})` : ""}</span></div>
            <Badge tone={t.expected === "Qualified" ? "success" : "neutral"}>{t.expected}</Badge>
            <button type="button" className="link" style={{ color: "var(--danger)", fontSize: 12.5 }} onClick={() => removeDevTest(t.id).catch((e) => toast(e.message, "error"))}>Remove</button>
          </div>
        ))}
        {tests.length > 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "end", marginTop: 14 }}>
            <div style={{ minWidth: 280 }}>
              <label className="field-label" htmlFor="t-campaign">Test against campaign</label>
              <select id="t-campaign" className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">Choose a campaign</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-primary" disabled={!campaignId || busy} onClick={run}>{busy ? "Running…" : "Run the ICP agent"}</button>
          </div>
        )}
      </div>

      {result && (
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>The agent agreed with you on {result.correct} of {result.total} ({Math.round(result.accuracy * 100)}%)</div>
          <div className="field-hint" style={{ marginTop: 2, marginBottom: 10 }}>Using the criteria and prompt of "{result.campaign}".</div>
          {result.results.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--border)", padding: "9px 0", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Badge tone={r.error ? "warning" : r.agrees ? "success" : "danger"}>{r.error ? "Error" : r.agrees ? "Agrees" : "Differs"}</Badge>
                <strong>{r.name}</strong><span style={{ color: "var(--text-2)" }}>· you said {r.expected}, it said {r.got || "nothing"}{r.score != null ? ` (score ${r.score})` : ""}{r.engine ? ` · ${r.engine}` : ""}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3 }}>{r.error || r.reasoning}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
