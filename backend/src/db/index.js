// Persistence layer. Two backing stores behind one identical API (getState/withState/
// resetState/persistState), selected by whether DATABASE_URL is set:
//
//   - Postgres (Neon), when config.databaseUrl is set — src/db/postgresAdapter.js maps the
//     in-memory `state` object to/from the real tables created for this project.
//   - A local JSON file (data/state.json) otherwise — the original zero-setup mode, a direct
//     port of the frontend's own sessionStorage mock (src/services/store.js).
//
// Either way, every service/route file only ever calls getState()/withState() — the app's
// business logic (data.js, scheduler.js, conflict.js, rag.js, agentEngine/*) never changes
// based on which store is active, and never talks to Postgres or the filesystem directly.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildSeed, SCHEMA_VERSION } from "./seed.js";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.isAbsolute(config.dataFile) ? config.dataFile : path.join(__dirname, "..", "..", config.dataFile);
const usingPostgres = !!config.databaseUrl;

let state = null;
let pgAdapter = null; // { loadStateFromPg, saveStateToPg } — dynamically imported, Postgres mode only
let pgQueue = Promise.resolve(); // serializes writes so two mutations in flight never race each other

function loadFromFile() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      if (parsed && parsed.version === SCHEMA_VERSION) return parsed;
    }
  } catch (e) {
    console.warn("[db] Could not read existing state file, starting from seed:", e.message);
  }
  return null;
}

function persistToFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state));
}

function schedulePgPersist() {
  pgQueue = pgQueue.then(() => pgAdapter.saveStateToPg(state)).catch((e) => {
    console.error("[db] Postgres write failed — in-memory state is still correct, will sync on the next write:", e.message);
  });
  return pgQueue;
}

// Must be awaited once, before the server starts handling requests (see server.js).
export async function initDb() {
  if (usingPostgres) {
    console.log("[db] DATABASE_URL is set — using Postgres (Neon) as the datastore.");
    pgAdapter = await import("./postgresAdapter.js");
    const loaded = await pgAdapter.loadStateFromPg();
    if (loaded) {
      state = loaded;
      console.log(`[db] Loaded state from Postgres: ${state.campaigns.length} campaigns, ${state.prospects.length} prospects.`);
    } else {
      state = buildSeed(Date.now());
      await pgAdapter.saveStateToPg(state);
      console.log("[db] Postgres tables were empty — seeded with the default demo data.");
    }
  } else {
    state = loadFromFile() || buildSeed(Date.now());
    persistToFile(); // persist once on boot so a fresh clone always has a state file on disk
  }
}

export function getState() {
  return state;
}

// fn reads or mutates state in place. Every call persists — this is a hackathon-scale
// datastore (single process, modest write volume), not a high-throughput store.
export function withState(fn) {
  const result = fn(state);
  if (usingPostgres) schedulePgPersist();
  else persistToFile();
  return result;
}

export async function resetState() {
  state = buildSeed(Date.now());
  if (usingPostgres) await schedulePgPersist();
  else persistToFile();
  return state;
}

// For callers that mutate the object returned by getState() directly across `await` points
// (the scheduler's tick(), which makes LLM calls mid-mutation) — withState() alone can't be
// used there because it would persist before the async mutation finishes. Always returns a
// Promise now (it didn't need to in file-only mode) so the scheduler can await durability.
export function persistState() {
  if (usingPostgres) return schedulePgPersist();
  persistToFile();
  return Promise.resolve();
}
