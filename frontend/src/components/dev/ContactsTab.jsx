import React, { useState } from "react";
import { Badge } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import LoadState from "../ui/LoadState.jsx";
import { ConfirmDialog } from "../ui/Modal.jsx";
import { useApi } from "../../hooks/useApi.js";
import { addContact, getContacts, removeContact } from "../../services/api.js";

const BLANK = { name: "", title: "", organisation: "", email: "", phone: "", kind: "person", notes: "" };

// The real people a real campaign draws from. Nothing here is invented: what you type is what the SDR knows and where it sends.
export default function ContactsTab() {
  const toast = useToast();
  const { data: list, error } = useApi(() => getContacts(), []);
  const [v, setV] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [removing, setRemoving] = useState(null);
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));

  if (!list) return <LoadState error={error} what="the real contacts" />;

  const add = async () => {
    try {
      await addContact(v);
      setV(BLANK);
      setErrors({});
      toast("Contact added");
    } catch (e) {
      setErrors(e.fields || {});
      toast(e.message, "error");
    }
  };
  const input = (label, key, placeholder, hint) => (
    <div>
      <label className="field-label" htmlFor={`rc-${key}`}>{label}</label>
      <input id={`rc-${key}`} className={`input ${errors[key] ? "error" : ""}`} value={v[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} />
      {errors[key] ? <div className="field-error">{errors[key]}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 940 }}>
      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Real contacts</div>
        <div className="field-hint" style={{ marginTop: 2, marginBottom: 14 }}>
          Real people, with real contact details, that a campaign set to <strong>Real</strong> data can work on. Anyone here can be emailed, texted or called for real once a human approves the message, so add only people who expect to hear from you.
          A campaign picks the contacts that best match its audience. Famous people are fine too: add the address you actually have for them.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {input("Name", "name", "Full name")}
          {input("Role", "title", "Their job title or what they do")}
          {input("Organisation", "organisation", "Where they work or what they are known for", "Optional for individuals.")}
          {input("Email", "email", "Their real email address", "An email or a phone number is needed.")}
          {input("Phone", "phone", "With the country code, for example +91 98765 43210")}
          <div>
            <label className="field-label" htmlFor="rc-kind">Kind</label>
            <select id="rc-kind" className="input" value={v.kind} onChange={(e) => set("kind", e.target.value)}>
              <option value="person">A person</option>
              <option value="public figure">A public figure</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="field-label" htmlFor="rc-notes">What is known about them</label>
          <textarea id="rc-notes" className="input" rows={3} value={v.notes} placeholder="One fact per line. The SDR may refer to these and to nothing else about them." onChange={(e) => set("notes", e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={add}>Add contact</button>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{list.length} contact{list.length === 1 ? "" : "s"}</div>
        {list.length === 0 && <div className="field-hint" style={{ marginTop: 0 }}>None yet.</div>}
        {list.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
            <div style={{ flexGrow: 1 }}>
              <strong>{c.name}</strong> <span style={{ color: "var(--text-2)" }}>· {c.title ? `${c.title}, ` : ""}{c.organisation || "Independent"}</span>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
            </div>
            {c.kind === "public figure" && <Badge tone="accent">Public figure</Badge>}
            {c.usedIn.length > 0 && <Badge tone="neutral">In {c.usedIn.length} campaign{c.usedIn.length === 1 ? "" : "s"}</Badge>}
            <button type="button" className="link" style={{ color: "var(--danger)", fontSize: 12.5 }} onClick={() => setRemoving(c)}>Remove</button>
          </div>
        ))}
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`} message="They are taken off the list, so no new campaign will pick them. Campaigns that already took them keep their record." confirmLabel="Remove" danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => { const id = removing.id; setRemoving(null); removeContact(id).catch((e) => toast(e.message, "error")); }}
        />
      )}
    </div>
  );
}
