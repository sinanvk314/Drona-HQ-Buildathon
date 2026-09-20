import React, { useEffect, useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import { StatusBadge } from "../components/ui/Badge.jsx";
import { useApi } from "../hooks/useApi.js";
import { getComparison } from "../services/api.js";

const money = (n) => (n == null ? "n/a" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`);
const pct = (n) => (n == null ? "n/a" : `${n}%`);
const num = (n) => (n == null ? "n/a" : n.toLocaleString());

// [label, field, format, better]: better = "high" | "low" decides which value is highlighted as the best.
const SECTIONS = [
  ["Results", [
    ["Prospects discovered", "prospects", num, "high"],
    ["Qualified", "qualified", num, "high"],
    ["Contacted", "contacted", num, "high"],
    ["Replies", "replies", num, "high"],
    ["Meetings booked", "meetings", num, "high"],
  ]],
  ["Rates", [
    ["Qualify rate", "qualifyRate", pct, "high"],
    ["Reply rate", "replyRate", pct, "high"],
    ["Meeting rate (of contacted)", "meetingRate", pct, "high"],
    ["Positive share of replies", "positiveRate", pct, "high"],
    ["Negative share of replies", "negativeRate", pct, "low"],
  ]],
  ["Cost and efficiency (today)", [
    ["LLM cost", "costTodayUsd", money, "low"],
    ["Cost per prospect scored", "costPerProspect", money, "low"],
    ["Cost per qualified lead", "costPerQualified", money, "low"],
    ["Decisions with no LLM call", "avoidedPct", pct, "high"],
    ["Failed steps", "failed", num, "low"],
  ]],
];

function bestIndex(rows, field, better) {
  const values = rows.map((r) => r[field]);
  const numeric = values.filter((v) => typeof v === "number");
  if (numeric.length < 2 || new Set(numeric).size < 2) return -1; // nothing to highlight if there is no difference
  const best = better === "high" ? Math.max(...numeric) : Math.min(...numeric);
  return values.indexOf(best);
}

// Campaigns side by side (PS: how do managers compare performance across campaigns, and a campaign against a variant of it).
export default function Compare({ params = {} }) {
  const { navigate } = useNav();
  const { data: all } = useApi(() => getComparison(), []);
  const [selected, setSelected] = useState(params.ids || null);

  useEffect(() => {
    if (all && !selected) setSelected(all.map((r) => r.id));
  }, [all]);

  if (!all || !selected) return <Shell active="analytics" title="Compare Campaigns"><div /></Shell>;
  const rows = all.filter((r) => selected.includes(r.id));
  const toggle = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Shell active="analytics" title="Compare Campaigns">
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Campaigns to compare</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {all.map((r) => (
              <button key={r.id} type="button" aria-pressed={selected.includes(r.id)} className={`chip ${selected.includes(r.id) ? "selected" : ""}`} onClick={() => toggle(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
          <div className="field-hint">
            To test a change, duplicate a campaign, change one thing in the copy (a prompt, the channels, the qualification criteria), launch both and compare them here.
            The best value in each row is highlighted.
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card" style={{ padding: 20, fontSize: 13.5, color: "var(--text-2)" }}>Select at least one campaign.</div>
        ) : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}></th>
                  {rows.map((r) => (
                    <th key={r.id} style={{ minWidth: 150 }}>
                      <button type="button" className="link" style={{ fontWeight: 700 }} onClick={() => navigate("campaignDetail", { id: r.id })}>{r.name}</button>
                      <div style={{ marginTop: 4 }}><StatusBadge status={r.status} /></div>
                      {r.copiedFrom && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>copy of {(all.find((x) => x.id === r.copiedFrom) || {}).name || "another campaign"}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map(([title, fields]) => (
                  <React.Fragment key={title}>
                    <tr><td colSpan={rows.length + 1} style={{ background: "var(--neutral-soft)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-3)" }}>{title}</td></tr>
                    {fields.map(([label, field, fmt, better]) => {
                      const best = bestIndex(rows, field, better);
                      return (
                        <tr key={field}>
                          <td>{label}</td>
                          {rows.map((r, i) => (
                            <td key={r.id} style={i === best ? { fontWeight: 700, color: "var(--success)" } : undefined}>
                              {fmt(r[field])}{i === best ? " ✓" : ""}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
