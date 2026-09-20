// The knowledge library across campaigns. Each campaign keeps its own sources (retrieval is still scoped to one campaign, so
// one campaign can never draw on another's material by accident), but here a manager sees every source in one place, which
// campaigns use it, attaches it to more campaigns, and tests what an agent would actually retrieve for a question.
import { getState, withState } from "../db/index.js";
import { docLength, retrieve } from "./rag.js";

const MAX_SOURCE_CHARS = 60000;
const usable = (c) => c.status !== "archived" && !c.sandbox;

/** Two sources are the same material when they share a shipped document or identical text. */
const sameKey = (x) => (x.docId ? `doc:${x.docId}` : `text:${x.category}|${x.name}|${(x.content || "").length}|${(x.content || "").slice(0, 80)}`);

export function getKnowledgeLibrary() {
  const s = getState();
  const campaigns = s.campaigns.filter(usable);
  const items = new Map();
  for (const c of campaigns) {
    for (const src of c.sources || []) {
      const key = sameKey(src);
      if (!items.has(key)) items.set(key, { key, name: src.name, category: src.category, chars: src.content ? src.content.length : src.docId ? docLength(src.docId) : 0, custom: !!src.content, campaigns: [] });
      items.get(key).campaigns.push({ id: c.id, name: c.name, sourceId: src.id });
    }
  }
  return {
    items: [...items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, sources: (c.sources || []).length })),
  };
}

function target(s, id) {
  const c = s.campaigns.find((x) => x.id === id);
  if (!c || !usable(c)) throw new Error("Choose a campaign that can still be edited.");
  return c;
}

/** Copies one campaign's source into others that do not have it yet. */
export function attachKnowledge({ fromCampaignId, sourceId, toCampaignIds } = {}) {
  return withState((s) => {
    const from = s.campaigns.find((c) => c.id === fromCampaignId);
    const src = from && (from.sources || []).find((x) => x.id === sourceId);
    if (!src) throw new Error("Knowledge source not found.");
    const ids = [...new Set(Array.isArray(toCampaignIds) ? toCampaignIds : [])];
    if (!ids.length) throw new Error("Choose at least one campaign.");
    const key = sameKey(src);
    let added = 0;
    for (const id of ids) {
      const c = target(s, id);
      if ((c.sources || []).some((x) => sameKey(x) === key)) continue;
      s.seq += 1;
      c.sources.push({ ...src, id: `s${s.seq}` });
      c.modifiedTs = Date.now();
      added += 1;
    }
    return { added };
  });
}

/** Adds one new source to several campaigns at once. */
export function addKnowledge({ name, category, content, campaignIds } = {}) {
  const errors = {};
  if (!name || name.trim().length < 3) errors.name = "Enter a source name (at least 3 characters).";
  if (!content || content.trim().length < 20) errors.content = "Paste or upload the source text (at least 20 characters).";
  else if (content.length > MAX_SOURCE_CHARS) errors.content = `That is too long (max ${MAX_SOURCE_CHARS.toLocaleString()} characters).`;
  const ids = [...new Set(Array.isArray(campaignIds) ? campaignIds : [])];
  if (!ids.length) errors.campaignIds = "Choose at least one campaign.";
  if (Object.keys(errors).length) throw Object.assign(new Error("Please fix the highlighted fields."), { fields: errors });
  return withState((s) => {
    const clean = { name: name.trim(), category: String(category || "Other").slice(0, 60), content: content.trim() };
    for (const id of ids) {
      const c = target(s, id);
      s.seq += 1;
      c.sources.push({ id: `s${s.seq}`, ...clean });
      c.modifiedTs = Date.now();
    }
    return { added: ids.length };
  });
}

/** Takes a source out of one campaign (the others keep their copies). */
export function detachKnowledge(campaignId, sourceId) {
  return withState((s) => {
    const c = target(s, campaignId);
    const before = c.sources.length;
    c.sources = c.sources.filter((x) => x.id !== sourceId);
    if (c.sources.length === before) throw new Error("Knowledge source not found.");
    c.modifiedTs = Date.now();
    return { id: sourceId };
  });
}

/** What an agent would be given for a question in this campaign: the passages it retrieves, and from which source. */
export async function testRetrieval({ campaignId, query, k = 3 } = {}) {
  const s = getState();
  const c = s.campaigns.find((x) => x.id === campaignId);
  if (!c) throw new Error("Choose a campaign.");
  if (!String(query || "").trim()) throw new Error("Type a question to test.");
  if (!(c.sources || []).length) return { campaign: c.name, query: String(query).trim(), passages: [], note: "This campaign has no knowledge sources, so an agent would retrieve nothing and its drafts would be generic." };
  const passages = await retrieve(c, String(query).trim().slice(0, 500), Math.min(5, Math.max(1, Math.round(Number(k)) || 3)));
  return { campaign: c.name, query: String(query).trim(), passages, note: "Ranked by meaning, so the words do not have to match. These are the passages an agent would be shown for this question." };
}
