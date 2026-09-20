import React from "react";
import { fmt } from "../../utils/format.js";
import { STAGE_COLOR } from "./Badge.jsx";

// "Opportunity" is not shown: nothing the SDR does produces one (a meeting is the last step it reaches), so the column was always
// empty and said nothing to a manager. Each bar uses the same colour as that stage's badge on the Prospects page.
export default function Funnel({ stages: all, height = 100 }) {
  const stages = all.filter((s) => s.key !== "opportunity");
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div
      role="img"
      aria-label={`Funnel: ${stages.map((s) => `${s.label} ${fmt(s.value)}`).join(", ")}`}
      style={{ display: "flex", alignItems: "flex-end", gap: 10, height: height + 52 }}
    >
      {stages.map((s) => {
        const h = s.value > 0 ? Math.max(4, Math.round(height * Math.pow(s.value / max, 0.85))) : 2;
        return (
          <div
            key={s.key}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{fmt(s.value)}</div>
            <div style={{ width: "100%", height: h, borderRadius: "4px 4px 0 0", background: STAGE_COLOR[s.key] || "var(--accent)" }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", textAlign: "center" }}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}
