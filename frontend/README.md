# Autonomous SDR Control Plane

## 1. Document control

| pluginId | App name | Status | Last updated | Authoring client |
|---|---|---|---|---|
| 77707 | Autonomous SDR Control Plane | Draft — built, not yet reviewed in Preview, not published | 2026-09-19 | Claude Code |

## 2. Executive summary

A control-plane front end for an autonomous SDR (sales development) system, built for the Tech Contingent × DronaHQ Buildathon. Operators run several outbound campaigns at once, review what the AI agents did and why, approve or reject sensitive actions, tune agent prompts, and stop things at campaign, agent, channel or global scope. The visual design comes from 8 approved wireframes and is implemented as-is. Data is served by a local mock service so the frontend works standalone; every data call goes through one service module (`src/services/api.js`) that the backend REST APIs will replace later. Success means all 8 screens are navigable, the key controls (pausing one campaign without touching the others, the global kill switch, approvals) behave correctly, and the backend swap needs no screen changes.

## 3. Goals & non-goals

### 3.1 Goals
- Recreate the 8 approved wireframes faithfully, using the specified design tokens and IBM Plex Sans.
- Make every listed interaction work against local state (session-persisted).
- Enforce the campaign lifecycle and scoped controls in the service layer.
- Keep one seam (`src/services/api.js`) for the future backend.

### 3.2 Non-goals / out of scope (placeholders)
- Real agent execution (LLM/RAG), Gmail / Twilio / Apollo / voice integrations.
- Authentication and persistence beyond `sessionStorage`.
- Live conflict detection (one demo conflict is hardcoded in the Decision Journal).
- Prompt diff / rollback internals (placeholder dialogs).
- Knowledge and Analytics screens (labeled coming-soon pages; not in the wireframes).
- Global search (visual only), Campaign Detail sub-tabs (visual only), mobile layout.
- DronaHQ connectors, database, SDK, automations (none used).

## 4. Users & access

- Persona: SDR operations admin ("JD · Admin").
- Access mode: DronaHQ end-user portal for the MVP (`portal_auth`). Final access/publish settings are deferred; the app is not published.
- No sign-in screen. The user chip is static.

## 5. Functional requirements

| ID | Requirement | Acceptance criteria | Priority | Status |
|---|---|---|---|---|
| FR-1 | App shell | 240px sidebar with 8 nav items and "JD · Admin"; 64px top bar with breadcrumb/title, search, Kill Switch, bell, avatar; active nav and title follow navigation | Must | Built |
| FR-2 | Command Center | Greeting, 4 KPIs, approvals banner, campaign cards, overall funnel, live feed, all derived from the same data | Must | Built |
| FR-3 | Per-campaign pause/resume | Pause/Resume changes only that campaign; others' status, metrics and feed are unchanged | Must | Built |
| FR-4 | Campaign lifecycle | Draft → Live → Paused → Completed/Archived enforced by the service; Draft shows no outreach activity | Must | Built |
| FR-5 | Create Campaign | 5 cards, editable defaults, validation, Save as Draft and Launch, sticky footer | Must | Built |
| FR-6 | Campaign Detail | Header, visual sub-tabs, 4 metrics, funnel, timeline, outreach stats, approval queue, prospects table | Must | Built |
| FR-7 | Prospects list | Cross-campaign table reusing the Campaign Detail table; row opens Prospect Detail | Must | Built |
| FR-8 | Prospect Detail | Person, company, ICP ring, qualification, evidence, history, conversation, next action with Approve/Edit/Reject | Must | Built |
| FR-9 | Decision Journal | One expanded card, collapsed rows, one blocked/conflict row, expand/collapse, load earlier, deep link from Prospect Detail | Must | Built |
| FR-10 | Approvals | List + detail, pause notice, recommendation, draft, Approve/Edit/Reject, reason required to reject | Must | Built |
| FR-11 | Agents & Prompts | 5 agents, active prompt, version history with Activate, campaign-level instructions, Compare/Roll Back placeholders, inline edit | Must | Built |
| FR-12 | Global controls | Kill switch (top bar + Settings) is one reversible global flag; agent and channel toggles independent | Must | Built |
| FR-13 | Suppression list | Add to list with validation | Should | Built |
| FR-14 | Service seam | Screens import only `src/services/api.js`; functions return Promises; mock-only parts marked | Must | Built |

## 6. User stories (approved)

| # | As a… | I want… | So that… | Status |
|---|---|---|---|---|
| S1 | Admin | The same navigation on every screen | I always know where I am | Approved |
| S2 | Admin | Portfolio health at a glance | I can spot issues quickly | Approved |
| S3 | Admin | Independent campaign controls | Pausing one does not affect the others | Approved |
| S4 | Admin | Enforced campaign states | A Draft never shows outreach | Approved |
| S5 | Admin | To configure a campaign | It targets the right audience | Approved |
| S6 | Admin | To save or launch a campaign | I control when it goes live | Approved |
| S7 | Admin | To inspect one campaign | I see funnel, activity and approvals | Approved |
| S8 | Admin | To act on a lead | I approve, edit or reject the next action | Approved |
| S9 | Admin | To audit agent decisions | I see evidence, knowledge and prompt version | Approved |
| S10 | Admin | To work the approval queue | Sensitive actions get human review | Approved |
| S11 | Admin | To manage agent prompts | I can activate or edit versions | Approved |
| S12 | Admin | An emergency kill switch | I can stop everything instantly | Approved |
| S13 | Admin | Independent agent and channel toggles | I can control scope precisely | Approved |
| S14 | Admin | Suppression list and integration status | I respect do-not-contact rules | Approved |
| S15 | Developer | One data seam | The backend swaps in without screen changes | Approved |
| S16 | Admin | No dead ends in navigation | Knowledge/Analytics show a labeled page; Prospects shows a cross-campaign table | Approved (Prospects changed from placeholder to a table) |

