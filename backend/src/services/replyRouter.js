// Routes clean-cut inbound replies WITHOUT an LLM call. Node port of matching-service's
// /classify/reply (same model, same thresholds): the reply is embedded and compared to a centroid
// per category built from canonical example replies in the knowledge base
// (data/knowledge/reply-examples.json). Only unsubscribe / hostile / out-of-office are ever decided
// here, and only when the match is both strong and clearly ahead of the runner-up. Anything else
// (objection, question, positive, or a close call) is returned as not-deterministic and goes to
// the Conversation Agent, because those need judgment, not geometry.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { centroid, cosine, embedText, embedTexts } from "./embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_FILE = path.join(__dirname, "..", "..", "data", "knowledge", "reply-examples.json");
const DETERMINISTIC = new Set(["unsubscribe", "hostile", "out_of_office"]);

let centroidsPromise = null;
async function loadCentroids() {
  const examples = JSON.parse(fs.readFileSync(EXAMPLES_FILE, "utf-8"));
  const entries = [];
  for (const [category, texts] of Object.entries(examples)) {
    entries.push([category, centroid(await embedTexts(texts))]);
  }
  return entries;
}

/**
 * -> { category, score, margin, deterministic }. Never throws: if routing is disabled or the
 * embedding model is unavailable it returns { deterministic: false } so the caller uses the agent.
 */
export async function classifyReply(text) {
  if (!config.replyRouting.enabled) return { category: null, score: 0, margin: 0, deterministic: false };
  try {
    if (!centroidsPromise) centroidsPromise = loadCentroids();
    const centroids = await centroidsPromise;
    const vec = await embedText(text);
    const scored = centroids.map(([category, c]) => [category, cosine(vec, c)]).sort((a, b) => b[1] - a[1]);
    const [category, score] = scored[0];
    // Unsubscribe / hostile / out-of-office are told apart only loosely by embeddings, and it does not
    // matter which of them it is: the margin that counts is over the best category that needs judgment.
    const bestJudgment = scored.find(([c]) => !DETERMINISTIC.has(c));
    const margin = bestJudgment ? score - bestJudgment[1] : 1;
    const deterministic =
      DETERMINISTIC.has(category) && score >= config.replyRouting.minScore && margin >= config.replyRouting.minMargin;
    return { category, score, margin, deterministic };
  } catch (e) {
    centroidsPromise = null;
    return { category: null, score: 0, margin: 0, deterministic: false, error: e.message };
  }
}
