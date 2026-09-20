// REST surface matching the frontend's src/services/api.js function-for-function (see that
// file's header comment and the project README for the mapping). Every handler is a thin
// wrapper around src/services/data.js — no business logic lives here.
import { Router } from "express";
import { asyncRoute } from "../middleware/errors.js";
import * as data from "../services/data.js";
import { authConfig, login, me } from "../services/auth.js";

export const router = Router();

// ---- sign-in (public; everything else needs a session when an access code is set) ---------------------
router.get("/auth/config", (req, res) => res.json(authConfig()));
router.post("/auth/login", asyncRoute(async (req, res) => res.json(login(req.body || {}, req.ip))));
router.get("/auth/me", (req, res) => res.json({ user: me(req) }));

// ---- shell / command center ------------------------------------------------
router.get("/shell", asyncRoute(async (req, res) => res.json(data.getShellState())));
router.get("/command-center", asyncRoute(async (req, res) => res.json(data.getCommandCenter())));

// ---- campaigns --------------------------------------------------------------
// NOTE: /campaigns/defaults must be registered before /campaigns/:id.
router.get("/campaigns/defaults", asyncRoute(async (req, res) => res.json(data.getCampaignDefaults())));
router.post("/campaigns", asyncRoute(async (req, res) => {
  const { values, launch } = req.body || {};
  res.json(data.createCampaign(values || {}, { launch: !!launch }));
}));
router.get("/campaigns/:id", asyncRoute(async (req, res) => res.json(data.getCampaign(req.params.id))));
router.get("/campaigns/:id/config", asyncRoute(async (req, res) => res.json(data.getCampaignConfig(req.params.id))));
router.put("/campaigns/:id", asyncRoute(async (req, res) => res.json(data.updateCampaign(req.params.id, (req.body || {}).values || {}))));
router.post("/campaigns/:id/prompts/pins", asyncRoute(async (req, res) => res.json(data.setCampaignPin(req.params.id, (req.body || {}).agentId, (req.body || {}).version))));
router.post("/campaigns/:id/prompts/system", asyncRoute(async (req, res) => res.json(data.saveCampaignSystemPrompt(req.params.id, (req.body || {}).text))));
router.post("/campaigns/:id/prompts/system/:version/activate", asyncRoute(async (req, res) => res.json(data.activateCampaignSystemPrompt(req.params.id, req.params.version))));
router.post("/campaigns/:id/prompts/overrides", asyncRoute(async (req, res) => res.json(data.setCampaignOverride(req.params.id, (req.body || {}).agentId, (req.body || {}).text))));
router.post("/campaigns/:id/agents/:agentId", asyncRoute(async (req, res) => res.json(data.setCampaignAgentEnabled(req.params.id, req.params.agentId, !!(req.body || {}).enabled))));
router.post("/campaigns/:id/duplicate", asyncRoute(async (req, res) => res.json(data.duplicateCampaign(req.params.id))));
router.post("/campaigns/:id/sources", asyncRoute(async (req, res) => res.json(data.addCampaignSource(req.params.id, req.body || {}))));
router.delete("/campaigns/:id/sources/:sourceId", asyncRoute(async (req, res) => res.json(data.removeCampaignSource(req.params.id, req.params.sourceId))));
router.post("/campaigns/:id/pause", asyncRoute(async (req, res) => res.json(data.pauseCampaign(req.params.id))));
router.post("/campaigns/:id/resume", asyncRoute(async (req, res) => res.json(data.resumeCampaign(req.params.id))));
router.post("/campaigns/:id/launch", asyncRoute(async (req, res) => res.json(data.launchCampaign(req.params.id))));
router.post("/campaigns/:id/complete", asyncRoute(async (req, res) => res.json(data.completeCampaign(req.params.id))));
router.post("/campaigns/:id/archive", asyncRoute(async (req, res) => res.json(data.archiveCampaign(req.params.id))));

// ---- prospects ---------------------------------------------------------------
router.get("/prospects", asyncRoute(async (req, res) => res.json(data.getProspects())));
router.get("/prospects/:id", asyncRoute(async (req, res) => res.json(data.getProspect(req.params.id))));

// ---- decisions (Decision Journal) --------------------------------------------
router.get("/decisions", asyncRoute(async (req, res) => res.json(data.getDecisions({ limit: Number(req.query.limit) || 4 }))));
router.get("/decisions/for-prospect/:prospectId", asyncRoute(async (req, res) => res.json(data.getDecisionForProspect(req.params.prospectId))));

// ---- approvals ----------------------------------------------------------------
router.get("/approvals", asyncRoute(async (req, res) => res.json(data.getApprovals())));
router.get("/approvals/:id", asyncRoute(async (req, res) => res.json(data.getApproval(req.params.id))));
router.post("/approvals/:id/decide", asyncRoute(async (req, res) => res.json(data.decideApproval(req.params.id, req.body || {}))));
router.patch("/approvals/:id", asyncRoute(async (req, res) => res.json(data.editApproval(req.params.id, req.body || {}))));

// ---- agents & prompts -----------------------------------------------------------
router.get("/agents", asyncRoute(async (req, res) => res.json(data.getAgents())));
router.get("/agents/:id", asyncRoute(async (req, res) => res.json(data.getAgent(req.params.id))));
router.post("/agents/:id/versions", asyncRoute(async (req, res) => res.json(data.savePromptVersion(req.params.id, (req.body || {}).text))));
router.post("/agents/:id/versions/:version/activate", asyncRoute(async (req, res) => res.json(data.activatePromptVersion(req.params.id, req.params.version))));
router.post("/agents/:id/enabled", asyncRoute(async (req, res) => res.json(data.setAgentEnabled(req.params.id, !!(req.body || {}).enabled))));

// ---- settings / global controls --------------------------------------------------
router.get("/settings", asyncRoute(async (req, res) => res.json(data.getSettings())));
router.post("/settings/kill-switch", asyncRoute(async (req, res) => res.json(data.setKillSwitch(!!(req.body || {}).active))));
router.post("/settings/channels/:key", asyncRoute(async (req, res) => res.json(data.setChannelEnabled(req.params.key, !!(req.body || {}).enabled))));
router.post("/settings/suppression", asyncRoute(async (req, res) => res.json(data.addSuppression(req.body || {}))));
