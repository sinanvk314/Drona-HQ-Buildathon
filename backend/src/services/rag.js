// Real, campaign-scoped RAG: chunks each campaign's knowledge sources and retrieves the
// passages most relevant to a given query.
//
// Retrieval is semantic: chunks and the query are embedded locally (embeddings.js, bge-small, no
// API key, no per-call cost) and ranked by cosine similarity. If the embedding model cannot load,
// it falls back to lexical TF-IDF so agents always get grounded context. Campaign isolation
// (PS Section 3) comes for free: retrieval only ever searches the given campaign's own sources.
//
// A source's text is either `content` typed or uploaded in the UI, or a file data/knowledge/<docId>.txt.
// `retrieve(campaign, query, k)` is the only exported seam.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cosine as vecCosine, embedText, embedTexts } from "./embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "data", "knowledge");

const STOPWORDS = new Set(
  "a an the and or but if of to in on for with without is are was were be been being this that these those it its as by at from your you we our".split(" ")
);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9%$]+/g) || []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function chunkText(text, docId, docName) {
  // Paragraph-sized chunks — small enough to cite individually, large enough to carry context.
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => ({ id: `${docId}#${i}`, docId, docName, text: p, tokens: tokenize(p) }));
}

/** Size in characters of a shipped document, for the Knowledge list in the UI. */
export function docLength(docId) {
  return loadDoc(docId).length;
}

const docCache = new Map(); // docId -> raw text
function loadDoc(docId) {
  if (!/^[\w.-]+$/.test(docId)) return ""; // a docId is a file name, never a path
  if (docCache.has(docId)) return docCache.get(docId);
  const file = path.join(KNOWLEDGE_DIR, `${docId}.txt`);
  let text = "";
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (e) {
    text = "";
  }
  docCache.set(docId, text);
  return text;
}

function buildChunksForCampaign(campaign) {
  const chunks = [];
  for (const src of campaign.sources || []) {
    const text = src.content || (src.docId ? loadDoc(src.docId) : "");
    if (!text) continue;
    chunks.push(...chunkText(text, src.docId || src.id, src.name));
  }
  return chunks;
}

function tf(tokens) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

function cosine(aTokens, bTokens, idf) {
  const a = tf(aTokens);
  const b = tf(bTokens);
  let dot = 0, na = 0, nb = 0;
  const vocab = new Set([...a.keys(), ...b.keys()]);
  for (const term of vocab) {
    const wa = (a.get(term) || 0) * (idf.get(term) || 1);
    const wb = (b.get(term) || 0) * (idf.get(term) || 1);
    dot += wa * wb;
    na += wa * wa;
    nb += wb * wb;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function buildIdf(chunks) {
  const df = new Map();
  for (const c of chunks) {
    for (const term of new Set(c.tokens)) df.set(term, (df.get(term) || 0) + 1);
  }
  const idf = new Map();
  const N = chunks.length || 1;
  for (const [term, count] of df) idf.set(term, Math.log(1 + N / count));
  return idf;
}

const chunkVectors = new Map(); // chunk text -> embedding, so each chunk is embedded once per process

async function semanticRank(chunks, query, k) {
  const missing = chunks.filter((c) => !chunkVectors.has(c.text));
  if (missing.length) {
    const vectors = await embedTexts(missing.map((c) => c.text));
    missing.forEach((c, i) => chunkVectors.set(c.text, vectors[i]));
  }
  const q = await embedText(query);
  return chunks
    .map((chunk) => ({ chunk, score: vecCosine(q, chunkVectors.get(chunk.text)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function lexicalRank(chunks, query, k) {
  const idf = buildIdf(chunks);
  const qTokens = tokenize(query);
  return chunks
    .map((c) => ({ chunk: c, score: cosine(qTokens, c.tokens, idf) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Retrieve the top-k knowledge chunks for a campaign relevant to a query string.
 * Returns [{ label, text }] — `label` is what the Decision Journal's "Retrieved knowledge"
 * list shows (e.g. "NimbusGuard — Product One-Pager.pdf").
 */
export async function retrieve(campaign, query, k = 2) {
  const chunks = buildChunksForCampaign(campaign);
  if (!chunks.length) return [];
  let scored;
  try {
    scored = await semanticRank(chunks, query, k);
  } catch {
    scored = lexicalRank(chunks, query, k);
  }
  if (!scored.length) {
    // No overlap at all — still return the first chunk of each source so agents have
    // *something* grounded to work from rather than nothing at all.
    const seen = new Set();
    return chunks
      .filter((c) => (seen.has(c.docId) ? false : (seen.add(c.docId), true)))
      .slice(0, k)
      .map((c) => ({ label: c.docName, text: c.text }));
  }
  return scored.map((s) => ({ label: s.chunk.docName, text: s.chunk.text }));
}
