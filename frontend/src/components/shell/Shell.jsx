import React from "react";
import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";

// Page frame used by every screen: 240px sidebar + 64px top bar + scrollable content area.
// The outermost element fills the host iframe height with h-[100dvh].
export default function Shell({ active, title, crumbs, badge, searchPlaceholder, footer, padding = "28px 32px", children }) {
  return (
    <div className="h-[100dvh] overflow-hidden flex" style={{ height: "100dvh", background: "var(--bg)" }}>
      <Sidebar active={active} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <TopBar title={title} crumbs={crumbs} badge={badge} searchPlaceholder={searchPlaceholder} />
        <main className="overflow-auto" style={{ flexGrow: 1, minHeight: 0 }}>
          <div style={{ padding }}>{children}</div>
        </main>
        {footer}
      </div>
    </div>
  );
}
