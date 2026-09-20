// Postgres (Neon) storage for hosts with no persistent disk. The whole app state is kept as ONE JSON
// document in a single table, so nothing can be left out (approval levels, knowledge-source text and any
// field added later all persist), and there is no schema to keep in step with the code.
//
// It is a snapshot store: the app still works on the in-memory state and this writes it out after each change.
// Writes are coalesced, so a burst of changes (a scheduler tick plus a click) costs one write, not many.
//
// Safety: the table is created if missing (CREATE TABLE IF NOT EXISTS) and is private to this app
// (`sdr_app_state`). Nothing else in the database is read, changed or truncated. If the stored state was
// written by an older seed schema, it is copied to a backup row before the app reseeds, never overwritten.
import { getPool } from "./pg.js";
import { SCHEMA_VERSION } from "./seed.js";

const TABLE = "sdr_app_state";
const CURRENT_ID = "current";

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await getPool().query(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id text PRIMARY KEY, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
  );
  ensured = true;
}

/** Returns the saved state, or null if there is none (or it is from an older schema, which is backed up). */
export async function loadStateFromPg() {
  await ensureTable();
  const { rows } = await getPool().query(`SELECT state FROM ${TABLE} WHERE id = $1`, [CURRENT_ID]);
  if (!rows.length) return null;
  const state = rows[0].state;
  if (state && state.version === SCHEMA_VERSION) return state;

  const backupId = `backup-v${state && state.version}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await getPool().query(`INSERT INTO ${TABLE} (id, state) VALUES ($1, $2)`, [backupId, JSON.stringify(state)]);
  console.warn(`[db] Saved state is from schema v${state && state.version}, expected v${SCHEMA_VERSION}. Kept it as row "${backupId}" and reseeding.`);
  return null;
}

let latest = null; // the state object to write next (it is mutated in place, so this is always current)
let writing = null;

/** Queue a write of `state`. Resolves when the write that includes this change has finished. */
export function saveStateToPg(state) {
  latest = state;
  if (writing) return writing;
  writing = (async () => {
    try {
      // Loop so changes made while a write was in flight get written too, in one more write.
      while (latest) {
        const snapshot = JSON.stringify(latest);
        latest = null;
        await ensureTable();
        await getPool().query(
          `INSERT INTO ${TABLE} (id, state, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
          [CURRENT_ID, snapshot]
        );
      }
    } finally {
      writing = null;
    }
  })();
  return writing;
}
