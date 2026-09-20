import React from "react";

// Catches a screen that crashes while rendering, so the user sees what happened instead of a blank page.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: "60px auto" }}>
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>This screen hit a problem</div>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 14 }}>
            {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload the app</button>
        </div>
      </div>
    );
  }
}
