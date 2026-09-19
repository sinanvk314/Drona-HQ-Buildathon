import React from "react";

const PATHS = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" />
      <path d="M4 12.5l8 4.5 8-4.5" />
      <path d="M4 17l8 4.5L20 17" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 20c0-3.6 2.8-6.2 6.2-6.2S15.2 16.4 15.2 20" />
      <circle cx="17.5" cy="9" r="2.3" />
      <path d="M15.8 13.8c2.6.3 4.6 2.4 4.9 5.2" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3l2.6 2.6L16.4 9" />
    </>
  ),
  sliders: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9.5" cy="6" r="2.1" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15.5" cy="12" r="2.1" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="7.5" cy="18" r="2.1" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.2c0-.7.6-1.2 1.3-1.1 2 .2 4.7 1 6.7 2.4v13c-2-1.4-4.7-2.2-6.7-2.4-.7-.1-1.3-.6-1.3-1.1V5.2z" />
      <path d="M20 5.2c0-.7-.6-1.2-1.3-1.1-2 .2-4.7 1-6.7 2.4v13c2-1.4 4.7-2.2 6.7-2.4.7-.1 1.3-.6 1.3-1.1V5.2z" />
    </>
  ),
  bars: (
    <>
      <line x1="5" y1="20" x2="5" y2="11" />
      <line x1="12" y1="20" x2="12" y2="5" />
      <line x1="19" y1="20" x2="19" y2="14" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.4M12 18.6V21M4.2 6.5l1.7 1.7M18.1 15.8l1.7 1.7M3 12h2.4M18.6 12H21M4.2 17.5l1.7-1.7M18.1 8.2l1.7-1.7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="20" y1="20" x2="15.7" y2="15.7" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.3 6.3a8 8 0 1011.4 0" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 10-12 0c0 6.4-2.5 8-2.5 8h17s-2.5-1.6-2.5-8z" />
      <path d="M13.7 20a2 2 0 01-3.4 0" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
    </>
  ),
  chat: <path d="M4 5h16v11H8l-4 4V5z" />,
  phone: <path d="M6.5 3.5l3 1.5-1 3.5c1 2.5 3 4.5 5.5 5.5l3.5-1 1.5 3-2 2.5c-6-.5-11-5.5-11.5-11.5l2.5-2z" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4L2.5 20h19L12 4z" />
      <line x1="12" y1="10" x2="12" y2="15" />
      <circle cx="12" cy="17.6" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  xcircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <circle cx="12" cy="15.7" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M15 2v5h5" />
    </>
  ),
  sparkle: <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  tick: <path d="M4 12l5 5L20 6" />,
};

export default function Icon({ name, size = 16, stroke = 1.6, color = "currentColor", style }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
