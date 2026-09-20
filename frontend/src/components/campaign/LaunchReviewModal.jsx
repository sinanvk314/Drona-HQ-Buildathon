import React from "react";
import { Modal } from "../ui/Modal.jsx";
import Icon from "../ui/Icon.jsx";
import { useApi } from "../../hooks/useApi.js";
import { getLaunchReview } from "../../services/api.js";

const STYLE = {
  ok: { icon: "check", color: "var(--success)", bg: "var(--success-soft)" },
  warn: { icon: "warning", color: "var(--warning)", bg: "var(--warning-soft)" },
  block: { icon: "xcircle", color: "var(--danger)", bg: "var(--danger-soft)" },
};

// What a manager should see before activating a campaign (PS design question). Warnings can be launched over;
// a blocker cannot.
export default function LaunchReviewModal({ campaignId, onClose, onLaunch }) {
  const { data: review, error } = useApi(() => getLaunchReview(campaignId), [campaignId], { pollMs: 0 });
  const warnings = review ? review.checks.filter((c) => c.status === "warn").length : 0;

  return (
    <Modal
      title={review ? `Review before launching - ${review.name}` : "Review before launching"}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!review || !review.ready} onClick={onLaunch}>
            {warnings ? `Launch anyway (${warnings} to note)` : "Launch campaign"}
          </button>
        </>
      }
    >
      {error && <div className="field-error">{error}</div>}
      {!review && !error && <div style={{ fontSize: 13, color: "var(--text-2)" }}>Checking…</div>}
      {review && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {review.checks.map((c) => {
            const st = STYLE[c.status];
            return (
              <div key={c.key} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 8, background: st.bg }}>
                <Icon name={st.icon} size={17} stroke={1.8} color={st.color} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, marginTop: 2 }}>{c.detail}</div>
                </div>
              </div>
            );
          })}
          {!review.ready && <div className="field-error">Fix the items marked in red before launching.</div>}
        </div>
      )}
    </Modal>
  );
}
