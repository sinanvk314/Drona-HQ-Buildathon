import React, { useEffect, useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import Icon from "../components/ui/Icon.jsx";
import { Badge, Tag } from "../components/ui/Badge.jsx";
import Toggle from "../components/ui/Toggle.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useApi } from "../hooks/useApi.js";
import { createCampaign, getCampaignConfig, getCampaignDefaults, updateCampaign } from "../services/api.js";
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

// One form for both: with params.id it edits that campaign, without it it creates a new one.
export default function CreateCampaign({ params = {} }) {
  const editId = params.id || null;
  const { navigate } = useNav();
  const toast = useToast();
  const { data: defaults, error: loadError } = useApi(() => (editId ? getCampaignConfig(editId) : getCampaignDefaults()), [editId], { pollMs: 0 });
  const [v, setV] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [addingSource, setAddingSource] = useState(false);

  useEffect(() => {
    if (defaults && !v) setV(defaults);
  }, [defaults]);

  const badge = editId ? null : <Badge tone="neutral">DRAFT</Badge>;
  const title = editId ? "Edit Campaign" : "New Campaign";
  if (!v) {
    return (
      <Shell active="campaigns" title={title} badge={badge}>
        {loadError && <div className="card" style={{ padding: 20, fontSize: 13.5 }}>{loadError}</div>}
      </Shell>
    );
  }

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
  const mode = v.mode === "single" ? "single" : "bulk";
  const single = mode === "single";
  const dataReal = v.sourcing === "real";
  const chooseData = (isReal) => {
    setV((p) => ({ ...p, sourcing: isReal ? "real" : "simulated-search", channels: p.channels.filter((k) => (isReal ? k !== "linkedin" : k !== "voice")) }));
  };
  const target = { name: "", title: "", organisation: "", email: "", ...(v.target || {}), notes: Array.isArray(v.target && v.target.notes) ? v.target.notes.join("\n") :(v.target && v.target.notes) || "" };
  const setTarget = (k, val) => {
    set("target", { ...target, [k]: val });
    const key = k === "name" ? "targetName" : k === "organisation" ? "targetOrganisation" : null;
    if (key && errors[key]) setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  };
  const toggleIn = (k, item) => set(k, v[k].includes(item) ? v[k].filter((x) => x !== item) : [...v[k], item]);
  const addOption = (optKey, selKey, label) => {
    if (!v[optKey].includes(label)) setV((p) => ({ ...p, [optKey]: [...p[optKey], label], [selKey]: [...p[selKey], label] }));
    else if (!v[selKey].includes(label)) toggleIn(selKey, label);
  };

  const save = async () => {
    // A campaign that has already been launched must stay fully valid; a Draft only needs a name.
    const errs = validateCampaign(v, v.rawStatus !== "draft");
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast("Please fix the highlighted fields.", "error");
      return;
    }
    setBusy(true);
    try {
      await updateCampaign(editId, v);
      toast("Changes saved. They apply from the next agent run.");
      navigate("campaignDetail", { id: editId });
    } catch (e) {
      if (e.fields) setErrors(e.fields);
      toast(e.message, "error");
      setBusy(false);
    }
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
      {editId ? (
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => navigate("campaignDetail", { id: editId })}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save changes</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => submit(false)}>Save as Draft</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>Launch Campaign</button>
        </>
      )}
    </div>
  );

  const cls = (k) => `input ${errors[k] ? "error" : ""}`;

  return (
    <Shell active="campaigns" title={title} badge={badge} footer={footer}>
      <div style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>Who is this campaign for?</div>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
            {editId ? "This cannot be changed once the campaign exists." : "Choose whether the SDR should find a whole audience, or work on one specific person."}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              ["bulk", "A group matching an ICP", "The SDR finds people that fit the description, judges who qualifies and reaches out to each."],
              ["single", "One specific person", "You name one person. The SDR researches them and works only on them until they answer or a meeting is booked."],
            ].map(([key, label, body]) => (
              <button
                key={key} type="button" aria-pressed={mode === key} disabled={!!editId && mode !== key}
                onClick={() => !editId && set("mode", key)}
                style={{ textAlign: "left", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${mode === key ? "var(--accent)" : "var(--border-strong)"}`, background: mode === key ? "var(--accent-soft)" : "#fff", cursor: editId ? "default" : "pointer", opacity: editId && mode !== key ? 0.5 : 1, fontFamily: "inherit" }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{label}</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>{body}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>Real or simulated data?</div>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
            {editId ? "This cannot be changed once the campaign exists." : "Simulated is safe for testing: an AI makes up the people and every reply, and nothing is sent. Real uses only people you have added by hand, and can send real email, texts and calls."}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              [false, "Simulated (AI)", "The people are made up by an AI acting as a search tool, and replies are simulated. Nothing is ever sent."],
              [true, "Real", single ? "The person below is real. The SDR can email, text or call them for real, and reads their real replies." : "Prospects are chosen from the real contacts you added in the Dev tab. The SDR can email, text or call them for real."],
            ].map(([isReal, label, body]) => (
              <button
                key={label} type="button" aria-pressed={dataReal === isReal} disabled={!!editId && dataReal !== isReal}
                onClick={() => !editId && chooseData(isReal)}
                style={{ textAlign: "left", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${dataReal === isReal ? (isReal ? "var(--danger)" : "var(--accent)") : "var(--border-strong)"}`, background: dataReal === isReal ? (isReal ? "var(--danger-soft)" : "var(--accent-soft)") : "#fff", cursor: editId ? "default" : "pointer", opacity: editId && dataReal !== isReal ? 0.5 : 1, fontFamily: "inherit" }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{label}</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>{body}</div>
              </button>
            ))}
          </div>
          {dataReal && (
            <div style={{ fontSize: 12.5, marginTop: 12, lineHeight: 1.6, color: "var(--text-2)" }}>
              <strong>Safety:</strong> every message to a real person waits in Approvals for a human, and real sending must be switched on for this server (Settings shows what is connected). LinkedIn cannot be sent for real. {single ? "" : "Add contacts under Dev, Real contacts."}
            </div>
          )}
          {!dataReal && !single && (
            <div style={{ marginTop: 12 }}>
              <Field label="How the people are made up" htmlFor="cc-sourcing" hint="The imitated search asks an AI to act as a people-search tool for any audience. The free generator only makes up companies.">
                <select id="cc-sourcing" className="input" value={v.sourcing || "simulated-search"} onChange={(e) => set("sourcing", e.target.value)}>
                  <option value="simulated-search">Imitated people search (AI, fictional people)</option>
                  <option value="synthetic">Free generator (made-up companies)</option>
                </select>
              </Field>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Field label="Who are you looking for?" htmlFor="cc-kind" hint={v.audienceKind === "individuals" ? (dataReal ? "Individuals: no organisation is needed for each person." : "Individuals, including famous people and public figures. The AI may name well-known public figures using only widely known facts; every email is still a made-up address.") : "People who work at or belong to organisations: companies, colleges, clubs."}>
              <select id="cc-kind" className="input" value={v.audienceKind || "organisations"} onChange={(e) => set("audienceKind", e.target.value)}>
                <option value="organisations">People at organisations (companies, colleges, clubs)</option>
                <option value="individuals">Individuals and public figures (famous people, creators)</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 16 }}>Campaign Identity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Campaign Name" htmlFor="cc-name" error={errors.name} hint="A short name managers will recognise on the dashboard and in reports.">
              <input id="cc-name" className={cls("name")} value={v.name} placeholder="What this campaign is called" onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="cc-desc" error={errors.description} hint="What this campaign is for, in a sentence or two. Shown on the campaign page.">
              <textarea id="cc-desc" className={cls("description")} rows={2} value={v.description} placeholder="Explain the purpose of the campaign" onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Owner" htmlFor="cc-owner" error={errors.owner} hint="The person responsible for this campaign. Defaults to you.">
                <input id="cc-owner" className={cls("owner")} value={v.owner} onChange={(e) => set("owner", e.target.value)} />
              </Field>
              <Field label="Campaign Objective" htmlFor="cc-objective" error={errors.objective} hint="The one outcome the SDR drives every prospect toward. Every message is aimed at it.">
                <input id="cc-objective" className={cls("objective")} value={v.objective} placeholder="State the single outcome you want" onChange={(e) => set("objective", e.target.value)} />
              </Field>
            </div>
            <Field label="What We Offer" htmlFor="cc-offer" error={errors.offer} hint="What the SDR is offering these people, in plain words: the product, service or opportunity and why they would care. Agents may only make claims about it that appear here or in the knowledge sources.">
              <textarea id="cc-offer" className={cls("offer")} rows={3} value={v.offer} placeholder="Describe what you are offering and what is in it for the person" onChange={(e) => set("offer", e.target.value)} />
            </Field>
            {!editId && (
              <Field label="Campaign Brief (the initial prompt)" htmlFor="cc-brief" hint="The standing instructions every agent in this campaign receives first: who the SDR is, how it should sound, what to avoid. Leave it empty to start from a sensible default. You can change it later and every change is kept as a version you can compare and roll back.">
                <textarea id="cc-brief" className="input" rows={4} value={v.brief || ""} placeholder="Write the standing instructions for the SDR, or leave empty for the default" onChange={(e) => set("brief", e.target.value)} />
              </Field>
            )}
          </div>
        </div>

        {single ? (
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>The Person</div>
            <div className="field-hint" style={{ marginTop: 0, marginBottom: 14 }}>
              The SDR can only use what you write here: it does not look anything up. The more you know, the more specific its message can be.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Name" htmlFor="cc-tname" error={errors.targetName} hint="Who the SDR is trying to reach.">
                  <input id="cc-tname" className={cls("targetName")} value={target.name} placeholder="Full name" onChange={(e) => setTarget("name", e.target.value)} />
                </Field>
                <Field label="Role" htmlFor="cc-ttitle" hint="Optional. Helps the SDR choose the tone.">
                  <input id="cc-ttitle" className="input" value={target.title} placeholder="Their job title or position" onChange={(e) => setTarget("title", e.target.value)} />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label={v.audienceKind === "individuals" ? "Organisation or what they are known for (optional)" : "Organisation"} htmlFor="cc-torg" error={errors.targetOrganisation} hint="Where they work or study, or what they are known for.">
                  <input id="cc-torg" className={cls("targetOrganisation")} value={target.organisation} placeholder="Company, college, club..." onChange={(e) => setTarget("organisation", e.target.value)} />
                </Field>
                <Field label={dataReal ? "Email (or a phone number)" : "Email"} htmlFor="cc-temail" error={errors.targetEmail} hint={dataReal ? "A real address: the SDR will send to it, and the invite goes here." : (target.email && !/\.example$/i.test(target.email) ? "This looks like a real address, but the data is set to Simulated: nothing will be emailed and replies will be made up. Choose Real above to email them." : "Optional. Used for the calendar invite once a meeting is booked.")}>
                  <input id="cc-temail" className={cls("targetEmail")} value={target.email} placeholder="Their email address" onChange={(e) => setTarget("email", e.target.value)} />
                </Field>
              </div>
              {dataReal && (
                <Field label="Phone number" htmlFor="cc-tphone" hint="With the country code, for example +91 98765 43210. Needed for texts and calls.">
                  <input id="cc-tphone" className="input" value={target.phone || ""} placeholder="Their number" onChange={(e) => setTarget("phone", e.target.value)} />
                </Field>
              )}
              <Field label="What is known about them" htmlFor="cc-tnotes" hint="One fact per line: things they have done, said or care about. The SDR may refer to these and to nothing else about them.">
                <textarea id="cc-tnotes" className="input" rows={4} value={target.notes} placeholder="One thing you know about them per line" onChange={(e) => setTarget("notes", e.target.value)} />
              </Field>
            </div>
          </div>
        ) : (
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 16 }}>Targeting &amp; ICP</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="ICP / Target Audience" htmlFor="cc-icp" error={errors.icpText} hint="Who the ideal person is, in plain words: their role, the kind of organisation, its size and region, and any signal that makes them a good fit. The ICP agent judges every prospect against this.">
              <textarea id="cc-icp" className={cls("icpText")} rows={3} value={v.icpText} placeholder="Describe the ideal person and organisation" onChange={(e) => set("icpText", e.target.value)} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Geography" error={errors.geography} hint="Where the people are. Add your own with + Add.">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {v.geographyOptions.map((g) => (
                    <button key={g} type="button" aria-pressed={v.geography.includes(g)} className={`chip ${v.geography.includes(g) ? "selected" : ""}`} onClick={() => toggleIn("geography", g)}>
                      {g}
                    </button>
                  ))}
                  <AddChip onAdd={(label) => addOption("geographyOptions", "geography", label)} />
                </div>
              </Field>
              <Field label="Target Personas / Roles" error={errors.personas} hint="The roles or titles you want to reach. Add your own with + Add.">
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
            <Field label="Organisation Criteria" htmlFor="cc-company" hint="Facts about the organisation that must be true: its size, type or stage.">
              <input id="cc-company" className="input" placeholder="What must be true about the organisation" value={v.companyCriteria} onChange={(e) => set("companyCriteria", e.target.value)} />
            </Field>
            <Field label="Exclusion Criteria" htmlFor="cc-excl" hint="People or organisations to always skip. Anyone matching is rejected on sight.">
              <input id="cc-excl" className="input" placeholder="Who must never be contacted" value={v.exclusionCriteria} onChange={(e) => set("exclusionCriteria", e.target.value)} />
            </Field>
          </div>
        </div>

        )}

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 16 }}>Channels &amp; Limits</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Channels" error={errors.channels} hint="Where the SDR may reach people. A channel that is turned off is never used.">
              <div style={{ display: "flex", gap: 8 }}>
                {CHANNEL_KEYS.map((k) => {
                  const blocked = (k === "voice" && !dataReal) ? "The Voice SDR only calls real people" : (k === "linkedin" && dataReal) ? "LinkedIn cannot be sent for real" : "";
                  return (
                    <button key={k} type="button" disabled={!!blocked} title={blocked || undefined} aria-pressed={v.channels.includes(k)} className={`chip ${v.channels.includes(k) ? "selected" : ""}`} style={blocked ? { opacity: 0.45, cursor: "not-allowed" } : undefined} onClick={() => toggleIn("channels", k)}>
                      <Icon name={CHANNEL_ICON[k]} size={12} stroke={1.7} />
                      {CHANNEL_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </Field>
            {!single && (
            <Field label="Qualification Criteria (prompt)" htmlFor="cc-qual" error={errors.qualificationPrompt} hint="The rule the ICP agent uses to score fit and decide who qualifies, including the score needed. This is the most important prompt for deciding who gets contacted.">
              <textarea id="cc-qual" className={cls("qualificationPrompt")} rows={3} placeholder="State what makes someone qualify and the score needed" value={v.qualificationPrompt} onChange={(e) => set("qualificationPrompt", e.target.value)} />
            </Field>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Daily Outreach Limit" htmlFor="cc-limit" error={errors.dailyLimit} hint="The most touches this campaign sends in one (simulated) day.">
                <input id="cc-limit" type="number" min="1" max="1000" className={cls("dailyLimit")} value={v.dailyLimit} onChange={(e) => set("dailyLimit", e.target.value)} />
              </Field>
              <Field label="Working Hours" htmlFor="cc-hours" error={errors.workingHours} hint="When the SDR may send, as a start and an end time.">
                <input id="cc-hours" className={cls("workingHours")} placeholder="Start and end time" value={v.workingHours} onChange={(e) => set("workingHours", e.target.value)} />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Touches per Prospect" htmlFor="cc-touches" hint="the opening message plus follow-ups; the Follow-up agent stops here">
                <input id="cc-touches" type="number" min="1" max="6" className="input" value={v.cadence ? v.cadence.maxTouches : 3} onChange={(e) => set("cadence", { ...v.cadence, maxTouches: e.target.value })} />
              </Field>
              <Field label="Wait Between Touches (hours)" htmlFor="cc-wait" hint="simulated hours, 24 to 168">
                <input id="cc-wait" type="number" min="24" max="168" className="input" value={v.cadence ? v.cadence.waitHours : 72} onChange={(e) => set("cadence", { ...v.cadence, waitHours: e.target.value })} />
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

        {editId ? (
          <div className="card" style={{ padding: 22, fontSize: 13, color: "var(--text-2)" }}>
            Knowledge sources are managed on the campaign page, where adding or removing one takes effect immediately.
          </div>
        ) : (
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
        )}
      </div>

      {addingSource && <AddSourceModal onClose={() => setAddingSource(false)} onAdd={addSource} />}
    </Shell>
  );
}
