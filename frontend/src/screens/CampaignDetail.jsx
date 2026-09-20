import React, { useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import ProspectTable from "../components/features/ProspectTable.jsx";
import Funnel from "../components/ui/Funnel.jsx";
import RichText from "../components/ui/RichText.jsx";
import { StatusBadge, Tag } from "../components/ui/Badge.jsx";
import { useApi } from "../hooks/useApi.js";
import { ACTION_LABEL, useCampaignActions } from "../hooks/useCampaignActions.js";
import { archiveCampaign, completeCampaign, duplicateCampaign, getCampaign } from "../services/api.js";
import { ConfirmDialog } from "../components/ui/Modal.jsx";
import CampaignAgentsPanel from "../components/campaign/CampaignAgentsPanel.jsx";
import CampaignActivity from "../components/campaign/CampaignActivity.jsx";
import LaunchReviewModal from "../components/campaign/LaunchReviewModal.jsx";
import SdrBlueprint from "../components/campaign/SdrBlueprint.jsx";
import CampaignRepsPanel from "../components/campaign/CampaignRepsPanel.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { fmt, timeAgo, timeShort } from "../utils/format.js";
import { eventStyle } from "../utils/eventStyle.js";
import KnowledgePanel from "../components/campaign/KnowledgePanel.jsx";
import CampaignPromptsPanel from "../components/campaign/CampaignPromptsPanel.jsx";

const LABEL = { fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" };

export default function CampaignDetail({ params }) {
  const { navigate } = useNav();
  const act = useCampaignActions();
  const toast = useToast();
  const [confirm, setConfirm] = useState(null); // "complete" | "archive"
  const [reviewing, setReviewing] = useState(!!params.review); // the pre-launch review
  const { data: c, error } = useApi(() => getCampaign(params.id), [params.id]);
  const crumbs = [{ label: "Campaigns", onClick: () => navigate("campaigns") }];

  if (!c) {
    return (
      <Shell active="campaigns" title="Campaign" crumbs={crumbs}>
        {error && <div className="card" style={{ padding: 20, fontSize: 13.5 }}>{error}</div>}
      </Shell>
    );
  }

  const draft = c.rawStatus === "draft";
  const editable = c.rawStatus !== "completed" && c.rawStatus !== "archived";
  const canComplete = c.rawStatus === "live" || c.rawStatus === "paused";
  const canArchive = ["draft", "paused", "completed"].includes(c.rawStatus);
  const finish = async () => {
    const which = confirm;
    setConfirm(null);
    try {
      if (which === "complete") {
        await completeCampaign(c.id);
        toast("Campaign marked as completed. Its history and analytics stay available.");
      } else {
        await archiveCampaign(c.id);
        toast("Campaign archived. Its history stays available.");
        navigate("campaigns");
      }
    } catch (e) {
      toast(e.message, "error");
    }
  };
  const duplicate = async () => {
    try {
      const copy = await duplicateCampaign(c.id);
      toast("Copied as a new Draft");
      navigate("campaignDetail", { id: copy.id });
    } catch (e) {
      toast(e.message, "error");
    }
  };
  const o = c.outreach;

  return (
    <Shell active="campaigns" title={c.name} crumbs={crumbs}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card" style={{ padding: "20px 22px", display: "flex", alignItems: "center", gap: 18 }}>
          <StatusBadge status={c.status} large />
          <div style={{ flexGrow: 1, fontSize: 12.5, color: "var(--text-2)" }}>
            {c.icpSummary} &nbsp;·&nbsp; Objective: {c.objective} &nbsp;·&nbsp; Owner: {c.owner}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>Last modified {timeAgo(c.modifiedTs)}</div>
          {c.copiedFrom && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate("analytics", { ids: [c.copiedFrom.id, c.id] })}>Compare with original</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={duplicate}>Duplicate</button>
          {canComplete && <button type="button" className="btn btn-secondary" onClick={() => setConfirm("complete")}>Complete</button>}
          {canArchive && <button type="button" className="btn btn-secondary" onClick={() => setConfirm("archive")}>Archive</button>}
          {editable && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate("editCampaign", { id: c.id })}>Edit</button>
          )}
          {c.action && (
            <button
              type="button"
              className={`btn ${c.action === "pause" ? "btn-danger-outline" : "btn-primary"}`}
              disabled={c.locked}
              title={c.locked ? "The Global Kill Switch is active" : undefined}
              onClick={() => (c.action === "launch" ? setReviewing(true) : act(c.id, c.action))}
            >
              {c.action === "launch" ? "Review & Launch" : `${ACTION_LABEL[c.action]} Campaign`}
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 22, borderBottom: "1px solid var(--border)" }}>
          {["Overview", "Prospects", "Activity", "Approvals", "Settings"].map((t, i) => (
            <div key={t} className={`subtab ${i === 0 ? "active" : ""}`}>{t}</div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {[
            ["In Pipeline", fmt(c.metrics.pipeline)],
            ["Qualify Rate", `${c.metrics.qualifyRate}%`],
            ["Response Rate", `${c.metrics.responseRate}%`],
            ["Meetings Booked", fmt(c.metrics.meetings)],
          ].map(([label, value]) => (
            <div key={label} className="card" style={{ padding: "16px 18px" }}>
              <div style={LABEL}>{label}</div>
              <div style={{ fontSize: 23, fontWeight: 700, marginTop: 5 }}>{value}</div>
            </div>
          ))}
        </div>

        {!draft && <CampaignActivity activity={c.activity} outcomes={c.outcomes} />}

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Prospect Funnel</div>
          <Funnel stages={c.funnel} height={90} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Agent Activity Timeline</div>
            {c.timeline.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                {draft ? "Agent activity starts once this campaign is live." : "No agent activity yet."}
              </div>
            )}
            {c.timeline.map((e, i) => (
              <div
                key={e.id}
                style={{ display: "flex", gap: 12, padding: "9px 0", borderBottom: i === c.timeline.length - 1 ? "none" : "1px solid var(--border)" }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: eventStyle(e.type).dot, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flexGrow: 1, fontSize: 12.5 }}><RichText text={e.text} /></div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{timeShort(e.ts)}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Outreach Activity</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {[
                ["Emails sent", fmt(o.emails)],
                ["LinkedIn actions", fmt(o.linkedin)],
                ["Replies received", fmt(o.replies)],
                ["Follow-ups sent", fmt(o.followups)],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
              {c.limits && c.limits.enforced && !draft && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>Touches today (simulated day)</span>
                    <strong>{c.limits.sentToday}{c.limits.dailyLimit ? ` / ${c.limits.dailyLimit}` : ""}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>Working hours</span>
                    <strong style={{ color: c.limits.withinHours ? "var(--success)" : "var(--warning)" }}>
                      {c.limits.withinHours ? "Open" : "Closed"} · simulated {c.limits.simClock}
                    </strong>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                <span>Est. cost / qualified lead</span>
                <strong>{draft || !o.costPerQualified ? "-" : `$${o.costPerQualified.toFixed(2)}`}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20, background: "var(--warning-soft)", borderColor: "#F3DDBB" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Human Approval Queue - {c.approvals.count} pending</div>
            <button type="button" className="link" style={{ fontSize: 12.5 }} onClick={() => navigate("approvals")}>
              Open Approvals →
            </button>
          </div>
          {c.approvals.count === 0 && <div style={{ fontSize: 13, color: "var(--text-2)" }}>Nothing is waiting for approval in this campaign.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {c.approvals.items.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate("approvals", { approvalId: a.id })}
                style={{
                  display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "10px 14px", width: "100%", textAlign: "left", fontFamily: "inherit", cursor: "pointer",
                }}
              >
                <div style={{ flexGrow: 1, fontSize: 13 }}><RichText text={a.text} /></div>
                <Tag tone={a.tone === "danger" ? "danger" : undefined}>{a.tag}</Tag>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{timeAgo(a.ts)}</div>
              </button>
            ))}
          </div>
        </div>

        <SdrBlueprint campaignId={c.id} editable={editable} />

        <CampaignRepsPanel campaignId={c.id} reps={c.reps} options={c.repOptions} editable={editable} />

        <CampaignAgentsPanel campaignId={c.id} agents={c.agents} editable={editable} />

        <CampaignPromptsPanel campaignId={c.id} prompts={c.prompts} editable={editable} />

        <KnowledgePanel campaignId={c.id} sources={c.knowledge} policy={c.approvalPolicy} cadence={c.cadence} />

        <div className="card">
          <div style={{ padding: "18px 20px 4px 20px", fontSize: 15, fontWeight: 700 }}>Prospects</div>
          <ProspectTable
            rows={c.prospects}
            onOpen={(id) => navigate("prospect", { id })}
            emptyText={draft ? "No prospects yet. Discovery starts once the campaign is live." : "No prospects yet."}
          />
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm === "complete" ? "Mark this campaign as completed?" : "Archive this campaign?"}
          message={
            confirm === "complete"
              ? "All autonomous outreach in this campaign stops for good. Its prospects, conversations, decisions and analytics stay available. This cannot be undone."
              : "The campaign leaves your active list. Its prospects, conversations, decisions and analytics stay available. This cannot be undone."
          }
          confirmLabel={confirm === "complete" ? "Mark as completed" : "Archive"}
          danger
          onConfirm={finish}
          onCancel={() => setConfirm(null)}
        />
      )}
      {reviewing && (
        <LaunchReviewModal
          campaignId={c.id}
          onClose={() => setReviewing(false)}
          onLaunch={async () => {
            setReviewing(false);
            await act(c.id, "launch");
          }}
        />
      )}
    </Shell>
  );
}
