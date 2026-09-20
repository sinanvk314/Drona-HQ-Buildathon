import React from "react";
import Icon from "../ui/Icon.jsx";
import { useNav } from "./NavContext.jsx";
import { useSession } from "../../hooks/useSession.js";
import { initials } from "../../services/session.js";
import { signOut } from "../../services/api.js";

const ITEMS = [
  { key: "command", label: "Command Center", icon: "grid", route: "command" },
  { key: "campaigns", label: "Campaigns", icon: "layers", route: "campaigns" },
  { key: "prospects", label: "Prospects", icon: "people", route: "prospects" },
  { key: "approvals", label: "Approvals", icon: "check", route: "approvals" },
  { key: "agents", label: "Agents & Prompts", icon: "sliders", route: "agents" },
  { key: "knowledge", label: "Knowledge", icon: "book", route: "knowledge" },
  { key: "analytics", label: "Analytics", icon: "bars", route: "analytics" },
  { key: "settings", label: "Settings", icon: "gear", route: "settings" },
];

export default function Sidebar({ active }) {
  const { navigate } = useNav();
  const session = useSession();
  return (
    <nav
      aria-label="Main navigation"
      style={{
        width: 240, flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", padding: "22px 0",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "0 20px 20px 20px",
          borderBottom: "1px solid var(--border)", marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 30, height: 30, borderRadius: 8, background: "var(--accent)", display: "flex",
            alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14,
          }}
        >
          N
        </div>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>NimbusGuard SDR</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 12px" }}>
        {ITEMS.map((it) => (
          <button
            key={it.key}
            type="button"
            className={`navitem ${active === it.key ? "active" : ""}`}
            aria-current={active === it.key ? "page" : undefined}
            onClick={() => navigate(it.route)}
          >
            <Icon name={it.icon} size={18} />
            {it.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "auto", padding: "14px 20px 0 20px", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 26, height: 26, borderRadius: "50%", background: "var(--neutral-soft)", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--text-2)",
            }}
          >
            {initials(session && session.name)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, flexGrow: 1 }}>{session ? session.name : ""}</div>
          <button type="button" className="link" style={{ fontSize: 12 }} onClick={signOut}>Sign out</button>
        </div>
      </div>
    </nav>
  );
}
