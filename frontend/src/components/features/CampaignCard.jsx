import React from "react";
import Icon from "../ui/Icon.jsx";
import { StatusBadge, Tag } from "../ui/Badge.jsx";
import { ACTION_LABEL } from "../../hooks/useCampaignActions.js";

const CHANNEL_ICON = { email: "mail", linkedin: "chat", sms: "chat", voice: "phone" };

export default function CampaignCard({ card, onAction, onOpen }) {
  const paused = card.status === "paused" || card.status === "stopped";
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, opacity: paused ? 0.92 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <StatusBadge status={card.status} />
        <Tag>{card.owner}</Tag>
      </div>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{card.name}</div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{card.icpSummary}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {card.channels.map((c) => (
          <Tag key={c.key}>
            <Icon name={CHANNEL_ICON[c.key]} size={12} stroke={1.7} />
            {c.label}
          </Tag>
        ))}
      </div>
      <div
        style={{
          display: "flex", justifyContent: "space-between", padding: "10px 0",
          borderTop: "1px solid var(--border)", fontSize: 12.5,
        }}
      >
        {[
          ["Contacted", card.metrics.contacted],
          ["Engaged", card.metrics.engaged],
          ["Meetings", card.metrics.meetings],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{value.toLocaleString("en-US")}</div>
            <div style={{ color: "var(--text-3)" }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {card.action && (
          <button
            type="button"
            className={`btn ${card.action === "pause" ? "btn-danger-outline" : "btn-primary"}`}
            style={{ flexGrow: 1 }}
            disabled={card.locked}
            title={card.locked ? "The Global Kill Switch is active" : undefined}
            onClick={() => onAction(card.id, card.action)}
          >
            {ACTION_LABEL[card.action]}
          </button>
        )}
        <button type="button" className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={() => onOpen(card.id)}>
          Dashboard
        </button>
      </div>
    </div>
  );
}
