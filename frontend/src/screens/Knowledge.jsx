import React, { useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { Tag } from "../components/ui/Badge.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import LoadState from "../components/ui/LoadState.jsx";
import Icon from "../components/ui/Icon.jsx";
import { useApi } from "../hooks/useApi.js";
import { addKnowledge, attachKnowledge, detachKnowledge, getKnowledge, testKnowledge } from "../services/api.js";

const CATEGORIES = ["Product", "Pricing", "Compliance", "Case study", "Objection handling", "Other"];

function NewSource({ campaigns, onDone }) {
  const toast = useToast();
  const [v, setV] = useState({ name: "", category: "Product", content: "", campaignIds: [] });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setV((p) => ({ ...p, campaignIds: p.campaignIds.includes(id) ? p.campaignIds.filter((x) => x !== id) : [...p.campaignIds, id] }));
  const submit = async () => {
    setBusy(true);
    try {
      await addKnowledge(v);
      toast("Source added");
      onDone();
    } catch (e) {
      setErrors(e.fields || {});
      toast(e.message, "error");
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Add a knowledge source</div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label" htmlFor="k-name">Name</label>
          <input id="k-name" className={`input ${errors.name ? "error" : ""}`} value={v.name} placeholder="What this material is called" onChange={(e) => setV({ ...v, name: e.target.value })} />
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>
        <div>
          <label className="field-label" htmlFor="k-cat">Kind</label>
          <select id="k-cat" className="input" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="field-label" htmlFor="k-content">Text</label>
        <textarea id="k-content" className={`input ${errors.content ? "error" : ""}`} rows={6} value={v.content} placeholder="Paste the material agents may draw on. Separate topics with a blank line." onChange={(e) => setV({ ...v, content: e.target.value })} />
        {errors.content ? <div className="field-error">{errors.content}</div> : <div className="field-hint">Agents may only make claims that appear here, in the offer, or in another source of the campaign.</div>}
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="field-label">Give it to these campaigns</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {campaigns.map((c) => (
            <button key={c.id} type="button" aria-pressed={v.campaignIds.includes(c.id)} className={`chip ${v.campaignIds.includes(c.id) ? "selected" : ""}`} onClick={() => toggle(c.id)}>{c.name}</button>
          ))}
        </div>
        {errors.campaignIds && <div className="field-error">{errors.campaignIds}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>Add source</button>
        <button type="button" className="btn btn-secondary" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function Tester({ campaigns }) {
  const toast = useToast();
  const [campaignId, setCampaignId] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await testKnowledge({ campaignId, query }));
    } catch (e) {
      toast(e.message, "error");
    }
    setBusy(false);
  };
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Test retrieval</div>
      <div className="field-hint" style={{ marginTop: 2, marginBottom: 12 }}>
        Ask a question the way a prospect might and see which passages an agent in that campaign would be shown. If the right passage does not come up, the source needs clearer text.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr auto", gap: 10, alignItems: "end" }}>
        <div>
          <label className="field-label" htmlFor="kt-campaign">Campaign</label>
          <select id="kt-campaign" className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">Choose a campaign</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="kt-query">Question</label>
          <input id="kt-query" className="input" value={query} placeholder="What would someone ask?" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && campaignId && query.trim() && run()} />
        </div>
        <button type="button" className="btn btn-primary" disabled={!campaignId || !query.trim() || busy} onClick={run}>Test</button>
      </div>
      {result && (
        <div style={{ marginTop: 14 }}>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>{result.note}</div>
          {result.passages.map((p, i) => (
            <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 3 }}>{i + 1}. {p.label}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{p.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One place for every knowledge source: what exists, which campaigns use it, and what agents would retrieve from it.
export default function Knowledge() {
  const toast = useToast();
  const { data, error } = useApi(() => getKnowledge(), []);
  const [adding, setAdding] = useState(false);
  const [attaching, setAttaching] = useState(null);

  if (!data) return <Shell active="knowledge" title="Knowledge"><LoadState error={error} what="the knowledge library" /></Shell>;

  const guard = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <Shell active="knowledge" title="Knowledge">
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Knowledge library</div>
              <div className="field-hint" style={{ marginTop: 2 }}>
                Everything the agents may draw on, across all campaigns. Each campaign only ever searches its own sources, so giving a source to a campaign is what lets its agents use it.
              </div>
            </div>
            {!adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={12} stroke={2} /> Add source</button>}
          </div>
          {data.items.length === 0 && <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 12 }}>No knowledge yet. Add a source and give it to a campaign.</div>}
          {data.items.map((it) => {
            const lacking = data.campaigns.filter((c) => !it.campaigns.some((x) => x.id === c.id));
            return (
              <div key={it.key} style={{ borderTop: "1px solid var(--border)", padding: "12px 0", marginTop: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Icon name="file" size={16} color="var(--text-3)" />
                  <strong style={{ fontSize: 13.5 }}>{it.name}</strong>
                  <Tag>{it.category}</Tag>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{it.chars.toLocaleString()} characters</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>Used by</span>
                  {it.campaigns.map((c) => (
                    <span key={c.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px", fontSize: 12.5 }}>
                      {c.name}
                      <button type="button" className="link" style={{ color: "var(--text-3)", fontSize: 12 }} aria-label={`Remove from ${c.name}`} onClick={() => guard(() => detachKnowledge({ campaignId: c.id, sourceId: c.sourceId }), `Removed from ${c.name}`)}>remove</button>
                    </span>
                  ))}
                  {lacking.length > 0 && (
                    attaching === it.key ? (
                      <select className="input" style={{ width: 200, padding: "4px 8px" }} aria-label="Give to a campaign" defaultValue="" onChange={(e) => e.target.value && guard(async () => { await attachKnowledge({ fromCampaignId: it.campaigns[0].id, sourceId: it.campaigns[0].sourceId, toCampaignIds: [e.target.value] }); setAttaching(null); }, "Given to the campaign")}>
                        <option value="">Choose a campaign</option>
                        {lacking.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <button type="button" className="chip dashed" onClick={() => setAttaching(it.key)}>+ Give to a campaign</button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {adding && <NewSource campaigns={data.campaigns} onDone={() => setAdding(false)} />}
        <Tester campaigns={data.campaigns} />
      </div>
    </Shell>
  );
}
