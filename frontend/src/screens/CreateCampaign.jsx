import React, { useEffect, useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import Icon from "../components/ui/Icon.jsx";
import { Badge, Tag } from "../components/ui/Badge.jsx";
import Toggle from "../components/ui/Toggle.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useApi } from "../hooks/useApi.js";
import { createCampaign, getCampaignDefaults } from "../services/api.js";
import { CHANNEL_KEYS, CHANNEL_LABELS } from "../data/constants.js";
import { validateCampaign } from "../utils/validation.js";
import AddSourceModal from "../components/campaign/AddSourceModal.jsx";
import ApprovalLevel from "../components/campaign/ApprovalLevel.jsx";

const CHANNEL_ICON = { email: "mail", linkedin: "chat", sms: "chat", voice: "phone" };
const APPROVAL_ROWS = [
  ["firstOutreach", "Require approval before the first outreach message to a new prospect"],
  ["meetingTime", "Require approval before proposing a meeting time"],
  ["escalate", "Escalate to a human on any detected objection or negative sentiment"],
];

function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

function AddChip({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    if (text.trim()) onAdd(text.trim());
    setText("");
    setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" className="chip dashed" onClick={() => setOpen(true)}>+ Add</button>
    );
  }
  return (
    <input
      autoFocus
      className="input"
      aria-label="Add option"
      style={{ width: 150, padding: "5px 12px", borderRadius: 999 }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setText("");
          setOpen(false);
        }
      }}
    />
  );
}

