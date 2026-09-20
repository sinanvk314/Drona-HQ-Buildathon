import React, { useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import SandboxTab from "../components/dev/SandboxTab.jsx";
import SearchTab from "../components/dev/SearchTab.jsx";
import TestsTab from "../components/dev/TestsTab.jsx";
import RuntimeTab from "../components/dev/RuntimeTab.jsx";

const TABS = [
  { key: "sandbox", label: "Judge sandbox", blurb: "Play the prospect yourself and see whether the SDR books a proper meeting." },
  { key: "search", label: "Search playground", blurb: "Try the imitated people search on any audience." },
  { key: "tests", label: "Real-data tests", blurb: "Check the ICP agent against people you already know the answer for." },
  { key: "runtime", label: "Runtime", blurb: "What is in force on this server right now." },
];

export default function Dev() {
  const [tab, setTab] = useState("sandbox");
  const current = TABS.find((t) => t.key === tab);
  return (
    <Shell active="dev" title="Dev">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="tablist" aria-label="Dev tools">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`chip ${tab === t.key ? "selected" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>{current.blurb} Nothing here appears in the dashboard, approvals or journal of real campaigns.</div>
        </div>
        {tab === "sandbox" && <SandboxTab />}
        {tab === "search" && <SearchTab />}
        {tab === "tests" && <TestsTab />}
        {tab === "runtime" && <RuntimeTab />}
      </div>
    </Shell>
  );
}
