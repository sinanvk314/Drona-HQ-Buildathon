# Autonomous SDR Control Plane — Architecture (edit context)

## 1. Product intent

Product context, requirements and the approved stories live in `README.md` §§2–7.

### 1.2 User stories (summary)

| Story | Area | Where |
|---|---|---|
| S1–S2 | Shell, Command Center | README §6 |
| S3–S4 | Campaign controls and lifecycle | README §6 |
| S5–S9 | Create, Detail, Prospect, Journal | README §6 |
| S10–S14 | Approvals, Agents, Settings | README §6 |
| S15–S16 | Data seam, navigation | README §6 |

## 2. UI & interaction

### 2.1 Visual tokens

Defined in `index.html` (CSS custom properties, no separate CSS files).

- Font: IBM Plex Sans 400/500/600/700.
- Colors: bg `#F7F9FC`, surface `#FFFFFF`, border `#E3E8EF`, border-strong `#C7D0DC`, text `#101828`, text-2 `#475467`, text-3 `#98A2B3`, accent `#2453E6`, accent-soft `#EBF1FF`, accent-strong `#173FBF`, success `#16794F` / soft `#EAF7F0`, warning `#B4560A` / soft `#FDF3E8`, danger `#C0293D` / soft `#FCEBEE`, neutral-soft `#EEF1F5`.
- Radius 12px (cards), 8px (buttons, inputs, tags). 1px borders. No shadows.
- Layout: 240px sidebar, 64px top bar, scrollable content with 28–32px padding. Root uses `h-[100dvh]`.
- Component classes (`.card`, `.btn-*`, `.badge`, `.tag`, `.chip`, `.toggle`, `.input`, `table`) mirror the wireframes' class names.

### 2.2 Interaction contract

- Navigation is route state in `App.jsx` (`{name, params}`), persisted in `sessionStorage`. `NavContext` exposes `navigate(name, params)`. Screens are remounted when route or params change.
- Sidebar active item maps from route (Journal maps to Agents & Prompts, as in the wireframe; "Campaigns" reuses the Command Center and scrolls to the cards).
- Pause/Resume/Launch go through `useCampaignActions`; errors surface as toasts.
- Reject requires a reason on Approvals and on Prospect Detail. Approved/rejected items leave the pending queue.
- Decision Journal: one card expanded at a time (default newest); clicking the expanded card collapses it.
- Forms validate every required field with per-field errors (`src/utils/validation.js`). The same rules run in the service layer.

## 3. Data model & integrations

### Layers

```text
Screen -> useApi (hook) -> src/services/api.js -> store.js / logic.js / seed.js   (MOCK-ONLY)
                                     ^
                     future: fetch() to backend REST APIs
```

- Screens and hooks import only `src/services/api.js` (plus pure utils/constants). `src/data/seed.js`, `store.js` and `logic.js` are imported by the service layer only.
- Every service function returns a Promise of a deep-cloned view model, so callers cannot mutate the store.
- `useApi` refetches whenever the service notifies (`subscribe`) and polls every 30s so relative times stay current.

### Service functions

Reads: `getShellState`, `getCommandCenter`, `getCampaign`, `getCampaignDefaults`, `getProspects`, `getProspect`, `getDecisions`, `getDecisionForProspect`, `getApprovals`, `getApproval`, `getAgents`, `getAgent`, `getSettings`.

Writes: `pauseCampaign`, `resumeCampaign`, `launchCampaign`, `completeCampaign`, `archiveCampaign`, `createCampaign`, `decideApproval`, `editApproval`, `activatePromptVersion`, `savePromptVersion`, `setKillSwitch`, `setAgentEnabled`, `setChannelEnabled`, `addSuppression`.

Stubs (canned results): `requestPromptCompare`, `requestPromptRollback`. Integrations status is always "Connected" (seed).

Mock-only runtime: `startActivitySimulation` (12s interval, only while the app is open).

### Business rules (in `logic.js`; a backend owns these later)

- Lifecycle map in `src/data/constants.js`: draft → live | archived; live → paused | completed; paused → live | completed | archived; completed → archived.
- Scoped controls:
  - Campaign pause changes only that campaign's `status`.
  - Kill switch is a separate global flag. Effective status of Live/Paused campaigns shows as "stopped" while it is on; underlying statuses are preserved and restored on deactivate. Pause/Resume/Launch are rejected while it is on.
  - Agent and channel toggles are independent flags. They gate the simulated stages (agent per stage; at least one enabled channel for contacts) but never change campaign status or the kill switch.
- Draft campaigns: `getCampaign` returns zeroed funnel, outreach, empty timeline and no prospects.
- Consistency: KPIs, funnels, cards and feeds are derived from the same `funnel`, `events` and `approvals` data.
- Demo conflict: the blocked decision `d2` is hardcoded seed data.

### Persistence

`store.js` keeps state in memory and writes it to `sessionStorage` key `sdr-control-plane-state-v1` after every mutation. `SCHEMA_VERSION` mismatch falls back to the seed.

### Data flow: pause one campaign

```text
CampaignCard Pause -> useCampaignActions -> api.pauseCampaign(id)
  -> logic.canTransition(live -> paused) -> mutate only campaigns[id]; add event
  -> store emits -> useApi hooks refetch -> only that card changes
```

## 4. Implementation map

| Requirement | Files |
|---|---|
| FR-1 Shell | `components/shell/*`, `App.jsx` |
| FR-2, FR-3 Command Center and pause | `screens/CommandCenter.jsx`, `components/features/CampaignCard.jsx`, `services/api.js` |
| FR-4 Lifecycle | `data/constants.js`, `services/logic.js`, `services/api.js` |
| FR-5 Create Campaign | `screens/CreateCampaign.jsx`, `utils/validation.js` |
| FR-6 Campaign Detail | `screens/CampaignDetail.jsx`, `components/ui/Funnel.jsx` |
| FR-7 Prospects | `screens/Prospects.jsx`, `components/features/ProspectTable.jsx` |
| FR-8 Prospect Detail | `screens/ProspectDetail.jsx` |
| FR-9 Decision Journal | `screens/DecisionJournal.jsx` |
| FR-10 Approvals | `screens/Approvals.jsx` |
| FR-11 Agents & Prompts | `screens/AgentsPrompts.jsx` |
| FR-12, FR-13 Settings | `screens/Settings.jsx`, `components/shell/TopBar.jsx` |
| FR-14 Service seam | `services/*`, `hooks/useApi.js` |

## 5. Changelog

- 2026-09-19 — Initial build of all screens, service layer, mock data and docs (pluginId 77707).

## 6. Project-specific learnings

- Tailwind CDN preflight resets lists and elements, so lists use inline `listStyle: disc` and controls use explicit classes.
- Multi-file ES imports are used (bundler-style entry). If Studio Preview does not resolve them, collapse into one `src/main.jsx`.
