// Smoke test for a running deployment (local or live): the app is up, three campaigns exist, the read
// endpoints answer, and the required demonstration holds: pausing one Live campaign stops only that one.
//
//   node scripts/smoke.mjs                          (http://localhost:8080)
//   node scripts/smoke.mjs https://your-app.onrender.com [waitSeconds]
//
// If the site has an access code (APP_ACCESS_CODE), give it in the SMOKE_ACCESS_CODE environment variable.
//
// It pauses one Live campaign for `waitSeconds` (default 30, at least two scheduler ticks) and then
// resumes it, so it leaves the app as it found it. Do not run it in the middle of a judged demo.
const base = (process.argv[2] || "http://localhost:8080").replace(/\/+$/, "");
const waitMs = (Number(process.argv[3]) || 30) * 1000;

let failed = 0;
const ok = (name, detail = "") => console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
const bad = (name, detail = "") => {
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
};
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

let token = null;
async function call(path, options) {
  const res = await fetch(`${base}${path}`, { ...options, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prospectsOf = async (id) => (await call(`/api/campaigns/${id}`)).body.metrics.pipeline;

console.log(`Smoke test against ${base}\n`);

const health = await call("/health");
if (health.body && health.body.signInRequired) {
  const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ name: "smoke test", code: process.env.SMOKE_ACCESS_CODE || "" }) });
  check(login.status === 200, "sign in with the access code", login.status === 200 ? "" : "set SMOKE_ACCESS_CODE");
  token = login.body && login.body.token;
}
check(health.status === 200 && health.body?.ok === true, "health endpoint", `engine: ${health.body?.agentEngine}`);

const cc = await call("/api/command-center");
check(cc.status === 200, "command center loads");
const campaigns = cc.body?.campaigns || [];
check(campaigns.length >= 3, "at least three campaigns exist", `${campaigns.length} found`);
console.log(`        ${campaigns.map((c) => `${c.name}: ${c.status}`).join(" | ")}`);

for (const path of ["/api/approvals", "/api/decisions?limit=3", "/api/agents", "/api/settings", "/api/prospects"]) {
  const r = await call(path);
  check(r.status === 200, `GET ${path}`);
}

const live = campaigns.filter((c) => c.status === "live");
if (live.length < 2) {
  console.log("\n  SKIP  pause-isolation check needs at least two Live campaigns");
} else if (cc.body.killSwitch) {
  console.log("\n  SKIP  the global kill switch is on, so nothing is running");
} else {
  const [target, ...others] = live;
  console.log(`
Pausing "${target.name}" for ${waitMs / 1000}s while ${others.length} other Live campaign${others.length === 1 ? "" : "s"} keep running...`);
  // "Running" is measured by when the scheduler last worked on a campaign, not by how many prospects it has: a campaign can be
  // busy without gaining a prospect (a one-person campaign never does; a model-driven search is throttled), and a model call that
  // was already in flight when a campaign was paused may still finish, which is harmless.
  const info = async (id) => { const r = (await call(`/api/campaigns/${id}`)).body; return { ts: r.lastTickTs, n: r.metrics.pipeline }; };
  const paused = await call(`/api/campaigns/${target.id}/pause`, { method: "POST", body: "{}" });
  check(paused.status === 200 && paused.body?.status === "paused", "campaign paused");
  try {
    await sleep(Math.min(15000, waitMs / 2)); // let anything already in flight finish
    const before = { target: await info(target.id) };
    for (const o of others) before[o.id] = await info(o.id);
    await sleep(waitMs);
    const after = { target: await info(target.id) };
    for (const o of others) after[o.id] = await info(o.id);
    const usesClock = before.target.ts !== undefined; // null means "not worked on yet"; undefined means an older server
    if (usesClock) {
      check(after.target.ts === before.target.ts, "paused campaign was not worked on", `last worked on ${before.target.ts ? new Date(before.target.ts).toISOString() : "never"}, unchanged`);
      const alive = others.filter((o) => (after[o.id].ts || 0) > (before[o.id].ts || 0));
      for (const o of others) console.log(`        ${o.name}: worked on ${(after[o.id].ts || 0) > (before[o.id].ts || 0) ? "again during the pause" : "not during the pause"} (${before[o.id].n} -> ${after[o.id].n} prospects)`);
      check(alive.length > 0, "another Live campaign kept running", alive.map((o) => o.name).join(", ") || "none was worked on: is the scheduler running?");
    } else {
      // An older server without the proof-of-life field: fall back to counting prospects.
      check(after.target.n === before.target.n, "paused campaign made no progress", `${before.target.n} -> ${after.target.n}`);
      const grew = others.filter((o) => after[o.id].n > before[o.id].n);
      check(grew.length > 0, "another Live campaign kept running", grew.map((o) => o.name).join(", ") || "none gained prospects (redeploy the latest version for a better check)");
    }
  } finally {
    const resumed = await call(`/api/campaigns/${target.id}/resume`, { method: "POST", body: "{}" });
    check(resumed.status === 200 && resumed.body?.status === "live", "campaign resumed (state restored)");
  }
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exitCode = failed ? 1 : 0;
