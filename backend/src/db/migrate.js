// Additive upgrades applied to saved state on every start. Unlike a schema-version bump (which reseeds and
// so replaces the saved state), these only ADD what a newer version needs: they never remove or overwrite a
// campaign, prospect or setting the user created. Safe to run repeatedly.
import { buildSeed } from "./seed.js";
import { initCampaignPrompts } from "../services/prompts.js";

/** @returns true if anything changed (so the caller can save). */
export function migrate(state, now = Date.now()) {
  let changed = false;
  const fresh = buildSeed(now);

  // Agents introduced after the first release, inserted next to their neighbours.
  const insertAfter = { strategy: "icp", followup: "conversation" };
  for (const id of Object.keys(insertAfter)) {
    if (state.agents.some((a) => a.id === id)) continue;
    const agent = fresh.agents.find((a) => a.id === id);
    const at = state.agents.findIndex((a) => a.id === insertAfter[id]);
    state.agents.splice(at >= 0 ? at + 1 : state.agents.length, 0, agent);
    changed = true;
  }

  for (const c of state.campaigns) {
    if (!c.cadence) {
      c.cadence = { maxTouches: 3, waitHours: 72 };
      changed = true;
    }
  }

  // Pin every existing campaign to the prompt versions active now, so later edits to the shared library cannot
  // silently change how a running campaign behaves.
  for (const c of state.campaigns) if (initCampaignPrompts(c, state.agents)) changed = true;

  // Representatives: add the seeded reps if the state predates them, and assign them to the seeded campaigns.
  if (!Array.isArray(state.reps)) {
    state.reps = fresh.reps;
    changed = true;
  }
  for (const c of state.campaigns) {
    if (!Array.isArray(c.repIds)) {
      const seeded = fresh.campaigns.find((f) => f.id === c.id);
      c.repIds = seeded ? [...seeded.repIds] : [];
      changed = true;
    }
  }

  for (const p of state.prospects) {
    if (!Array.isArray(p.touches)) { p.touches = []; changed = true; }
    if (!("plan" in p)) { p.plan = null; changed = true; }
    if (!("nextTouchTs" in p)) { p.nextTouchTs = null; changed = true; }
  }

  // The integrations list used to claim Claude and pgvector were connected; the running system uses Gemini
  // and in-process embeddings.
  const names = state.integrations.map((i) => i.name);
  if (names.includes("Claude (Sonnet)") || names.includes("pgvector (RAG)") || !names.includes("Gemini")) {
    state.integrations = fresh.integrations;
    changed = true;
  }
  return changed;
}
