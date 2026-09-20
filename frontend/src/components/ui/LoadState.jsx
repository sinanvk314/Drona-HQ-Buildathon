import React from "react";

// What a screen shows while its data loads, or when loading failed, instead of an empty page.
export default function LoadState({ error, what = "this page" }) {
  return (
    <div className="card" style={{ padding: 20, fontSize: 13.5, color: error ? "var(--danger)" : "var(--text-2)" }}>
      {error ? `Could not load ${what}: ${error}` : "Loading…"}
    </div>
  );
}
