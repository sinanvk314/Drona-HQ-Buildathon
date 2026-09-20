// Visual treatment per agent-event type, shared by the live feed and campaign timelines.
const S = (icon, bg, fg, dot) => ({ icon, bg, fg, dot });

export const EVENT_STYLE = {
  draft: S("mail", "var(--accent-soft)", "var(--accent-strong)", "var(--accent)"),
  reject: S("xcircle", "var(--danger-soft)", "var(--danger)", "var(--danger)"),
  qualify: S("check", "var(--success-soft)", "var(--success)", "var(--success)"),
  conflict: S("warning", "var(--warning-soft)", "var(--warning)", "var(--warning)"),
  enrich: S("sparkle", "var(--neutral-soft)", "var(--text-2)", "var(--text-3)"),
  meeting: S("check", "var(--success-soft)", "var(--success)", "var(--success)"),
  escalate: S("warning", "var(--warning-soft)", "var(--warning)", "var(--warning)"),
  approve: S("check", "var(--success-soft)", "var(--success)", "var(--success)"),
  paused: S("info", "var(--neutral-soft)", "var(--text-2)", "var(--text-3)"),
  resume: S("check", "var(--accent-soft)", "var(--accent-strong)", "var(--accent)"),
  launch: S("sparkle", "var(--accent-soft)", "var(--accent-strong)", "var(--accent)"),
  completed: S("check", "var(--success-soft)", "var(--success)", "var(--success)"),
  edit: S("sliders", "var(--neutral-soft)", "var(--text-2)", "var(--text-3)"),
  kill: S("power", "var(--danger-soft)", "var(--danger)", "var(--danger)"),
};

export const eventStyle = (type) => EVENT_STYLE[type] || EVENT_STYLE.enrich;
