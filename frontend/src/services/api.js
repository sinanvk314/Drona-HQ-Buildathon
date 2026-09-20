// Every call the UI makes to the backend, in one file: one exported function per API operation, so screens never build
// URLs themselves. Requests carry the signed-in session token; a 401 clears the session, which shows the login page.
//
// The API base URL: VITE_API_BASE_URL if set (a separate backend host), else the same origin in a production build (the
// backend serves this UI), else http://localhost:8080/api for `npm run dev`.

import { getToken, setSession } from "./session.js";

// Order: VITE_API_BASE_URL if set; else, in a production build, the same origin (the backend serves the UI);
// else the local backend for `npm run dev`.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const BASE_URL = env.VITE_API_BASE_URL || (env.PROD ? "/api" : "http://localhost:8080/api");

// ---------------------------------------------------------------- transport + pub/sub
// Every successful write calls emit(), which makes every mounted useApi() hook refetch at once. useApi also polls every
// 30s, which picks up changes the autonomous backend scheduler makes that did not start from a click in this tab.
const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      /* a failing subscriber must not block the others */
    }
  });
}

async function request(path, { method = "GET", body } = {}) {
  const token = getToken();
  const headers = { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // The session expired or the server needs a code: drop it, which sends the user back to the login page.
  if (res.status === 401 && token) setSession(null);
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Request failed (${res.status}).`);
    if (payload && payload.fields) err.fields = payload.fields;
    throw err;
  }
  return payload;
}

const get = (path) => request(path);
const post = (path, body) => request(path, { method: "POST", body: body ?? {} }).then((r) => (emit(), r));
const del = (path) => request(path, { method: "DELETE" }).then((r) => (emit(), r));
const patch = (path, body) => request(path, { method: "PATCH", body: body ?? {} }).then((r) => (emit(), r));

// ---------------------------------------------------------------- sign-in
export const getAuthConfig = () => get("/auth/config");
export async function signIn({ name, code }) {
  const r = await request("/auth/login", { method: "POST", body: { name, code } });
  setSession({ token: r.token, name: r.user.name });
  return r.user;
}
export const signOut = () => setSession(null);

// ---------------------------------------------------------------- reads
export const getShellState = () => get("/shell");
export const getCommandCenter = () => get("/command-center");
export const getCampaign = (id) => get(`/campaigns/${id}`);
export const getCampaignDefaults = () => get("/campaigns/defaults");
export const getLaunchReview = (id) => get(`/campaigns/${id}/launch-review`);
export const getCampaignConfig = (id) => get(`/campaigns/${id}/config`);
export const getProspects = () => get("/prospects");
export const getProspect = (id) => get(`/prospects/${id}`);
export const getDecisions = ({ limit = 4 } = {}) => get(`/decisions?limit=${limit}`);
export const getDecisionForProspect = (prospectId) => get(`/decisions/for-prospect/${prospectId}`);
export const getApprovals = () => get("/approvals");
export const getApproval = (id) => get(`/approvals/${id}`);
export const getAgents = () => get("/agents");
export const getAgent = (id) => get(`/agents/${id}`);
export const getSettings = () => get("/settings");
// Representatives: who a campaign sends as, their channels, hours and daily limit, and offboarding.
export const getReps = () => get("/reps");
export const createRep = (values) => post("/reps", values);
export const updateRep = (id, values) => request(`/reps/${id}`, { method: "PUT", body: values }).then((r) => (emit(), r));
export const offboardRep = (id) => post(`/reps/${id}/offboard`);
export const reassignRep = (id, toRepId) => post(`/reps/${id}/reassign`, { toRepId });
export const setCampaignReps = (id, repIds) => post(`/campaigns/${id}/reps`, { repIds });
export const getComparison = (ids) => get(`/compare${ids && ids.length ? `?ids=${ids.join(",")}` : ""}`);

// ---------------------------------------------------------------- campaign writes
export const pauseCampaign = (id) => post(`/campaigns/${id}/pause`);
export const resumeCampaign = (id) => post(`/campaigns/${id}/resume`);
export const launchCampaign = (id) => post(`/campaigns/${id}/launch`);
export const completeCampaign = (id) => post(`/campaigns/${id}/complete`);
export const archiveCampaign = (id) => post(`/campaigns/${id}/archive`);
export const createCampaign = (values, { launch = false } = {}) => post("/campaigns", { values, launch });
export const updateCampaign = (id, values) => request(`/campaigns/${id}`, { method: "PUT", body: { values } }).then((r) => (emit(), r));
export const duplicateCampaign = (id) => post(`/campaigns/${id}/duplicate`);

// Knowledge sources of an existing campaign: `content` is the text agents retrieve from.
export const addCampaignSource = (id, { name, category, content }) => post(`/campaigns/${id}/sources`, { name, category, content });
export const removeCampaignSource = (id, sourceId) => del(`/campaigns/${id}/sources/${sourceId}`);

// ---------------------------------------------------------------- approvals
export const decideApproval = (id, { action, reason = "" } = {}) => post(`/approvals/${id}/decide`, { action, reason });
export const editApproval = (id, patchBody = {}) => patch(`/approvals/${id}`, patchBody);

// ---------------------------------------------------------------- agents & prompts
export const activatePromptVersion = (agentId, version) => post(`/agents/${agentId}/versions/${encodeURIComponent(version)}/activate`);
// Per-campaign prompts: which library version a campaign is pinned to, its own system prompt (versioned), and overrides.
export const setCampaignPin = (id, agentId, version) => post(`/campaigns/${id}/prompts/pins`, { agentId, version });
export const saveCampaignSystemPrompt = (id, text) => post(`/campaigns/${id}/prompts/system`, { text });
export const activateCampaignSystemPrompt = (id, version) => post(`/campaigns/${id}/prompts/system/${version}/activate`);
export const setCampaignOverride = (id, agentId, text) => post(`/campaigns/${id}/prompts/overrides`, { agentId, text });
export const savePromptVersion = (agentId, text) => post(`/agents/${agentId}/versions`, { text });

// ---------------------------------------------------------------- global controls
export const setKillSwitch = (active) => post("/settings/kill-switch", { active });
// Agent pause for one campaign only (the line below pauses an agent for the whole platform).
export const setCampaignAgentEnabled = (id, agentId, enabled) => post(`/campaigns/${id}/agents/${agentId}`, { enabled });
export const setAgentEnabled = (id, enabled) => post(`/agents/${id}/enabled`, { enabled });
export const setChannelEnabled = (key, enabled) => post(`/settings/channels/${key}`, { enabled });
export const addSuppression = ({ contact, reason }) => post("/settings/suppression", { contact, reason });
