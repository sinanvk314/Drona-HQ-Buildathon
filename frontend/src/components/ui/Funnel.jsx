import React from "react";
import { fmt } from "../../utils/format.js";

const OPACITY = [1, 0.85, 0.68, 0.55, 0.42, 0.85, 1];

export default function Funnel({ stages, height = 100 }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div
      role="img"
      aria-label={`Funnel: ${stages.map((s) => `${s.label} ${fmt(s.value)}`).join(", ")}`}
      style={{ display: "flex", alignItems: "flex-end", gap: 6, height: height + 44 }}
    >
      {stages.map((s, i) => {
        const h = s.value > 0 ? Math.max(4, Math.round(height * Math.pow(s.value / max, 0.85))) : 2;
        return (
          <div
            key={s.key}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700 }}>{fmt(s.value)}</div>
            <div
              style={{
                width: "100%", height: h, borderRadius: "4px 4px 0 0", opacity: OPACITY[i],
                background: i >= 5 ? "var(--success)" : "var(--accent)",
              }}
            />
            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}
