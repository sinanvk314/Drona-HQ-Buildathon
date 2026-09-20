import React, { useEffect, useState } from "react";
import { getAuthConfig, signIn } from "../services/api.js";

// The sign-in page. It asks for a name (pre-filled with JD, so pressing Continue just opens that account) and, when
// the server has an access code set, the code. The name is who approvals, prompt changes and pauses are recorded as.
export default function Login() {
  const [name, setName] = useState("JD");
  const [code, setCode] = useState("");
  const [codeRequired, setCodeRequired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAuthConfig()
      .then((c) => setCodeRequired(!!c.codeRequired))
      .catch(() => setError("Cannot reach the server. Check that the backend is running."));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn({ name, code });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 24 }}>
      <form onSubmit={submit} className="card" style={{ width: 380, maxWidth: "100%", padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>N</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>NimbusGuard SDR</div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>Autonomous SDR control plane</div>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="login-name">Your name</label>
          <input id="login-name" className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="JD" />
          <div className="field-hint">Approvals, prompt changes and pauses are recorded under this name.</div>
        </div>

        {codeRequired && (
          <div>
            <label className="field-label" htmlFor="login-code">Access code</label>
            <input id="login-code" type="password" className={`input ${error ? "error" : ""}`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" />
          </div>
        )}

        {error && <div className="field-error">{error}</div>}

        <button type="submit" className="btn btn-primary" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
