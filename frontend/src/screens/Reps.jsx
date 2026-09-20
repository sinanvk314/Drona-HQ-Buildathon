import React, { useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import { useNav } from "../components/shell/NavContext.jsx";
import { Badge, Tag } from "../components/ui/Badge.jsx";
import { ConfirmDialog, Modal } from "../components/ui/Modal.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import Icon from "../components/ui/Icon.jsx";
import { useApi } from "../hooks/useApi.js";
import LoadState from "../components/ui/LoadState.jsx";
import { createRep, getReps, offboardRep, reassignRep, updateRep } from "../services/api.js";
import { CHANNEL_KEYS, CHANNEL_LABELS } from "../data/constants.js";

const BLANK = { name: "", email: "", channels: ["email"], dailyLimit: 25, workingHours: "9:00 AM – 6:00 PM" };

function RepForm({ initial, onClose, onSave }) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const toggleChannel = (k) => set("channels", v.channels.includes(k) ? v.channels.filter((x) => x !== k) : [...v.channels, k]);
  const submit = async () => {
    setBusy(true);
    try {
      await onSave(v);
    } catch (e) {
      setErrors(e.fields || { name: e.message });
      setBusy(false);
    }
  };
  const field = (label, key, props = {}) => (
    <div>
      <label className="field-label" htmlFor={`rep-${key}`}>{label}</label>
      <input id={`rep-${key}`} className={`input ${errors[key] ? "error" : ""}`} value={v[key]} onChange={(e) => set(key, e.target.value)} {...props} />
      {errors[key] && <div className="field-error">{errors[key]}</div>}
    </div>
  );
  return (
    <Modal
      title={initial.id ? `Edit ${initial.name}` : "Add representative"}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{initial.id ? "Save changes" : "Add rep"}</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {field("Name", "name")}
        {field("Email (used as the sender identity)", "email")}
        <div>
          <div className="field-label">Channels this rep works</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHANNEL_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={v.channels.includes(k)} className={`chip ${v.channels.includes(k) ? "selected" : ""}`} onClick={() => toggleChannel(k)}>{CHANNEL_LABELS[k]}</button>
            ))}
          </div>
          {errors.channels && <div className="field-error">{errors.channels}</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {field("Daily activity limit", "dailyLimit", { type: "number", min: 1, max: 500 })}
          {field("Working hours", "workingHours")}
        </div>
        <div className="field-hint" style={{ marginTop: 0 }}>Limits and hours run on the simulated clock, like the campaign's own.</div>
      </div>
    </Modal>
  );
}

