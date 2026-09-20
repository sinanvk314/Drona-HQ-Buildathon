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
  const [target, other] = live;
  console.log(`\nPausing "${target.name}" for ${waitMs / 1000}s while "${other.name}" keeps running...`);
  const before = { target: await prospectsOf(target.id), other: await prospectsOf(other.id) };
  const paused = await call(`/api/campaigns/${target.id}/pause`, { method: "POST", body: "{}" });
  check(paused.status === 200 && paused.body?.status === "paused", "campaign paused");
  try {
    await sleep(waitMs);
    const after = { target: await prospectsOf(target.id), other: await prospectsOf(other.id) };
    check(after.target === before.target, "paused campaign made no progress", `${before.target} -> ${after.target}`);
    check(after.other > before.other, "other Live campaign kept running", `${before.other} -> ${after.other}`);
  } finally {
    const resumed = await call(`/api/campaigns/${target.id}/resume`, { method: "POST", body: "{}" });
    check(resumed.status === 200 && resumed.body?.status === "live", "campaign resumed (state restored)");
  }
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exitCode = failed ? 1 : 0;
