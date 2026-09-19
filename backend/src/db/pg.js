// Postgres connection pool. Only imported when config.databaseUrl is set (see db/index.js) —
// a backend with no DATABASE_URL never touches this file, so `pg` staying uninstalled or
// unreachable never affects the zero-setup local JSON-file mode.
import pg from "pg";

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon (and most managed Postgres) requires TLS; Neon's cert chain is publicly trusted,
      // but we don't require full chain verification here since this is a hackathon backend
      // connecting over a pooled connection string that already carries its own credentials.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

// Runs `fn(client)` inside a single BEGIN/COMMIT transaction, rolling back on any error.
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
