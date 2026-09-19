// Maps the in-memory `state` object (the exact shape src/db/seed.js builds and every service
// file reads/mutates) to and from the real Postgres tables created for this project (campaigns,
// prospects, events, decisions, approvals, agents, agent_versions, agent_overrides, channels,
// suppression, integrations, campaign_sources, app_settings).
//
// Design: the app keeps running against the fast, synchronous in-memory `state` object exactly
// as it always has (see db/index.js) — this file only handles the two boundary operations:
// loading that object from Postgres on boot, and fully re-syncing it back to Postgres after a
// mutation. That keeps every service/route file (data.js, scheduler.js, conflict.js, rag.js,
// agentEngine/*) completely unchanged; only the persistence adapter itself is new.
import { getPool, withTransaction } from "./pg.js";
import { SCHEMA_VERSION } from "./seed.js";

// ---------------------------------------------------------------- load (Postgres -> state)

export async function loadStateFromPg() {
  const pool = getPool();
  const [
    campaignsRes, sourcesRes, prospectsRes, eventsRes, decisionsRes, approvalsRes,
    agentsRes, versionsRes, overridesRes, channelsRes, suppressionRes, integrationsRes, settingsRes,
  ] = await Promise.all([
    pool.query("SELECT * FROM campaigns"),
    pool.query("SELECT * FROM campaign_sources ORDER BY campaign_id, position"),
    pool.query("SELECT * FROM prospects"),
    pool.query("SELECT * FROM events"),
    pool.query("SELECT * FROM decisions"),
    pool.query("SELECT * FROM approvals"),
    pool.query("SELECT * FROM agents"),
    pool.query("SELECT * FROM agent_versions ORDER BY agent_id, sort_order"),
    pool.query("SELECT * FROM agent_overrides ORDER BY agent_id, ts"),
    pool.query("SELECT * FROM channels"),
    pool.query("SELECT * FROM suppression"),
    pool.query("SELECT * FROM integrations"),
    pool.query("SELECT * FROM app_settings WHERE id = 1"),
  ]);

  if (campaignsRes.rows.length === 0) return null; // empty database — caller should seed it

  const sourcesByCampaign = groupBy(sourcesRes.rows, "campaign_id");
  const versionsByAgent = groupBy(versionsRes.rows, "agent_id");
  const overridesByAgent = groupBy(overridesRes.rows, "agent_id");

  const campaigns = campaignsRes.rows.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    status: c.status,
    owner: c.owner,
    objective: c.objective,
    description: c.description,
    icpSummary: c.icp_summary,
    icpText: c.icp_text,
    geography: c.geography || [],
    personas: c.personas || [],
    companyCriteria: c.company_criteria,
    exclusionCriteria: c.exclusion_criteria,
    channels: c.channels || [],
    qualificationPrompt: c.qualification_prompt,
    dailyLimit: c.daily_limit,
    workingHours: c.working_hours,
    approvals: {
      firstOutreach: c.approval_first_outreach,
      meetingTime: c.approval_meeting_time,
      escalate: c.approval_escalate,
    },
    sources: (sourcesByCampaign[c.id] || []).map((s) => ({
      id: s.id, name: s.name, category: s.category, ...(s.doc_id ? { docId: s.doc_id } : {}),
    })),
    funnel: {
      discovered: c.funnel_discovered, researched: c.funnel_researched, qualified: c.funnel_qualified,
      contacted: c.funnel_contacted, engaged: c.funnel_engaged, meeting: c.funnel_meeting,
      opportunity: c.funnel_opportunity,
    },
    outreach: {
      emails: c.outreach_emails, linkedin: c.outreach_linkedin, replies: c.outreach_replies,
      followups: c.outreach_followups, costPerQualified: Number(c.outreach_cost_per_qualified),
    },
    responseRate: Number(c.response_rate),
    createdTs: Number(c.created_ts),
    modifiedTs: Number(c.modified_ts),
  }));

  const prospects = prospectsRes.rows.map((p) => ({
    id: p.id,
    campaignId: p.campaign_id,
    name: p.name,
    title: p.title,
    company: p.company,
    email: p.email,
    city: p.city,
    linkedin: p.linkedin,
    industry: p.industry,
    size: p.size,
    funding: p.funding,
    tech: p.tech || [],
    stage: p.stage,
    fit: p.fit === null ? null : Number(p.fit),
    channel: p.channel,
    lastAction: p.last_action,
    lastTs: Number(p.last_ts),
    nextStep: p.next_step,
    reasons: p.reasons || [],
    evidence: p.evidence || [],
    qual: {
      status: p.qual_status, reasoning: p.qual_reasoning, agent: p.qual_agent,
      harness: p.qual_harness, ts: p.qual_ts === null ? null : Number(p.qual_ts),
    },
    history: p.history || [],
    conversation: p.conversation || [],
  }));

  const events = eventsRes.rows.map((e) => ({
    id: e.id, campaignId: e.campaign_id, type: e.type, text: e.text,
    ts: Number(e.ts), featured: e.featured,
  }));

  const decisions = decisionsRes.rows.map((d) => ({
    id: d.id, kind: d.kind, campaignId: d.campaign_id, prospectId: d.prospect_id,
    agent: d.agent, harness: d.harness, ts: Number(d.ts), headline: d.headline, summary: d.summary,
    evidence: d.evidence || [], score: d.score === null ? null : Number(d.score),
    retrieved: d.retrieved || [], instruction: d.instruction,
    conflict: { ok: d.conflict_ok, text: d.conflict_text }, finalAction: d.final_action,
  }));

  const approvals = approvalsRes.rows.map((a) => ({
    id: a.id, type: a.type, prospectId: a.prospect_id, campaignId: a.campaign_id,
    name: a.name, company: a.company, tag: a.tag, tagTone: a.tag_tone, summary: a.summary,
    requestedTs: Number(a.requested_ts),
    recommendation: { title: a.recommendation_title, body: a.recommendation_body },
    draft: { subject: a.draft_subject, body: a.draft_body },
    nextActionText: a.next_action_text, source: a.source, status: a.status,
    decidedBy: a.decided_by, decidedTs: a.decided_ts === null ? null : Number(a.decided_ts),
    reason: a.reason,
  }));

  const agents = agentsRes.rows.map((a) => ({
    id: a.id, listName: a.list_name, title: a.title, settingsName: a.settings_name,
    description: a.description, enabled: a.enabled, disabledBy: a.disabled_by,
    disabledTs: a.disabled_ts === null ? null : Number(a.disabled_ts),
    versions: (versionsByAgent[a.id] || []).map((v) => ({
      version: v.version, changedBy: v.changed_by, date: v.date_label, status: v.status,
      text: v.prompt_text, activatedBy: v.activated_by,
      activatedTs: v.activated_ts === null ? null : Number(v.activated_ts),
    })),
    overrides: (overridesByAgent[a.id] || []).map((o) => ({
      campaignId: o.campaign_id, text: o.override_text, ts: Number(o.ts),
    })),
  }));

  const channels = channelsRes.rows.map((c) => ({
    key: c.key, label: c.label, note: c.note, enabled: c.enabled,
    pausedTs: c.paused_ts === null ? null : Number(c.paused_ts),
  }));

  const suppression = suppressionRes.rows.map((s) => ({
    id: s.id, contact: s.contact, reason: s.reason, added: s.added,
  }));

  const integrations = integrationsRes.rows.map((i) => ({ name: i.name, connected: i.connected }));

  const settings = settingsRes.rows[0] || { kill_switch_active: false, kill_switch_at: null, weekly_prospects: 0, weekly_meetings: 0, seq: 100, tick_count: 0 };

  return {
    version: SCHEMA_VERSION,
    seq: settings.seq,
    tickCount: settings.tick_count,
    killSwitch: { active: settings.kill_switch_active, at: settings.kill_switch_at === null ? null : Number(settings.kill_switch_at) },
    weekly: { prospects: settings.weekly_prospects, meetings: settings.weekly_meetings },
    campaigns,
    prospects,
    events,
    decisions,
    approvals,
    agents,
    channels,
    suppression,
    integrations,
  };
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    (acc[row[key]] ||= []).push(row);
    return acc;
  }, {});
}

