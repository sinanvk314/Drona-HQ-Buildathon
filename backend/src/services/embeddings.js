// Local text embeddings for the two places that need "how alike are these two texts?":
// knowledge retrieval (rag.js) and reply routing (replyRouter.js). This is the "matching" half of
// the matching-vs-judgment split: pure vector geometry, no LLM call, no API key, no per-call cost.
//
// Same model as matching-service/ (BAAI/bge-small-en-v1.5, 384-dim), run in-process through ONNX.
// The first call downloads the model (~130MB) into data/.embedding-cache; after that it is offline.
// If the model cannot load (no network on first run, unsupported platform), callers get an error
// and fall back — they never crash the scheduler.
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.EMBEDDING_CACHE_DIR || path.join(__dirname, "..", "..", "data", ".embedding-cache");

let modelPromise = null;
let failed = null; // once loading fails, stop retrying for this process so every tick doesn't pay for it

async function loadModel() {
  const { EmbeddingModel, FlagEmbedding } = await import("fastembed");
  return FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15, cacheDir: CACHE_DIR, showDownloadProgress: false });
}

function getModel() {
  if (failed) return Promise.reject(failed);
  if (!modelPromise) {
    modelPromise = loadModel().catch((e) => {
      failed = new Error(`embedding model unavailable: ${e.message}`);
      throw failed;
    });
  }
  return modelPromise;
}

/** Embeds an array of strings -> array of number[] (unit-length). Throws if the model is unavailable. */
export async function embedTexts(texts) {
  const model = await getModel();
  const vectors = [];
  for await (const batch of model.embed(texts.map((t) => String(t).replace(/\s+/g, " ").trim() || " "), 16)) {
    for (const v of batch) vectors.push(Array.from(v));
  }
  return vectors;
}

export async function embedText(text) {
  return (await embedTexts([text]))[0];
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function centroid(vectors) {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i] / vectors.length;
  return out;
}

/** True once the model has loaded successfully (for /health). */
export function embeddingsStatus() {
  return failed ? "unavailable" : modelPromise ? "loaded-or-loading" : "not-started";
}
