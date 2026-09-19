import React from "react";

// Renders text where **double asterisks** mark bold. Uses React text nodes only (no raw HTML).
export default function RichText({ text }) {
  const parts = String(text || "").split("**");
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? <strong key={i}>{p}</strong> : <React.Fragment key={i}>{p}</React.Fragment>
      )}
    </>
  );
}
