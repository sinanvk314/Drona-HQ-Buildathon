import React, { useMemo, useState } from "react";
import { StageBadge } from "../ui/Badge.jsx";
import { resolveAgo } from "../../utils/format.js";

// Highest ICP fit first (unscored prospects last) vs. most recently touched first. "Relevance" is
// the default so an operator sees the prospects most worth acting on, instead of whatever order
// they happened to be discovered in.
const SORTS = {
  relevance: { label: "Most relevant", compare: (a, b) => (b.fit ?? -1) - (a.fit ?? -1) },
  recent: { label: "Most recent activity", compare: (a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0) },
};

// Shared prospect table: used by Campaign Detail and by the cross-campaign Prospects screen.
export default function ProspectTable({ rows, showCampaign, onOpen, emptyText = "No prospects yet." }) {
  const [sortBy, setSortBy] = useState("relevance");
  const sorted = useMemo(() => [...rows].sort(SORTS[sortBy].compare), [rows, sortBy]);

  if (!rows.length) {
    return <div style={{ padding: "8px 20px 24px", fontSize: 13, color: "var(--text-2)" }}>{emptyText}</div>;
  }
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "0 20px 12px", fontSize: 12, color: "var(--text-2)" }}>
        <label htmlFor="prospect-sort">Sort by</label>
        <select
          id="prospect-sort"
          className="input"
          aria-label="Sort prospects"
          style={{ width: 190 }}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          {Object.entries(SORTS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
      <table style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: showCampaign ? "14%" : "16%" }} />
          <col style={{ width: showCampaign ? "15%" : "17%" }} />
          {showCampaign && <col style={{ width: "13%" }} />}
          <col style={{ width: "11%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: showCampaign ? "14%" : "16%" }} />
          <col style={{ width: showCampaign ? "17%" : "24%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Company</th>
            <th>Contact</th>
            {showCampaign && <th>Campaign</th>}
            <th>Stage</th>
            <th style={{ textAlign: "center" }}>ICP Fit</th>
            <th>Channel</th>
            <th>Last Action</th>
            <th>Next Step</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              className="clickable"
              tabIndex={0}
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(r.id);
              }}
            >
              <td style={{ overflowWrap: "anywhere" }}><strong>{r.company}</strong></td>
              <td style={{ overflowWrap: "anywhere" }}>{r.contact}</td>
              {showCampaign && <td style={{ overflowWrap: "anywhere" }}>{r.campaignName}</td>}
              <td><StageBadge stage={r.stage} /></td>
              <td style={{ textAlign: "center" }}>{r.fit == null ? "-" : r.fit}</td>
              <td>{r.channel}</td>
              <td style={{ overflowWrap: "anywhere" }}>{resolveAgo(r.lastAction, r.lastTs)}</td>
              <td style={{ overflowWrap: "anywhere" }}>{r.nextStep}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