// ---------------------------------------------------------------- save (state -> Postgres)

const TABLES_IN_TRUNCATE_ORDER = [
  "agent_overrides", "agent_versions", "agents",
  "approvals", "decisions", "events", "prospects", "campaign_sources", "campaigns",
  "channels", "suppression", "integrations", "app_settings",
];

export async function saveStateToPg(state) {
  await withTransaction(async (client) => {
    await client.query(`TRUNCATE TABLE ${TABLES_IN_TRUNCATE_ORDER.join(", ")} RESTART IDENTITY CASCADE`);

    for (const c of state.campaigns) {
      await client.query(
        `INSERT INTO campaigns (
          id, name, short_name, status, owner, objective, description, icp_summary, icp_text,
          geography, personas, company_criteria, exclusion_criteria, channels, qualification_prompt,
          daily_limit, working_hours, approval_first_outreach, approval_meeting_time, approval_escalate,
          funnel_discovered, funnel_researched, funnel_qualified, funnel_contacted, funnel_engaged,
          funnel_meeting, funnel_opportunity, outreach_emails, outreach_linkedin, outreach_replies,
          outreach_followups, outreach_cost_per_qualified, response_rate, created_ts, modified_ts
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
        [
          c.id, c.name, c.shortName, c.status, c.owner, c.objective, c.description, c.icpSummary, c.icpText,
          c.geography, c.personas, c.companyCriteria, c.exclusionCriteria, c.channels, c.qualificationPrompt,
          c.dailyLimit, c.workingHours, c.approvals.firstOutreach, c.approvals.meetingTime, c.approvals.escalate,
          c.funnel.discovered, c.funnel.researched, c.funnel.qualified, c.funnel.contacted, c.funnel.engaged,
          c.funnel.meeting, c.funnel.opportunity, c.outreach.emails, c.outreach.linkedin, c.outreach.replies,
          c.outreach.followups, c.outreach.costPerQualified, c.responseRate, c.createdTs, c.modifiedTs,
        ]
      );
      let pos = 0;
      for (const s of c.sources) {
        await client.query(
          `INSERT INTO campaign_sources (id, campaign_id, name, category, doc_id, position) VALUES ($1,$2,$3,$4,$5,$6)`,
          [s.id, c.id, s.name, s.category, s.docId || null, pos++]
        );
      }
    }

    for (const a of state.agents) {
      await client.query(
        `INSERT INTO agents (id, list_name, title, settings_name, description, enabled, disabled_by, disabled_ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [a.id, a.listName, a.title, a.settingsName, a.description, a.enabled, a.disabledBy, a.disabledTs]
      );
      let vpos = 0;
      for (const v of a.versions) {
        await client.query(
          `INSERT INTO agent_versions (agent_id, version, changed_by, date_label, status, prompt_text, activated_by, activated_ts, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [a.id, v.version, v.changedBy, v.date, v.status, v.text, v.activatedBy, v.activatedTs, vpos++]
        );
      }
      for (const o of a.overrides) {
        await client.query(
          `INSERT INTO agent_overrides (agent_id, campaign_id, override_text, ts) VALUES ($1,$2,$3,$4)`,
          [a.id, o.campaignId, o.text, o.ts]
        );
      }
    }

    for (const p of state.prospects) {
      await client.query(
        `INSERT INTO prospects (
          id, campaign_id, name, title, company, email, city, linkedin, industry, size, funding, tech,
          stage, fit, channel, last_action, last_ts, next_step, reasons, evidence,
          qual_status, qual_reasoning, qual_agent, qual_harness, qual_ts, history, conversation
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [
          p.id, p.campaignId, p.name, p.title, p.company, p.email, p.city, p.linkedin, p.industry, p.size,
          p.funding, p.tech, p.stage, p.fit, p.channel, p.lastAction, p.lastTs, p.nextStep, p.reasons, p.evidence,
          p.qual?.status || null, p.qual?.reasoning || null, p.qual?.agent || null, p.qual?.harness || null,
          p.qual?.ts ?? null, JSON.stringify(p.history || []), JSON.stringify(p.conversation || []),
        ]
      );
    }

    for (const e of state.events) {
      await client.query(
        `INSERT INTO events (id, campaign_id, type, text, ts, featured) VALUES ($1,$2,$3,$4,$5,$6)`,
        [e.id, e.campaignId, e.type, e.text, e.ts, !!e.featured]
      );
    }

    for (const d of state.decisions) {
      await client.query(
        `INSERT INTO decisions (
          id, kind, campaign_id, prospect_id, agent, harness, ts, headline, summary, evidence, score,
          retrieved, instruction, conflict_ok, conflict_text, final_action
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          d.id, d.kind, d.campaignId, d.prospectId || null, d.agent, d.harness, d.ts, d.headline, d.summary,
          d.evidence, d.score, d.retrieved, d.instruction, d.conflict?.ok ?? true,
          d.conflict?.text || "No conflicts found", d.finalAction,
        ]
      );
    }

    for (const a of state.approvals) {
      await client.query(
        `INSERT INTO approvals (
          id, type, prospect_id, campaign_id, name, company, tag, tag_tone, summary, requested_ts,
          recommendation_title, recommendation_body, draft_subject, draft_body, next_action_text, source,
          status, decided_by, decided_ts, reason
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          a.id, a.type, a.prospectId, a.campaignId, a.name, a.company, a.tag, a.tagTone, a.summary, a.requestedTs,
          a.recommendation?.title || "", a.recommendation?.body || "", a.draft?.subject || "", a.draft?.body || "",
          a.nextActionText, a.source, a.status, a.decidedBy, a.decidedTs, a.reason,
        ]
      );
    }

    for (const c of state.channels) {
      await client.query(
        `INSERT INTO channels (key, label, note, enabled, paused_ts) VALUES ($1,$2,$3,$4,$5)`,
        [c.key, c.label, c.note, c.enabled, c.pausedTs]
      );
    }

    for (const s of state.suppression) {
      await client.query(
        `INSERT INTO suppression (id, contact, reason, added) VALUES ($1,$2,$3,$4)`,
        [s.id, s.contact, s.reason, s.added]
      );
    }

    for (const i of state.integrations) {
      await client.query(`INSERT INTO integrations (name, connected) VALUES ($1,$2)`, [i.name, i.connected]);
    }

    await client.query(
      `INSERT INTO app_settings (id, kill_switch_active, kill_switch_at, weekly_prospects, weekly_meetings, seq, tick_count)
       VALUES (1,$1,$2,$3,$4,$5,$6)`,
      [state.killSwitch.active, state.killSwitch.at, state.weekly.prospects, state.weekly.meetings, state.seq, state.tickCount]
    );
  });
}
