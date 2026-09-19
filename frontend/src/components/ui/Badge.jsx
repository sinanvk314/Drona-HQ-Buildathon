import React from "react";
import { STAGE_LABELS } from "../../data/constants.js";

export const TONES = {
  success: ["var(--success-soft)", "var(--success)"],
  neutral: ["var(--neutral-soft)", "var(--text-2)"],
  accent: ["var(--accent-soft)", "var(--accent-strong)"],
  danger: ["var(--danger-soft)", "var(--danger)"],
  warning: ["var(--warning-soft)", "var(--warning)"],
  muted: ["#F1F5F9", "var(--text-3)"],
  white: ["#fff", "var(--text-2)"],
};

export function Badge({ tone = "neutral", dot, children, style }) {
  const [bg, fg] = TONES[tone] || TONES.neutral;
  return (
    <span className="badge" style={{ background: bg, color: fg, ...style }}>
      {dot && <span className="dot" style={{ background: dot }} />}
      {children}
    </span>
  );
}

export function Tag({ tone, children, style }) {
  const t = tone ? TONES[tone] : null;
  return (
    <span className="tag" style={t ? { background: t[0], color: t[1], ...style } : style}>
      {children}
    </span>
  );
}

const STAGE_TONE = {
  discovered: "neutral",
  researched: "neutral",
  qualified: "neutral",
  contacted: "accent",
  engaged: "danger",
  meeting: "success",
  opportunity: "success",
  rejected: "muted",
};

export function StageBadge({ stage }) {
  return <Badge tone={STAGE_TONE[stage] || "neutral"}>{STAGE_LABELS[stage] || stage}</Badge>;
}

export function StatusBadge({ status, large }) {
  const big = large ? { fontSize: 12.5, padding: "5px 12px" } : null;
  switch (status) {
    case "live":
      return <Badge tone="success" dot="var(--success)" style={big}>LIVE</Badge>;
    case "paused":
      return <Badge tone="neutral" dot="var(--text-3)" style={big}>PAUSED</Badge>;
    case "stopped":
      return <Badge tone="danger" dot="var(--danger)" style={big}>STOPPED</Badge>;
    case "completed":
      return <Badge tone="accent" style={big}>COMPLETED</Badge>;
    case "archived":
      return <Badge tone="muted" style={big}>ARCHIVED</Badge>;
    default:
      return <Badge tone="neutral" style={big}>DRAFT</Badge>;
  }
}