## 7. Screens & UX

| Screen | Purpose | Primary actions | Empty / loading / error notes |
|---|---|---|---|
| Command Center (also "Campaigns" nav, scrolled to the campaign cards) | Portfolio overview | New Campaign, Pause/Resume, Dashboard, Review Approvals | Feed empty text; banner switches to "all caught up" |
| Create Campaign | Configure and launch | Save as Draft, Launch, Add Source | Per-field errors; Draft needs only a name |
| Campaign Detail | One campaign | Pause/Resume/Launch, open prospect, open approval | Draft shows empty states |
| Prospects | Cross-campaign list | Open prospect | Empty text |
| Prospect Detail | One lead | Approve, Edit, Reject, View in Decision Journal | No-action state; rejected shows reason |
| Decision Journal | Audit trail | Expand/collapse, Load earlier | — |
| Approvals | Human review | Approve & Send, Edit Draft, Reject | "All caught up" state |
| Agents & Prompts | Prompt management | Activate, Edit, Compare, Roll Back | No overrides state |
| Settings | Global controls | Kill switch, toggles, Add to List | — |
| Knowledge / Analytics | Placeholder | — | Coming-soon page |

## 8. Data & integrations

- Platform mode: independent (no connectors, no DronaHQ SDK, no automations).
- Data: mock seed in `src/data/seed.js`, held in `src/services/store.js`, persisted to `sessionStorage` under `sdr-control-plane-state-v1`.
- Entities: Campaign, Prospect, AgentEvent, AgentDecision, ApprovalItem, Agent/PromptVersion, ChannelStatus (JSDoc in `src/data/types.js`).
- Business rules: see ARCHITECTURE.md §3.
- Simulated activity: Live campaigns progress every 12 seconds (mock only), gated by agent, channel and kill-switch state.

## 9. Non-functional / constraints

- CDN React 18.3.1 (pinned), Babel, Tailwind CDN; no build step, no separate CSS files (tokens and component classes live in `index.html`).
- Desktop-first, optimized for 1280px and wider (`min-width: 1200px` on body).
- No secrets, no `dangerouslySetInnerHTML`; user text is rendered as React text nodes.
- App shell root uses `h-[100dvh]`.

## 10. Decisions log

| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-09-19 | Prospects nav is a cross-campaign table | User asked for a simple list reusing the campaign prospect table | Placeholder page |
| 2026-09-19 | "Campaigns" nav reuses the Command Center campaign cards (scrolls to them) | No campaigns-list wireframe exists; avoids inventing a screen | New list screen |
| 2026-09-19 | Kill switch is reversible and preserves campaign statuses | Matches the Settings copy | One-way stop |
| 2026-09-19 | Edit is inline and in place | Approved assumption | Separate edit screen |
| 2026-09-19 | JSDoc typedefs instead of TypeScript | Browser-only Babel | TypeScript |
| 2026-09-19 | `sessionStorage` persistence | Demo survives refresh | In-memory only |
| 2026-09-19 | Campaign Detail approval queue shows the derived pending count (3 for US SaaS CTO) and the two newest items | Keeps counts consistent with the Approvals screen; wireframe text says "2 pending" | Hardcode 2 |
| 2026-09-19 | Command Center feed shows "highlight" events (a subset), matching the wireframe rows | Wireframe feed and campaign timeline list different events | Show every event |

## 11. Open issues & risks

- The app has not been opened in Studio Preview by the author. If Preview is blank, read `logs/preview-run.json` first. The app uses multi-file ES imports, so if Studio Preview does not resolve relative imports, the fallback is to inline files into a single `src/main.jsx`.
- Wireframes disagree in a few places (Command Center feed vs. Campaign Detail timeline events; approval counts). See the decisions log.
- Access mode and publishing are not configured yet.

## 12. Session handoff (MCP continuity)

- Flow A (remote MCP). No local mirror was created in this session.
- Preview: run `vibe_save_app` then `vibe_preview_url` for pluginId 77707.
- To continue: edit through `vibe_write_file` then `vibe_save_app`. Do not recreate the app.
- Backend swap: reimplement functions in `src/services/api.js` with `fetch()`; keep names and return shapes.

## 13. Project layout

| Path | Description |
|---|---|
| `index.html` | CDNs, design tokens, component CSS classes |
| `README.md`, `ARCHITECTURE.md` | Product and technical docs |
| `src/main.jsx`, `src/App.jsx` | Entry, route state, providers |
| `src/data/constants.js` | Stage/channel constants and lifecycle map |
| `src/data/types.js` | JSDoc typedefs |
| `src/data/seed.js` | MOCK-ONLY seed data |
| `src/services/api.js` | Service layer (the only seam screens use) |
| `src/services/store.js` | MOCK-ONLY store and `sessionStorage` persistence |
| `src/services/logic.js` | MOCK-ONLY lifecycle, scoping and simulated activity |
| `src/hooks/useApi.js` | Loads service data and refreshes on change |
| `src/hooks/useCampaignActions.js` | Pause/Resume/Launch helper |
| `src/utils/*` | Formatting, validation, event styles |
| `src/components/shell/*` | Sidebar, TopBar, Shell, NavContext |
| `src/components/ui/*` | Icon, Badge, Toggle, Modal, Toast, Funnel, RichText |
| `src/components/features/*` | CampaignCard, ProspectTable |
| `src/screens/*` | The 8 screens, Prospects list, ComingSoon |

## 14. Related docs

See `ARCHITECTURE.md`.
