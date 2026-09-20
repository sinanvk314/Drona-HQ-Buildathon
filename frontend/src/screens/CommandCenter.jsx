import React, { useEffect, useRef } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import CampaignCard from "../components/features/CampaignCard.jsx";
import Funnel from "../components/ui/Funnel.jsx";
import EfficiencyPanel from "../components/features/EfficiencyPanel.jsx";
import Icon from "../components/ui/Icon.jsx";
import RichText from "../components/ui/RichText.jsx";
import { Tag } from "../components/ui/Badge.jsx";
import { useApi } from "../hooks/useApi.js";
import { useCampaignActions } from "../hooks/useCampaignActions.js";
import { getCommandCenter } from "../services/api.js";
import { fmt, greeting, longDate, timeAgo } from "../utils/format.js";
import { eventStyle } from "../utils/eventStyle.js";
import { useSession } from "../hooks/useSession.js";

export default function CommandCenter({ routeName }) {
  const { navigate } = useNav();
  const act = useCampaignActions();
  const session = useSession();
  const { data } = useApi(() => getCommandCenter(), []);
  const campaignsRef = useRef(null);
  const ready = !!data;
  const isCampaigns = routeName === "campaigns";

  useEffect(() => {
    if (ready && isCampaigns && campaignsRef.current) campaignsRef.current.scrollIntoView({ block: "start" });
  }, [ready]);

  const shellProps = { active: isCampaigns ? "campaigns" : "command", title: isCampaigns ? "Campaigns" : "Command Center" };
  if (!data) return <Shell {...shellProps}><div /></Shell>;

  const { approvals } = data;

  return (
    <Shell {...shellProps}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{greeting()}, {session ? session.name : ""}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 3 }}>
              {longDate(data.now)} · {data.summary.configured} campaigns configured, {data.summary.running} running autonomously · simulated clock {data.simClock}
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate("createCampaign")}>
            <Icon name="plus" size={14} stroke={2} />
            New Campaign
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {data.kpis.map((k) => (
            <div key={k.label} className="card" style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {k.label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{fmt(k.value)}</div>
              <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600, color: k.tone === "success" ? "var(--success)" : "var(--text-2)" }}>
                {k.dot && <span className="dot" style={{ background: "var(--success)", marginRight: 5 }} />}
                {k.sub}
              </div>
            </div>
          ))}
        </div>

        {approvals.count > 0 ? (
          <div
            className="card"
            style={{ background: "var(--warning-soft)", borderColor: "#F3DDBB", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}
          >
            <Icon name="warning" size={20} stroke={1.7} color="var(--warning)" />
            <div style={{ flexGrow: 1, fontSize: 13.5 }}>
              <strong>{approvals.count} {approvals.count === 1 ? "action" : "actions"}</strong> across your campaigns{" "}
              {approvals.count === 1 ? "is" : "are"} waiting for human approval
              {approvals.escalated > 0 &&
                `, including ${approvals.escalated} escalated ${approvals.escalated === 1 ? "objection" : "objections"}`}
              .
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => navigate("approvals")}>Review Approvals</button>
          </div>
        ) : (
          <div className="card" style={{ background: "var(--success-soft)", borderColor: "#CBEBDA", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="check" size={20} stroke={1.7} color="var(--success)" />
            <div style={{ fontSize: 13.5 }}>You're all caught up — no actions are waiting for approval.</div>
          </div>
        )}

        <div ref={campaignsRef}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Campaigns</div>
            <button type="button" className="link" style={{ fontSize: 12.5, color: "var(--accent)" }} onClick={() => navigate("campaigns")}>
              View all →
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
            {data.campaigns.map((c) => (
              <CampaignCard key={c.id} card={c} onAction={act} onOpen={(id) => navigate("campaignDetail", { id })} />
            ))}
          </div>
        </div>

        <EfficiencyPanel u={data.efficiency} />

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Overall Funnel — All Campaigns</div>
          <Funnel stages={data.funnel} height={100} />
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>AI Agent Activity — Live Feed</div>
          {data.feed.length === 0 && <div style={{ fontSize: 13, color: "var(--text-2)" }}>No agent activity yet.</div>}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {data.feed.map((e, i) => {
              const st = eventStyle(e.type);
              return (
                <div
                  key={e.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "11px 0",
                    borderBottom: i === data.feed.length - 1 ? "none" : "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      width: 30, height: 30, borderRadius: 8, background: st.bg, color: st.fg, display: "flex",
                      alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}
                  >
                    <Icon name={st.icon} size={15} stroke={1.7} />
                  </div>
                  <div style={{ flexGrow: 1, fontSize: 13 }}><RichText text={e.text} /></div>
                  <Tag>{e.campaignTag}</Tag>
                  <div style={{ fontSize: 12, color: "var(--text-3)", width: 64, textAlign: "right" }}>{timeAgo(e.ts)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Shell>
  );
}
