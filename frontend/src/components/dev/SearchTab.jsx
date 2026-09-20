import React, { useState } from "react";
import { Badge } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import { devSearch } from "../../services/api.js";

// Try the imitated people search on any audience. Nothing is saved: this is for judging how realistic the sourcing is.
export default function SearchTab() {
  const toast = useToast();
  const [audience, setAudience] = useState("");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setBusy(true);
    try {
      setResult(await devSearch({ audience, count }));
    } catch (e) {
      toast(e.message, "error");
    }
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Search playground</div>
        <div className="field-hint" style={{ marginTop: 2, marginBottom: 14 }}>
          Until a real data provider is connected, sourcing is done by an AI acting as a search tool: it invents realistic people for whatever audience you describe.
          Use this to check how believable the results are. The people are fictional and nothing here is saved.
        </div>
        <label className="field-label" htmlFor="dv-audience">Who should it find?</label>
        <textarea id="dv-audience" className="input" rows={3} value={audience} placeholder="Describe the audience in plain words" onChange={(e) => setAudience(e.target.value)} />
        <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 12 }}>
          <div style={{ width: 120 }}>
            <label className="field-label" htmlFor="dv-count">How many</label>
            <input id="dv-count" className="input" type="number" min={1} max={8} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || !audience.trim()} onClick={run}>{busy ? "Searching…" : "Search"}</button>
        </div>
      </div>

      {result && (
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{result.candidates.length} result{result.candidates.length === 1 ? "" : "s"}</div>
            <Badge tone="warning">{result.provider}</Badge>
            {result.engine && <Badge tone="neutral">{result.engine}</Badge>}
          </div>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>{result.note}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {result.candidates.map((c, i) => (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.name} <span style={{ fontWeight: 400, color: "var(--text-2)" }}>· {c.title}</span></div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                  {c.organisation}{c.industry ? ` · ${c.industry}` : ""}{c.size ? ` · ${c.size}` : ""}{c.location ? ` · ${c.location}` : ""}{c.email ? ` · ${c.email}` : ""}
                </div>
                {(c.facts || []).length > 0 && <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 12.5 }}>{c.facts.map((f, j) => <li key={j}>{f}</li>)}</ul>}
                {(c.attributes || []).length > 0 && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>{c.attributes.map((a) => `${a.key}: ${a.value}`).join(" · ")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