// Representatives (PS): who can execute which campaign, whose identity a touch is sent under, their daily limits,
// working hours and channels, and what happens when a rep is offboarded.
export default function Reps() {
  const { navigate } = useNav();
  const toast = useToast();
  const { data, error } = useApi(() => getReps(), []);
  const [form, setForm] = useState(null);
  const [offboarding, setOffboarding] = useState(null);
  const [reassigning, setReassigning] = useState(null); // { rep, to }

  if (!data) return <Shell active="reps" title="Representatives"><LoadState error={error} what="representatives" /></Shell>;
  const active = data.reps.filter((r) => r.status === "active");

  const guard = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <Shell active="reps" title="Representatives">
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {data.alerts.length > 0 && (
          <div className="card" style={{ padding: "14px 20px", background: "var(--danger-soft)", borderColor: "#F2C7C7", display: "flex", gap: 12, alignItems: "center" }}>
            <Icon name="warning" size={19} stroke={1.7} color="var(--danger)" />
            <div style={{ fontSize: 13.5 }}>
              <strong>{data.alerts.map((c) => c.name).join(", ")}</strong> {data.alerts.length === 1 ? "has" : "have"} no active rep and cannot send. Reassign {data.alerts.length === 1 ? "it" : "them"} to an active rep below.
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>
            A campaign sends every touch as one of the reps assigned to it, within that rep's channels, hours and daily limit.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setForm(BLANK)}>
            <Icon name="plus" size={14} stroke={2} />
            Add rep
          </button>
        </div>

        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Rep</th><th>Channels</th><th>Today / limit</th><th>Working hours</th><th>Campaigns</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {data.reps.map((r) => (
                <tr key={r.id} style={r.status !== "active" ? { opacity: 0.6 } : undefined}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{r.email}</div>
                  </td>
                  <td>{r.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}</td>
                  <td>{r.sentToday} / {r.dailyLimit}</td>
                  <td>{r.workingHours}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {r.campaigns.length === 0 && <span style={{ color: "var(--text-3)" }}>None</span>}
                      {r.campaigns.map((c) => (
                        <button key={c.id} type="button" className="link" onClick={() => navigate("campaignDetail", { id: c.id })}>{c.name}</button>
                      ))}
                    </div>
                  </td>
                  <td><Badge tone={r.status === "active" ? "success" : "neutral"}>{r.status === "active" ? "Active" : "Offboarded"}</Badge></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.status === "active" ? (
                      <div style={{ display: "flex", gap: 12 }}>
                        <button type="button" className="btn btn-secondary" style={{ padding: "5px 14px", fontSize: 12.5 }} onClick={() => setForm(r)}>Edit</button>
                        <button type="button" className="btn btn-danger-outline" style={{ padding: "5px 14px", fontSize: 12.5 }} onClick={() => setOffboarding(r)}>Offboard</button>
                      </div>
                    ) : (
                      r.campaigns.length > 0 && <button type="button" className="link" onClick={() => setReassigning({ rep: r, to: (active[0] || {}).id })}>Reassign</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <RepForm
          initial={form}
          onClose={() => setForm(null)}
          onSave={async (v) => {
            if (v.id) await updateRep(v.id, v);
            else await createRep(v);
            setForm(null);
            toast(v.id ? "Rep updated" : "Rep added");
          }}
        />
      )}

      {offboarding && (
        <ConfirmDialog
          title={`Offboard ${offboarding.name}?`}
          message={
            offboarding.campaigns.length
              ? `${offboarding.name} stops sending immediately. ${offboarding.campaigns.length} campaign${offboarding.campaigns.length === 1 ? "" : "s"} use them (${offboarding.campaigns.map((c) => c.name).join(", ")}). You can reassign them next; a campaign with no other active rep is held until you do.`
              : `${offboarding.name} is not assigned to any campaign.`
          }
          confirmLabel="Offboard"
          danger
          onCancel={() => setOffboarding(null)}
          onConfirm={() => {
            const rep = offboarding;
            setOffboarding(null);
            guard(async () => {
              await offboardRep(rep.id);
              if (rep.campaigns.length && active.filter((r) => r.id !== rep.id).length) setReassigning({ rep, to: active.find((r) => r.id !== rep.id).id });
            }, `${rep.name} offboarded`);
          }}
        />
      )}

      {reassigning && (
        <Modal
          title={`Reassign ${reassigning.rep.name}'s work`}
          onClose={() => setReassigning(null)}
          width={460}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setReassigning(null)}>Later</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!reassigning.to}
                onClick={() => {
                  const { rep, to } = reassigning;
                  setReassigning(null);
                  guard(async () => {
                    const r = await reassignRep(rep.id, to);
                    toast(`Moved ${r.campaigns} campaign${r.campaigns === 1 ? "" : "s"} and ${r.prospects} prospect${r.prospects === 1 ? "" : "s"}`);
                  });
                }}
              >
                Reassign
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12 }}>
            Their campaigns and prospects move to the rep you choose. Touches already sent stay recorded under {reassigning.rep.name}.
          </div>
          <label className="field-label" htmlFor="reassign-to">Reassign to</label>
          <select id="reassign-to" className="input" value={reassigning.to || ""} onChange={(e) => setReassigning({ ...reassigning, to: e.target.value })}>
            {active.filter((r) => r.id !== reassigning.rep.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Modal>
      )}
    </Shell>
  );
}
