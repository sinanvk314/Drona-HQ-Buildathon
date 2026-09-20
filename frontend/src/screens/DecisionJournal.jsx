import React, { useEffect, useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import Icon from "../components/ui/Icon.jsx";
import RichText from "../components/ui/RichText.jsx";
import { Badge, Tag } from "../components/ui/Badge.jsx";
import { useApi } from "../hooks/useApi.js";
import { getDecisionForProspect, getDecisions } from "../services/api.js";
import { clockLabel, timeShort } from "../utils/format.js";

const KIND_DOT = {
  qualified: "var(--accent)",
  blocked: "var(--danger)",
  meeting: "var(--success)",
  rejected: "var(--text-3)",
  enriched: "var(--text-3)",
  strategy: "var(--accent)",
};

// Who actually made the call. Matching (no LLM) versus judgment (an LLM) is the cost story, so it is shown.
const ENGINE_LABEL = {
  gemini: "Gemini",
  dronahq: "DronaHQ",
  llm: "Claude",
  rule: "Rule engine",
  "rule-shortcut": "Rule shortcut · no LLM call",
  "embedding-router": "Embedding router · no LLM call",
  "auto-approval": "Auto-approved by policy",
  policy: "Policy gate · no LLM call",
  error: "Failed step · retried",
};

function Gutter({ first, last, expanded, color }) {
  return (
    <div style={{ width: 14, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
      {expanded ? (
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 22 }} />
      ) : (
        <>
          <div style={{ width: 2, height: 8, background: first ? "transparent" : "var(--border)" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
        </>
      )}
      {!last && <div style={{ width: 2, flexGrow: 1, background: "var(--border)" }} />}
    </div>
  );
}

function ExpandedCard({ d, onCollapse }) {
  return (
    <div className="card" style={{ flexGrow: 1, padding: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Tag tone="accent">{d.agent}</Tag>
        <Tag>{d.harness}</Tag>
        {d.engine && <Tag tone={d.engine === "rule" ? undefined : "accent"}>{ENGINE_LABEL[d.engine] || d.engine}</Tag>}
        <div style={{ flexGrow: 1 }} />
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{clockLabel(d.ts)}</div>
        <button type="button" className="link" style={{ fontSize: 12, color: "var(--text-3)" }} onClick={onCollapse} aria-label="Collapse decision">
          Collapse
        </button>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{d.headline}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 16 }}>{d.campaignName}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div className="section-title" style={{ fontSize: 11, marginBottom: 8 }}>Prospect Evidence</div>
          <ul style={{ margin: "0 0 14px 0", paddingLeft: 16, listStyle: "disc", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>
            {d.evidence.map((e) => <li key={e}>{e}</li>)}
          </ul>
          {d.score != null && (
            <>
              <div className="section-title" style={{ fontSize: 11, marginBottom: 8 }}>ICP Fit Score</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flexGrow: 1, height: 8, background: "var(--neutral-soft)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${d.score}%`, height: "100%", background: d.score >= 70 ? "var(--success)" : "var(--warning)" }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{d.score} / 100</div>
              </div>
            </>
          )}
        </div>
        <div>
          <div className="section-title" style={{ fontSize: 11, marginBottom: 8 }}>Retrieved Knowledge (RAG)</div>
          <ul style={{ margin: "0 0 14px 0", paddingLeft: 16, listStyle: "disc", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>
            {d.retrieved.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <div className="section-title" style={{ fontSize: 11, marginBottom: 8 }}>Campaign Instructions (excerpt)</div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", fontStyle: "italic", background: "var(--neutral-soft)", padding: "10px 12px", borderRadius: 8 }}>
            "{d.instruction}"
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <Badge tone={d.conflict.ok ? "success" : "danger"}>
          <Icon name={d.conflict.ok ? "tick" : "warning"} size={11} stroke={2} />
          {d.conflict.text}
        </Badge>
        <div style={{ flexGrow: 1, fontSize: 12.5, color: "var(--text-2)" }}>
          <strong>Final action:</strong> {d.finalAction}
        </div>
      </div>
    </div>
  );
}

function CollapsedRow({ d, onExpand }) {
  const blocked = d.kind === "blocked";
  return (
    <button
      type="button"
      className="card"
      onClick={onExpand}
      aria-expanded="false"
      style={{
        flexGrow: 1, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
        fontFamily: "inherit", cursor: "pointer", color: "var(--text)",
        ...(blocked ? { borderColor: "#F3C9CF", background: "var(--danger-soft)" } : null),
      }}
    >
      {blocked && <Icon name="warning" size={16} stroke={1.7} color="var(--danger)" />}
      <div style={{ flexGrow: 1, fontSize: 13 }}><RichText text={d.summary} /></div>
      <Tag style={blocked ? { background: "#fff" } : undefined}>{d.agent}</Tag>
      <Tag style={blocked ? { background: "#fff" } : undefined}>{d.campaignTag}</Tag>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", width: 56, textAlign: "right" }}>{timeShort(d.ts)} ago</div>
      <Icon name="chevron" size={14} stroke={1.8} color="var(--text-3)" />
    </button>
  );
}

export default function DecisionJournal({ params }) {
  const [limit, setLimit] = useState(4);
  const [expandedId, setExpandedId] = useState(undefined); // undefined = default (newest); null = all collapsed
  const { data: focus } = useApi(
    () => (params.prospectId ? getDecisionForProspect(params.prospectId) : Promise.resolve(null)),
    [params.prospectId],
    { pollMs: 0 }
  );
  const { data } = useApi(() => getDecisions({ limit }), [limit]);

  useEffect(() => {
    if (focus) {
      setLimit((l) => Math.max(l, focus.index + 1));
      setExpandedId(focus.id);
    }
  }, [focus && focus.id]);

  const items = data ? data.items : [];
  const activeId = expandedId === undefined ? (items[0] ? items[0].id : null) : expandedId;

  return (
    <Shell active="agents" title="Decision Journal" searchPlaceholder="Filter by prospect, agent, campaign…">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>
          Every autonomous action, traced back to the evidence, the knowledge retrieved, and the exact prompt version that produced it.
        </div>

        {items.map((d, i) => {
          const expanded = d.id === activeId;
          return (
            <div key={d.id} style={{ display: "flex", gap: 16 }}>
              <Gutter first={i === 0} last={i === items.length - 1} expanded={expanded} color={KIND_DOT[d.kind] || "var(--accent)"} />
              {expanded ? (
                <ExpandedCard d={d} onCollapse={() => setExpandedId(null)} />
              ) : (
                <CollapsedRow d={d} onExpand={() => setExpandedId(d.id)} />
              )}
            </div>
          );
        })}

        {data && data.hasMore && (
          <button type="button" className="btn btn-secondary" style={{ alignSelf: "center", marginTop: 4 }} onClick={() => setLimit((l) => l + 3)}>
            Load earlier decisions
          </button>
        )}
      </div>
    </Shell>
  );
}
