import React from "react";
import { wordDiff } from "../../utils/diff.js";

const STYLE = {
  same: {},
  add: { background: "var(--success-soft)", color: "var(--success)", fontWeight: 600 },
  del: { background: "var(--danger-soft)", color: "var(--danger)", textDecoration: "line-through" },
};

// Two prompt texts compared word by word: additions in green, removals struck through in red.
export default function PromptDiff({ from, to }) {
  const segments = wordDiff(from, to);
  const changed = segments.some((s) => s.type !== "same");
  return (
    <div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.8, whiteSpace: "pre-wrap", background: "var(--neutral-soft)" }}>
        {segments.map((s, i) => <span key={i} style={STYLE[s.type]}>{s.text}</span>)}
      </div>
      {!changed && <div className="field-hint">The two versions are identical.</div>}
    </div>
  );
}