export default function CreateCampaign() {
  const { navigate } = useNav();
  const toast = useToast();
  const { data: defaults } = useApi(() => getCampaignDefaults(), [], { pollMs: 0 });
  const [v, setV] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [addingSource, setAddingSource] = useState(false);

  useEffect(() => {
    if (defaults && !v) setV(defaults);
  }, [defaults]);

  const badge = <Badge tone="neutral">DRAFT</Badge>;
  if (!v) return <Shell active="campaigns" title="New Campaign" badge={badge}><div /></Shell>;

  const set = (k, val) => {
    setV((p) => ({ ...p, [k]: val }));
    if (errors[k]) {
      setErrors((e) => {
        const n = { ...e };
        delete n[k];
        return n;
      });
    }
  };
  const toggleIn = (k, item) => set(k, v[k].includes(item) ? v[k].filter((x) => x !== item) : [...v[k], item]);
  const addOption = (optKey, selKey, label) => {
    if (!v[optKey].includes(label)) setV((p) => ({ ...p, [optKey]: [...p[optKey], label], [selKey]: [...p[selKey], label] }));
    else if (!v[selKey].includes(label)) toggleIn(selKey, label);
  };

  const submit = async (launch) => {
    const errs = validateCampaign(v, launch);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast("Please fix the highlighted fields.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await createCampaign(v, { launch });
      toast(launch ? "Campaign launched" : "Draft saved");
      if (launch) navigate("campaignDetail", { id: res.id });
      else navigate("command");
    } catch (e) {
      if (e.fields) setErrors(e.fields);
      toast(e.message, "error");
      setBusy(false);
    }
  };

  const addSource = ({ name, category, content }) => {
    setV((p) => ({ ...p, sources: [...p.sources, { id: `s${Date.now()}`, name, category, content }] }));
    setAddingSource(false);
  };
  const removeSource = (id) => setV((p) => ({ ...p, sources: p.sources.filter((x) => x.id !== id) }));

  const footer = (
    <div
      style={{
        flexShrink: 0, background: "var(--surface)", borderTop: "1px solid var(--border)", padding: "16px 32px",
        display: "flex", justifyContent: "flex-end", gap: 10,
      }}
    >
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => submit(false)}>Save as Draft</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>Launch Campaign</button>
    </div>
  );

  const cls = (k) => `input ${errors[k] ? "error" : ""}`;

  return (
    <Shell active="campaigns" title="New Campaign" badge={badge} footer={footer}>
      <div style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 16 }}>Campaign Identity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Campaign Name" htmlFor="cc-name" error={errors.name}>
              <input id="cc-name" className={cls("name")} value={v.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="cc-desc" error={errors.description}>
              <textarea id="cc-desc" className={cls("description")} rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Owner" htmlFor="cc-owner" error={errors.owner}>
                <input id="cc-owner" className={cls("owner")} value={v.owner} onChange={(e) => set("owner", e.target.value)} />
              </Field>
              <Field label="Campaign Objective" htmlFor="cc-objective" error={errors.objective}>
                <input id="cc-objective" className={cls("objective")} value={v.objective} onChange={(e) => set("objective", e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 16 }}>Targeting &amp; ICP</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="ICP / Target Audience" htmlFor="cc-icp" error={errors.icpText}>
              <textarea id="cc-icp" className={cls("icpText")} rows={2} value={v.icpText} onChange={(e) => set("icpText", e.target.value)} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Geography" error={errors.geography}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {v.geographyOptions.map((g) => (
                    <button key={g} type="button" aria-pressed={v.geography.includes(g)} className={`chip ${v.geography.includes(g) ? "selected" : ""}`} onClick={() => toggleIn("geography", g)}>
                      {g}
                    </button>
                  ))}
                  <AddChip onAdd={(label) => addOption("geographyOptions", "geography", label)} />
                </div>
              </Field>
              <Field label="Target Personas / Roles" error={errors.personas}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {v.personaOptions.map((g) => (
                    <button key={g} type="button" aria-pressed={v.personas.includes(g)} className={`chip ${v.personas.includes(g) ? "selected" : ""}`} onClick={() => toggleIn("personas", g)}>
                      {g}
                    </button>
                  ))}
                  <AddChip onAdd={(label) => addOption("personaOptions", "personas", label)} />
                </div>
              </Field>
            </div>
            <Field label="Company Criteria" htmlFor="cc-company">
              <input id="cc-company" className="input" value={v.companyCriteria} onChange={(e) => set("companyCriteria", e.target.value)} />
            </Field>
            <Field label="Exclusion Criteria" htmlFor="cc-excl">
              <input id="cc-excl" className="input" value={v.exclusionCriteria} onChange={(e) => set("exclusionCriteria", e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 16 }}>Channels &amp; Limits</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Channels" error={errors.channels}>
              <div style={{ display: "flex", gap: 8 }}>
                {CHANNEL_KEYS.map((k) => (
                  <button key={k} type="button" aria-pressed={v.channels.includes(k)} className={`chip ${v.channels.includes(k) ? "selected" : ""}`} onClick={() => toggleIn("channels", k)}>
                    <Icon name={CHANNEL_ICON[k]} size={12} stroke={1.7} />
                    {CHANNEL_LABELS[k]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Qualification Criteria (prompt)" htmlFor="cc-qual" error={errors.qualificationPrompt}>
              <textarea id="cc-qual" className={cls("qualificationPrompt")} rows={2} value={v.qualificationPrompt} onChange={(e) => set("qualificationPrompt", e.target.value)} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Daily Outreach Limit" htmlFor="cc-limit" error={errors.dailyLimit} hint="contacts per day">
                <input id="cc-limit" type="number" min="1" max="1000" className={cls("dailyLimit")} value={v.dailyLimit} onChange={(e) => set("dailyLimit", e.target.value)} />
              </Field>
              <Field label="Working Hours" htmlFor="cc-hours" error={errors.workingHours}>
                <input id="cc-hours" className={cls("workingHours")} value={v.workingHours} onChange={(e) => set("workingHours", e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 16 }}>Human Approval Settings</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {APPROVAL_ROWS.map(([k, label]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ fontSize: 13 }}>{label}</div>
                <Toggle on={v.approvals[k]} label={label} onChange={(on) => set("approvals", { ...v.approvals, [k]: on })} />
              </div>
            ))}
          </div>
          <ApprovalLevel value={v.approvals} onChange={(a) => set("approvals", a)} />
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>Campaign Knowledge / RAG Sources</div>
          <div className="field-hint" style={{ marginBottom: 14, marginTop: 0 }}>
            Retrieved by agents before writing outreach or making a qualification decision.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {v.sources.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8 }}>
                <Icon name="file" size={16} color="var(--text-3)" />
                <div style={{ flexGrow: 1, fontSize: 13 }}>{s.name}</div>
                <Tag>{s.category}</Tag>
                <button type="button" className="link" aria-label={`Remove ${s.name}`} title="Remove this source" style={{ display: "flex", color: "var(--text-3)" }} onClick={() => removeSource(s.id)}>
                  <Icon name="xcircle" size={16} stroke={1.7} />
                </button>
              </div>
            ))}
            {v.sources.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>No knowledge sources. Agents will have nothing to retrieve from.</div>}
            <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => setAddingSource(true)}>
              <Icon name="plus" size={12} stroke={2} />
              Add Source
            </button>
          </div>
        </div>
      </div>

      {addingSource && <AddSourceModal onClose={() => setAddingSource(false)} onAdd={addSource} />}
    </Shell>
  );
}
