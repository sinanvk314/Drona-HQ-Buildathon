import React, { useEffect, useRef, useState } from "react";
import { Badge, Tag } from "../ui/Badge.jsx";
import { ConfirmDialog } from "../ui/Modal.jsx";
import { useToast } from "../ui/Toast.jsx";
import Icon from "../ui/Icon.jsx";
import LoadState from "../ui/LoadState.jsx";
import { useApi } from "../../hooks/useApi.js";
import {
  createSandbox, deleteSandbox, downloadMeetingInvite, getReps, getSandbox, getSandboxes, runSandbox, sandboxFeedback, sandboxReply,
} from "../../services/api.js";
import { timeAgo } from "../../utils/format.js";

const LABEL = { fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const BLANK = { name: "", title: "", organisation: "", email: "", notes: "", objective: "", offer: "", brief: "", repId: "", channel: "email" };

function NewRun({ onCreated, onCancel }) {
  const toast = useToast();
  const { data: reps } = useApi(() => getReps(), [], { pollMs: 0 });
  const [v, setV] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const active = reps ? reps.reps.filter((r) => r.status === "active") : [];

  const submit = async () => {
    const e = {};
    if (!v.name.trim()) e.name = "Enter the person's name.";
    if (!v.organisation.trim()) e.organisation = "Enter their organisation.";
    if (!v.objective.trim()) e.objective = "State what the SDR should achieve.";
    if (!v.offer.trim()) e.offer = "Say what is being offered.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const box = await createSandbox({
        target: { name: v.name, title: v.title, organisation: v.organisation, email: v.email, notes: v.notes },
        objective: v.objective, offer: v.offer, brief: v.brief, repId: v.repId || undefined, channel: v.channel,
      });
      toast("Test run created. Press Run the SDR to start.");
      onCreated(box.id);
    } catch (err) {
      toast(err.message, "error");
      setErrors(err.fields || {});
      setBusy(false);
    }
  };
  const field = (label, key, hint, props = {}, area = false) => (
    <div>
      <label className="field-label" htmlFor={`sb-${key}`}>{label}</label>
      {area ? (
        <textarea id={`sb-${key}`} className={`input ${errors[key] ? "error" : ""}`} rows={props.rows || 3} value={v[key]} placeholder={props.placeholder} onChange={(e) => set(key, e.target.value)} />
      ) : (
        <input id={`sb-${key}`} className={`input ${errors[key] ? "error" : ""}`} value={v[key]} placeholder={props.placeholder} onChange={(e) => set(key, e.target.value)} />
      )}
      {errors[key] ? <div className="field-error">{errors[key]}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );

  return (
    <div className="card" style={{ padding: 22, maxWidth: 760 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>New test run</div>
      <div className="field-hint" style={{ marginTop: 2, marginBottom: 16 }}>
        Enter a real person's details. The SDR will research them, plan and write to them. You then play that person: read what it sends and type your own
        replies, and see whether it books a proper meeting. Nothing is sent to anyone; the conversation happens here.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {field("Person's name", "name", "Who the SDR is trying to reach.", { placeholder: "Full name" })}
          {field("Their role", "title", "Optional. Helps the SDR choose the tone.", { placeholder: "Their job title or position" })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {field("Organisation", "organisation", "Where they work or study.", { placeholder: "Company, college, club..." })}
          {field("Email (optional)", "email", "Only used as the sender/recipient label on the invite.", { placeholder: "Their email address" })}
        </div>
        {field("What is known about them", "notes", "One fact per line. The SDR may only use facts written here: it cannot look anything else up and will not invent anything.", { rows: 4, placeholder: "One thing you know about them per line" }, true)}
        {field("What the SDR should achieve", "objective", "The single outcome to drive toward.", { placeholder: "State the outcome you want" })}
        {field("What is being offered", "offer", "Agents may only make claims that appear here.", { rows: 3, placeholder: "Describe what you are offering and what is in it for them" }, true)}
        {field("Campaign brief (optional)", "brief", "Standing instructions for the SDR: who it is, how it should sound. Empty keeps the default.", { rows: 3, placeholder: "How the SDR should behave and sound" }, true)}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label className="field-label" htmlFor="sb-rep">Send as</label>
            <select id="sb-rep" className="input" value={v.repId} onChange={(e) => set("repId", e.target.value)}>
              <option value="">First available rep</option>
              {active.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.workingHours})</option>)}
            </select>
            <div className="field-hint">Meeting times are offered inside this rep's working hours.</div>
          </div>
          <div>
            <label className="field-label" htmlFor="sb-channel">Channel</label>
            <select id="sb-channel" className="input" value={v.channel} onChange={(e) => set("channel", e.target.value)}>
              <option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="sms">SMS</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>Create test run</button>
          {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}

function Check({ c }) {
  const color = c.pass === true ? "var(--success)" : c.pass === false ? "var(--danger)" : "var(--text-3)";
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "3px 0", alignItems: "center" }}>
      <Icon name={c.pass === false ? "xcircle" : "tick"} size={14} stroke={1.9} color={color} />
      <span style={{ color: c.pass === null ? "var(--text-3)" : "var(--text)" }}>{c.label}</span>
    </div>
  );
}

