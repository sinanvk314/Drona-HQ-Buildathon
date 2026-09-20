import React, { useState } from "react";
import { Badge } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import LoadState from "../ui/LoadState.jsx";
import { useApi } from "../../hooks/useApi.js";
import { checkInboxNow, getEmailStatus, sendTestEmail, testEmailConnection } from "../../services/api.js";
import { timeAgo } from "../../utils/format.js";

const TONE = { sent: "success", failed: "danger", sending: "neutral" };
const Row = ({ k, children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 12, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
    <div style={{ color: "var(--text-2)" }}>{k}</div>
    <div style={{ wordBreak: "break-word" }}>{children}</div>
  </div>
);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Is real email working? Each button asks Gmail directly and shows exactly what it answers, so a problem is never a mystery.
export default function EmailTab() {
  useToast();
  const { data, error } = useApi(() => getEmailStatus(), [], { pollMs: 10000 });
  const [to, setTo] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");

  if (!data) return <LoadState error={error} what="the email status" />;

  const run = async (name, fn) => {
    setBusy(name);
    setResult(null);
    try {
      setResult({ ok: true, name, value: await fn() });
    } catch (e) {
      setResult({ ok: false, name, message: e.message });
    }
    setBusy("");
  };
  const summary = (r) => {
    if (r.value.note) return r.value.note;
    if (r.name === "inbox check") {
      const v = r.value;
      return `Looked at ${plural(v.checked, "conversation", "conversations")}: ${plural(v.replies, "reply", "replies")}, ${v.autoReplies} automatic, ${v.bounces} bounced.${v.errors.length ? ` Problems: ${v.errors.join("; ")}` : ""}`;
    }
    return "";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 940 }}>
      <div className="card" style={{ padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Real email</div>
          <Badge tone={data.ready ? "success" : "warning"}>{data.ready ? "Ready to send" : "Not ready"}</Badge>
        </div>
        {!data.ready && <div className="field-hint" style={{ marginTop: 0, color: "var(--danger)" }}>{data.blocker}</div>}
        <Row k="Gmail credentials">{data.credentials ? "All four GMAIL_ values are set" : "Missing: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN and GMAIL_SENDER"}</Row>
        <Row k="Sending from">{data.sender || "not set"}</Row>
        <Row k="REAL_SENDING">{data.realSending ? "on" : "off: nothing is sent for real"}</Row>
        <Row k="Recipient allow-list">{data.allowlist.length ? data.allowlist.join(", ") : "none: any real address may receive mail once a human approves"}</Row>
        <Row k="Human approval">{data.autoSend ? "off (REAL_AUTO_SEND is on)" : "every message to a real person waits for a human"}</Row>
        <Row k="Inbox checked">every {data.pollSeconds} seconds, for people you have emailed</Row>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Try it</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run("connection", () => testEmailConnection())}>1. Test the connection</button>
          <div style={{ flexGrow: 1, minWidth: 220 }}>
            <label className="field-label" htmlFor="et-to">Send a test email to</label>
            <input id="et-to" className="input" value={to} placeholder="An address you can read" onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" disabled={!!busy || !to.trim()} onClick={() => run("test email", () => sendTestEmail(to))}>2. Send a test email</button>
          <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run("inbox check", () => checkInboxNow())}>3. Check the inbox now</button>
        </div>
        <div className="field-hint">1 proves the credentials work and shows which mailbox mail comes from. 2 sends one real email now (only to an address the allow-list permits). 3 reads the replies to everyone you have emailed, instead of waiting for the next check.</div>
        {busy && <div style={{ fontSize: 13, marginTop: 10 }}>Asking Gmail…</div>}
        {result && (
          <div style={{ marginTop: 12, borderRadius: 8, padding: "10px 12px", fontSize: 13, lineHeight: 1.6, background: result.ok ? "var(--success-soft)" : "var(--danger-soft)" }}>
            <strong>{result.ok ? `Worked: ${result.name}` : `Failed: ${result.name}`}</strong>
            <div>{result.ok ? summary(result) : result.message}</div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Recent real messages</div>
        {data.recent.length === 0 && <div className="field-hint" style={{ marginTop: 0 }}>None yet. A message appears here when a human approves it in Approvals.</div>}
        {data.recent.map((m, i) => (
          <div key={i} style={{ borderTop: "1px solid var(--border)", padding: "9px 0", fontSize: 13 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Badge tone={TONE[m.status] || "neutral"}>{m.status === "sent" ? "Sent" : m.status === "failed" ? "Not delivered" : "Sending"}</Badge>
              <strong>{m.prospect}</strong>
              <span style={{ color: "var(--text-2)" }}>{m.channel} to {m.to || "n/a"} · {m.campaign}</span>
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>{m.ts ? timeAgo(m.ts) : ""}</span>
            </div>
            <div style={{ fontSize: 12.5, color: m.error ? "var(--danger)" : "var(--text-2)", marginTop: 3 }}>{m.error || m.preview}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Inbox checks by campaign</div>
        {data.inboxes.length === 0 && <div className="field-hint" style={{ marginTop: 0 }}>No real campaigns yet.</div>}
        {data.inboxes.map((c, i) => (
          <div key={i} style={{ borderTop: i ? "1px solid var(--border)" : "none", padding: "7px 0", fontSize: 13 }}>
            <strong>{c.campaign}</strong> <span style={{ color: "var(--text-3)" }}>({c.status})</span>
            <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
              {c.inbox
                ? `Last checked ${timeAgo(c.inbox.ts)}: ${plural(c.inbox.checked, "conversation", "conversations")}, ${plural(c.inbox.replies, "reply", "replies")}${c.inbox.errors.length ? `. Problems: ${c.inbox.errors.join("; ")}` : ""}`
                : "Not checked yet. It is checked once someone has been emailed."}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
