import React from "react";

export default function Toggle({ on, onChange, label, tone = "accent", disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`toggle ${on ? "on" : "off"} ${tone === "success" ? "success" : ""}`}
    >
      <span className="knob" />
    </button>
  );
}
