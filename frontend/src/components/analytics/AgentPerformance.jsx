import React, { useState } from "react";
import { Badge } from "../ui/Badge.jsx";
import LoadState from "../ui/LoadState.jsx";
import { useNav } from "../shell/NavContext.jsx";
import { useApi } from "../../hooks/useApi.js";
import { getPerformance } from "../../services/api.js";

const TONE = { healthy: "success", watch: "warning", struggling: "danger", new: "neutral" };
const LABEL = { healthy: "Healthy", watch: "Watch", struggling: "Struggling", new: "Too early to say" };
const rate = (r) => (r === null || r === undefined ? "n/a" : `${r}%`);
const SMALL = 5;

// Is each campaign working, and how well does each agent do, by campaign and by the prompt version it ran with?
export default function AgentPerformance() {
  const { navigate } = useNav();
  const { data, error } = useApi(() => getPerformance(), []);
  const [open, setOpen] = useState(null);
  if (!data) return <LoadState error={error} what="agent performance" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>Campaign health</div>
        <div className="field-hint" style={{ marginTop: 2, marginBottom: 12 }}>{data.note}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.campaigns.length === 0 && <div style={{ fontSize: 13, color: "var(--text-2)" }}>No running campaigns yet.</div>}
          {data.campaigns.map((c) => (
            <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="link" style={{ fontWeight: 700, fontSize: 13.5 }} onClick={() => navigate("campaignDetail", { id: c.id })}>{c.name}</button>
                <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                  {c.prospects} prospects · {c.qualified} qualified · {c.contacted} contacted · {c.replies} replied ({rate(c.replyRate)}) · {c.meetings} meetings
                  {c.brief ? ` · brief v${c.brief.version}` : ""}
                </span>
              </div>
              {c.reasons.length > 0 && <ul style={{ margin: "8px 0 0 16px", padding: 0, fontSize: 12.5, color: "var(--text-2)" }}>{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              {c.suggestion && (
                <div style={{ marginTop: 8, fontSize: 12.5 }}>
                  <strong>What to try:</strong> {c.suggestion}{" "}
                  <button type="button" className="link" onClick={() => navigate("campaignDetail", { id: c.id })}>Open the campaign to change its brief</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>How each agent is doing</div>
        <div className="field-hint" style={{ marginTop: 2, marginBottom: 12 }}>
          Every agent records which prompt version it ran with, so its results can be split by campaign and by prompt version. Change a prompt, let it run, and compare the rows to see whether the change helped.
        </div>
        {data.agents.map((a) => (
          <div key={a.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 160, fontWeight: 700, fontSize: 13.5 }}>{a.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", flexGrow: 1 }}>{a.success}</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{rate(a.successRate)}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", width: 90 }}>{a.measured} measured</div>
              <button type="button" className="link" style={{ fontSize: 12.5 }} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Hide" : "By version"}</button>
            </div>
            {open === a.id && (
              <div style={{ marginTop: 8 }}>
                <div className="field-hint" style={{ marginTop: 0 }}>{a.how}</div>
                {a.rows.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 6 }}>Nothing measured yet.</div>
                ) : (
                  <table style={{ marginTop: 6 }}>
                    <thead>
                      <tr><th>Campaign</th><th>Agent prompt</th><th>Campaign prompt</th><th>Handled</th><th>Success</th><th>Needed a human</th><th>Used the LLM</th></tr>
                    </thead>
                    <tbody>
                      {a.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.campaign}</td>
                          <td>{r.agentVersion}</td>
                          <td>{r.brief || "n/a"}</td>
                          <td>{r.handled}</td>
                          <td style={{ fontWeight: 700 }}>{rate(r.successRate)} <span style={{ fontWeight: 400, color: "var(--text-3)" }}>({r.succeeded}/{r.measured}){r.measured < SMALL ? " small sample" : ""}</span></td>
                          <td>{rate(r.humanRate)}</td>
                          <td>{rate(r.llmShare)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
