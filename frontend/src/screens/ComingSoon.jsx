import React from "react";
import Shell from "../components/shell/Shell.jsx";
import Icon from "../components/ui/Icon.jsx";

const COPY = {
  knowledge: {
    title: "Knowledge",
    icon: "book",
    text: "Manage the documents and sources your agents retrieve from. This area is coming soon. Until then, you can attach sources to a campaign when you create it.",
  },
  analytics: {
    title: "Analytics",
    icon: "bars",
    text: "Cross-campaign performance reporting is coming soon. Funnel and outcome metrics are available on each campaign dashboard.",
  },
};

export default function ComingSoon({ routeName }) {
  const c = COPY[routeName] || COPY.knowledge;
  return (
    <Shell active={routeName} title={c.title}>
      <div className="card" style={{ padding: 48, textAlign: "center", maxWidth: 640, margin: "40px auto" }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12, background: "var(--accent-soft)", color: "var(--accent-strong)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Icon name={c.icon} size={22} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 14 }}>{c.title} — coming soon</div>
        <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>{c.text}</div>
      </div>
    </Shell>
  );
}
