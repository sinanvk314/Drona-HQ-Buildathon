import React from "react";
import { StageBadge } from "../ui/Badge.jsx";
import { resolveAgo } from "../../utils/format.js";

// Shared prospect table: used by Campaign Detail and by the cross-campaign Prospects screen.
export default function ProspectTable({ rows, showCampaign, onOpen, emptyText = "No prospects yet." }) {
  if (!rows.length) {
    return <div style={{ padding: "8px 20px 24px", fontSize: 13, color: "var(--text-2)" }}>{emptyText}</div>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Company</th>
          <th>Contact</th>
          {showCampaign && <th>Campaign</th>}
          <th>Stage</th>
          <th>ICP Fit</th>
          <th>Channel</th>
          <th>Last Action</th>
          <th>Next Step</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className="clickable"
            tabIndex={0}
            onClick={() => onOpen(r.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onOpen(r.id);
            }}
          >
            <td><strong>{r.company}</strong></td>
            <td>{r.contact}</td>
            {showCampaign && <td>{r.campaignName}</td>}
            <td><StageBadge stage={r.stage} /></td>
            <td>{r.fit == null ? "—" : r.fit}</td>
            <td>{r.channel}</td>
            <td>{resolveAgo(r.lastAction, r.lastTs)}</td>
            <td>{r.nextStep}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
