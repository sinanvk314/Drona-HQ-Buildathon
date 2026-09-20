import React from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import ProspectTable from "../components/features/ProspectTable.jsx";
import Funnel from "../components/ui/Funnel.jsx";
import RichText from "../components/ui/RichText.jsx";
import { StatusBadge, Tag } from "../components/ui/Badge.jsx";
import { useApi } from "../hooks/useApi.js";
import { ACTION_LABEL, useCampaignActions } from "../hooks/useCampaignActions.js";
import { duplicateCampaign, getCampaign } from "../services/api.js";
import { useToast } from "../components/ui/Toast.jsx";
import { fmt, timeAgo, timeShort } from "../utils/format.js";
import { eventStyle } from "../utils/eventStyle.js";
import KnowledgePanel from "../components/campaign/KnowledgePanel.jsx";

const LABEL = { fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" };

export default function CampaignDetail({ params }) {
  const { navigate } = useNav();
  const act = useCampaignActions();
  const toast = useToast();
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
          <button type="button" className="btn btn-secondary" onClick={duplicate}>Duplicate</button>
          {editable && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate("editCampaign", { id: c.id })}>Edit</button>
          )}
          {c.action && (
            <button
              type="button"
              className={`btn ${c.action === "pause" ? "btn-danger-outline" : "btn-primary"}`}
              disabled={c.locked}
              title={c.locked ? "The Global Kill Switch is active" : undefined}
              onClick={() => act(c.id, c.action)}
            >
              {ACTION_LABEL[c.action]} Campaign
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

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Prospect Funnel</div>
          <Funnel stages={c.funnel} height={90} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Agent Activity Timeline</div>
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
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Outreach Activity</div>
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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                <span>Est. cost / qualified lead</span>
                <strong>{draft || !o.costPerQualified ? "—" : `$${o.costPerQualified.toFixed(2)}`}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20, background: "var(--warning-soft)", borderColor: "#F3DDBB" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Human Approval Queue — {c.approvals.count} pending</div>
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

        <KnowledgePanel campaignId={c.id} sources={c.knowledge} policy={c.approvalPolicy} />

        <div className="card">
          <div style={{ padding: "18px 20px 4px 20px", fontSize: 14, fontWeight: 700 }}>Prospects</div>
          <ProspectTable
            rows={c.prospects}
            onOpen={(id) => navigate("prospect", { id })}
            emptyText={draft ? "No prospects yet. Discovery starts once the campaign is live." : "No prospects yet."}
          />
        </div>
      </div>
    </Shell>
  );
}
