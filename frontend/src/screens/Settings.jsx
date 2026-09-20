import React, { useState } from "react";
import Shell from "../components/shell/Shell.jsx";
import Icon from "../components/ui/Icon.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { ConfirmDialog, Modal } from "../components/ui/Modal.jsx";
import Toggle from "../components/ui/Toggle.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useApi } from "../hooks/useApi.js";
import LoadState from "../components/ui/LoadState.jsx";
import { addSuppression, getSettings, setAgentEnabled, setChannelEnabled, setKillSwitch } from "../services/api.js";
import { timeAgo } from "../utils/format.js";
import { validateSuppression } from "../utils/validation.js";

const INTEGRATION_TONE = { connected: "success", idle: "neutral", "not-configured": "warning", problem: "warning", "not-built": "muted" };
const INTEGRATION_LABEL = { connected: "Connected", idle: "Not in use", "not-configured": "Not set up", problem: "Not working", "not-built": "Not built" };
const STATUS_LABEL = { running: "Running", paused: "Paused", stopped: "Stopped" };

export default function Settings() {
  const toast = useToast();
  const { data, error } = useApi(() => getSettings(), []);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ contact: "", reason: "" });
  const [errors, setErrors] = useState({});

  if (!data) return <Shell active="settings" title="Global Controls & Settings"><LoadState error={error} what="settings" /></Shell>;

  const killed = data.killSwitch.active;
  const guard = async (fn, okMessage) => {
    try {
      await fn();
      if (okMessage) toast(okMessage);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const submitSuppression = async () => {
    const errs = validateSuppression(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    await guard(async () => {
      await addSuppression(form);
      setAdding(false);
      setForm({ contact: "", reason: "" });
    }, "Added to the suppression list");
  };

  return (
    <Shell active="settings" title="Global Controls & Settings">
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}>
        <div className="card" style={{ padding: 22, background: "var(--danger-soft)", borderColor: "#F3C9CF" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="dot" style={{ width: 8, height: 8, background: killed ? "var(--danger)" : "var(--success)" }} />
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {killed ? "Global Kill Switch is active — all outreach is stopped" : "All systems operating normally"}
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6, maxWidth: 520 }}>
                Immediately stops all autonomous outreach across every campaign, on every channel. Existing prospect and conversation data is
                preserved. Campaigns stay Live in the background but take no further action until reset.
              </div>
            </div>
            {killed ? (
              <button
                type="button"
                className="btn btn-danger-outline"
                style={{ padding: "12px 22px", flexShrink: 0 }}
                onClick={() => guard(() => setKillSwitch(false), "Global Kill Switch deactivated")}
              >
                <Icon name="power" size={15} stroke={1.8} />
                Deactivate Global Kill Switch
              </button>
            ) : (
              <button type="button" className="btn btn-danger" style={{ padding: "12px 22px", flexShrink: 0 }} onClick={() => setConfirming(true)}>
                <Icon name="power" size={15} stroke={1.8} />
                Activate Global Kill Switch
              </button>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div className="section-title-lg">Agent Controls</div>
          {data.agents.map((a) => (
            <div key={a.id} className="row">
              <div>
                <div style={{ fontSize: 13 }}>{a.name}</div>
                {a.note && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>Paused by {a.note.by} · {timeAgo(a.note.ts)}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>{STATUS_LABEL[a.status]}</span>
                <Toggle tone="success" on={a.enabled} label={`${a.name} enabled`} onChange={(on) => guard(() => setAgentEnabled(a.id, on))} />
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div className="section-title-lg">Channel Controls</div>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>A platform-wide switch for each way of reaching people. Turning a channel off stops every campaign from using it, at once, while everything else keeps running. Use it if a channel has a problem (a bounce spike, a complaint) without pausing whole campaigns.</div>
          {data.channels.map((c) => (
            <div key={c.key} className="row">
              <div>
                <div style={{ fontSize: 13 }}>{c.label}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {c.enabled ? c.note : `Paused platform-wide · ${timeAgo(c.pausedTs)}`}
                </div>
              </div>
              <Toggle tone="success" on={c.enabled} label={`${c.label} enabled`} onChange={(on) => guard(() => setChannelEnabled(c.key, on))} />
            </div>
          ))}
        </div>

        <div className="card">
          <div className="section-title-lg" style={{ padding: "20px 22px 12px 22px", marginBottom: 0 }}>Global Suppression / Do-Not-Contact List</div>
          <table>
            <thead>
              <tr><th>Contact / Domain</th><th>Reason</th><th>Added</th></tr>
            </thead>
            <tbody>
              {data.suppression.map((s) => (
                <tr key={s.id}><td>{s.contact}</td><td>{s.reason}</td><td>{s.added}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "16px 22px" }}>
            <button type="button" className="btn btn-secondary" onClick={() => { setErrors({}); setAdding(true); }}>
              <Icon name="plus" size={12} stroke={2} />
              Add to List
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div className="section-title-lg">Available Models, Tools &amp; Integrations</div>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>What this server is actually using, read from its configuration. Anything marked "Not built" is on the roadmap and is simulated today.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {data.integrations.map((i) => (
              <div key={i.name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flexGrow: 1, fontSize: 13, fontWeight: 600 }}>{i.name}</div>
                  <Badge tone={INTEGRATION_TONE[i.state]}>{INTEGRATION_LABEL[i.state]}</Badge>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 6, lineHeight: 1.5 }}>{i.kind}: {i.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Activate the Global Kill Switch?"
          message="This immediately stops all autonomous outreach across every campaign and channel. Prospect and conversation data is preserved, and each campaign keeps its own status until you deactivate the switch."
          confirmLabel="Activate Kill Switch"
          danger
          onConfirm={() => {
            setConfirming(false);
            guard(() => setKillSwitch(true), "Global Kill Switch activated — all outreach stopped");
          }}
          onCancel={() => setConfirming(false)}
        />
      )}

      {adding && (
        <Modal
          title="Add to suppression list"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submitSuppression}>Add to List</button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label className="field-label" htmlFor="sup-contact">Email or domain</label>
              <input
                id="sup-contact"
                className={`input ${errors.contact ? "error" : ""}`}
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                placeholder="name@company.com or company.com"
              />
              {errors.contact && <div className="field-error">{errors.contact}</div>}
            </div>
            <div>
              <label className="field-label" htmlFor="sup-reason">Reason</label>
              <input
                id="sup-reason"
                className={`input ${errors.reason ? "error" : ""}`}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="e.g. Requested no further contact"
              />
              {errors.reason && <div className="field-error">{errors.reason}</div>}
            </div>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
