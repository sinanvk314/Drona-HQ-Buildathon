import React, { useState } from "react";
import Icon from "../ui/Icon.jsx";
import { ConfirmDialog } from "../ui/Modal.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useApi } from "../../hooks/useApi.js";
import { getShellState, setKillSwitch } from "../../services/api.js";

export default function TopBar({ title, crumbs = [], badge, searchPlaceholder = "Search campaigns, prospects…" }) {
  const toast = useToast();
  const { data } = useApi(() => getShellState(), []);
  const killed = !!(data && data.killSwitch);
  const [confirming, setConfirming] = useState(false);

  const onKill = async () => {
    if (killed) {
      try {
        await setKillSwitch(false);
        toast("Global Kill Switch deactivated");
      } catch (e) {
        toast(e.message, "error");
      }
    } else {
      setConfirming(true);
    }
  };

  const activate = async () => {
    setConfirming(false);
    try {
      await setKillSwitch(true);
      toast("Global Kill Switch activated — all outreach stopped");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <header
      style={{
        height: 64, flexShrink: 0, background: "var(--surface)", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", padding: "0 28px", gap: 20,
      }}
    >
      {crumbs.map((c, i) => (
        <button
          key={i}
          type="button"
          className="link"
          onClick={c.onClick}
          style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500, flexShrink: 0 }}
        >
          {c.label} /
        </button>
      ))}
      <div style={{ fontSize: 17, fontWeight: 700, flexShrink: 0 }}>{title}</div>
      {badge}
      <div style={{ flexGrow: 1 }} />

      <label
        style={{
          display: "flex", alignItems: "center", gap: 8, background: "var(--neutral-soft)", borderRadius: 8,
          padding: "8px 12px", width: 280, color: "var(--text-3)",
        }}
      >
        <Icon name="search" size={16} />
        <input
          type="search"
          placeholder={searchPlaceholder}
          aria-label="Search"
          style={{
            border: 0, outline: 0, background: "transparent", flex: 1, minWidth: 0, fontSize: 13,
            fontFamily: "inherit", color: "var(--text)",
          }}
        />
      </label>

      <button type="button" className={`killbtn ${killed ? "active" : ""}`} onClick={onKill}>
        <Icon name="power" size={15} stroke={1.8} />
        {killed ? "Deactivate Kill Switch" : "Kill Switch"}
      </button>

      <div style={{ position: "relative", color: "var(--text-2)", display: "flex" }} aria-label="Notifications" role="img">
        <Icon name="bell" size={18} />
        <div
          style={{
            position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: "50%",
            background: "var(--danger)", border: "1.5px solid #fff",
          }}
        />
      </div>
      <div style={{ width: 1, height: 24, background: "var(--border)" }} />
      <div
        style={{
          width: 28, height: 28, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-strong)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700,
        }}
      >
        JD
      </div>

      {confirming && (
        <ConfirmDialog
          title="Activate the Global Kill Switch?"
          message="This immediately stops all autonomous outreach across every campaign and channel. Prospect and conversation data is preserved, and each campaign keeps its own status until you deactivate the switch."
          confirmLabel="Activate Kill Switch"
          danger
          onConfirm={activate}
          onCancel={() => setConfirming(false)}
        />
      )}
    </header>
  );
}
