import React, { useRef, useState } from "react";
import { Modal } from "../ui/Modal.jsx";

export const SOURCE_CATEGORIES = ["Product info", "Case study", "Objections", "Playbook & examples", "Other"];
const MAX_CHARS = 60000;
const MIN_CHARS = 20;

// Adds a knowledge source. The text itself is what agents retrieve from, so a source is name + type +
// text: typed, pasted, or loaded from a .txt/.md file (read in the browser, nothing is uploaded elsewhere).
export default function AddSourceModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(SOURCE_CATEGORIES[0]);
  const [content, setContent] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const loadFile = (file) => {
    if (!file) return;
    if (file.size > MAX_CHARS * 4) {
      setErrors({ content: "That file is too large. Keep each source under about 60,000 characters." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result || ""));
      if (!name.trim()) setName(file.name);
      setErrors({});
    };
    reader.onerror = () => setErrors({ content: "Could not read that file. Paste its text instead." });
    reader.readAsText(file);
  };

  const submit = async () => {
    const errs = {};
    if (name.trim().length < 3) errs.name = "Enter a source name (at least 3 characters).";
    if (content.trim().length < MIN_CHARS) errs.content = "Paste or load the source text (at least 20 characters).";
    else if (content.length > MAX_CHARS) errs.content = "That is too long. Keep each source under 60,000 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await onAdd({ name: name.trim(), category, content: content.trim() });
    } catch (e) {
      setErrors(e.fields || { content: e.message });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add knowledge source"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>Add Source</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="field-label" htmlFor="src-name">Source name</label>
          <input id="src-name" className={`input ${errors.name ? "error" : ""}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pricing FAQ" />
          {errors.name && <div className="field-error">{errors.name}</div>}
        </div>
        <div>
          <label className="field-label" htmlFor="src-cat">Type</label>
          <select id="src-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {SOURCE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label className="field-label" htmlFor="src-content">Content</label>
            <button type="button" className="link" style={{ fontSize: 12.5 }} onClick={() => fileRef.current && fileRef.current.click()}>
              Load from a .txt / .md file
            </button>
            <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" style={{ display: "none" }} onChange={(e) => loadFile(e.target.files[0])} />
          </div>
          <textarea
            id="src-content"
            className={`input ${errors.content ? "error" : ""}`}
            style={{ minHeight: 170, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste the document text. Separate topics with a blank line: agents retrieve the most relevant paragraphs."
          />
          {errors.content ? <div className="field-error">{errors.content}</div> : <div className="field-hint">{content.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters</div>}
        </div>
      </div>
    </Modal>
  );
}