function Run({ id, onDeleted }) {
  const toast = useToast();
  const { data: box, error } = useApi(() => getSandbox(id), [id]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState({ rating: 0, notes: "" });
  const endRef = useRef(null);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ block: "nearest" });
  }, [box && box.prospect && box.prospect.conversation.length]);

  if (!box) return <LoadState error={error} what="this test run" />;
  const p = box.prospect;
  const started = p && p.touches.length > 0;
  const card = box.scorecard;

  const act = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      if (message) toast(message);
    } catch (e) {
      toast(e.message, "error");
    }
    setBusy(false);
  };
  const send = () => act(async () => { const r = await sandboxReply(id, text); setText(""); return r; });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 18, alignItems: "start" }}>
      <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: 520 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>{p.title ? `${p.title} · ` : ""}{p.company} · you are playing this person</div>
          </div>
          <Badge tone={card.verdict === "Meeting booked" ? "success" : "neutral"}>{card.verdict}</Badge>
          {!started && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => runSandbox(id), "The SDR has written to them")}>Run the SDR</button>}
          <button type="button" className="link" style={{ color: "var(--danger)", fontSize: 12.5 }} onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>

        <div style={{ flexGrow: 1, padding: 20, display: "flex", flexDirection: "column", gap: 10, maxHeight: 520, overflowY: "auto" }}>
          {p.conversation.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
              Nothing has been sent yet. Press <strong>Run the SDR</strong>: it researches this person from the facts you entered, plans the outreach and writes the first
              message, which will appear here.
            </div>
          )}
          {p.conversation.map((m, i) => {
            const out = m.dir === "out";
            return (
              <div key={i} style={{ alignSelf: out ? "flex-start" : "flex-end", maxWidth: "82%" }}>
                <div style={{ fontSize: 10.5, color: "var(--text-3)", margin: "0 4px 3px", textAlign: out ? "left" : "right" }}>
                  {out ? `SDR${m.sender ? ` as ${m.sender}` : ""}` : `${p.name} (you)`}{m.channel ? ` · ${m.channel}` : ""}
                </div>
                <div style={{ padding: "10px 14px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", borderRadius: out ? "12px 12px 12px 2px" : "12px 12px 2px 12px", background: out ? "var(--neutral-soft)" : "var(--accent)", color: out ? "var(--text)" : "#fff" }}>
                  {m.text}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <textarea
              className="input" rows={2} style={{ flexGrow: 1 }} disabled={!started || busy} aria-label="Your reply" value={text}
              placeholder={started ? `Reply as ${p.name}, in your own words` : "Run the SDR first"} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) send(); }}
            />
            <button type="button" className="btn btn-primary" disabled={!started || busy || !text.trim()} onClick={send}>Send</button>
          </div>
          <div className="field-hint" style={{ marginBottom: 0 }}>
            Try asking a question, asking for another time, or saying no. The SDR proposes real times inside {box.rep ? `${box.rep.name}'s hours (${box.rep.workingHours})` : "working hours"} and books the one you choose. Ctrl+Enter sends.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={LABEL}>Scorecard</div>
          {card.meeting && (
            <div style={{ background: "var(--success-soft)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{card.meeting.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)" }}>with {card.meeting.withRep}</div>
              <button type="button" className="link" style={{ fontSize: 12.5, marginTop: 4 }} onClick={() => downloadMeetingInvite(p.id).catch((e) => toast(e.message, "error"))}>Download calendar invite (.ics)</button>
            </div>
          )}
          {card.checks.map((c) => <Check key={c.label} c={c} />)}
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 10, lineHeight: 1.6 }}>
            {card.turns.fromPerson} message{card.turns.fromPerson === 1 ? "" : "s"} from you, {card.turns.fromSdr} from the SDR · {card.llm.decisions} LLM decision{card.llm.decisions === 1 ? "" : "s"}, {card.llm.withoutLlm} without an LLM · est. ${card.llm.costUsd.toFixed(4)}
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={LABEL}>Your verdict</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={(box.feedback ? box.feedback.rating : feedback.rating) >= n} className={`chip ${(box.feedback ? box.feedback.rating : feedback.rating) >= n ? "selected" : ""}`} onClick={() => setFeedback({ ...feedback, rating: n })}>{n}</button>
            ))}
          </div>
          <textarea className="input" rows={2} placeholder="What worked, what did not" value={feedback.notes || (box.feedback ? box.feedback.notes : "")} onChange={(e) => setFeedback({ ...feedback, notes: e.target.value })} />
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} disabled={!feedback.rating} onClick={() => act(() => sandboxFeedback(id, feedback), "Feedback saved")}>Save feedback</button>
          {box.feedback && <div className="field-hint">Saved: {box.feedback.rating}/5 by {box.feedback.by}</div>}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={LABEL}>What the SDR knows (dossier)</div>
          {p.dossier.facts.map((f, i) => <div key={`f${i}`} style={{ fontSize: 12.5, padding: "2px 0" }}>{f.text} <span style={{ color: "var(--text-3)" }}>· {f.source}</span></div>)}
          {p.dossier.hooks.length > 0 && <div style={{ marginTop: 8 }}><div style={{ ...LABEL, marginBottom: 2 }}>Reasons it found to reach out</div>{p.dossier.hooks.map((h, i) => <div key={i} style={{ fontSize: 12.5 }}>{h}</div>)}</div>}
          {p.dossier.gaps.length > 0 && <div style={{ marginTop: 8 }}><div style={{ ...LABEL, marginBottom: 2 }}>What it does not know</div>{p.dossier.gaps.map((g, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--text-2)" }}>{g}</div>)}</div>}
          {p.plan && <div style={{ marginTop: 8, fontSize: 12.5 }}><strong>Plan:</strong> {p.plan.sequence.join(" → ")} <span style={{ color: "var(--text-3)" }}>({p.plan.engine})</span></div>}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={LABEL}>Every decision, in order</div>
          {box.decisions.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>Nothing yet.</div>}
          {box.decisions.map((d, i) => (
            <details key={i} style={{ borderTop: i ? "1px solid var(--border)" : "none", padding: "6px 0" }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5 }}>
                <strong>{d.agent}</strong> <Tag>{d.engine || "n/a"}</Tag> {d.headline} <span style={{ color: "var(--text-3)" }}>{timeAgo(d.ts)}</span>
              </summary>
              <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
                {(d.evidence || []).map((e, j) => <li key={j}>{e}</li>)}
                {d.harness && <li>Prompt: {d.harness}</li>}
                {d.retrieved && d.retrieved.length > 0 && <li>Knowledge used: {d.retrieved.join(", ")}</li>}
              </ul>
            </details>
          ))}
          {box.approvals.length > 0 && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 8 }}>{box.approvals.length} item{box.approvals.length === 1 ? "" : "s"} waiting for a human: {box.approvals.map((a) => a.tag).join("; ")}</div>}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this test run?" message="The conversation, the dossier and every decision from this run are removed. Nothing else is affected." confirmLabel="Delete" danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); act(async () => { await deleteSandbox(id); onDeleted(); }, "Test run deleted"); }}
        />
      )}
    </div>
  );
}

// The judge sandbox: a real person plays the prospect, and the SDR has to earn a meeting.
export default function SandboxTab() {
  const { data: runs, error } = useApi(() => getSandboxes(), []);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (runs && !selected && !creating) {
      if (runs.length) setSelected(runs[0].id);
      else setCreating(true);
    }
  }, [runs]);

  if (!runs) return <LoadState error={error} what="test runs" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {runs.map((r) => (
          <button key={r.id} type="button" aria-pressed={selected === r.id && !creating} className={`chip ${selected === r.id && !creating ? "selected" : ""}`} onClick={() => { setSelected(r.id); setCreating(false); }}>
            {r.target}{r.meeting === "confirmed" ? " ✓" : ""}
          </button>
        ))}
        <button type="button" className="chip dashed" onClick={() => setCreating(true)}>+ New test run</button>
      </div>
      {creating ? (
        <NewRun onCreated={(id) => { setSelected(id); setCreating(false); }} onCancel={runs.length ? () => setCreating(false) : null} />
      ) : selected && runs.some((r) => r.id === selected) ? (
        <Run key={selected} id={selected} onDeleted={() => { setSelected(null); }} />
      ) : null}
    </div>
  );
}
