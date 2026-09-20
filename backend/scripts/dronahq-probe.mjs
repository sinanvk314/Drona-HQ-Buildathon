// Calls one DronaHQ webhook trigger with a small message and shows exactly what comes back, so you can tell
// whether a trigger returns the agent's output or `response: null`.
//
//   Test agent:   set DRONAHQ_TEST_URL=<webhook url>   set DRONAHQ_TEST_KEY=<its api key>   node scripts/dronahq-probe.mjs
//   ICP agent:    node scripts/dronahq-probe.mjs icp          (uses DRONAHQ_WEBHOOK_ICP / DRONAHQ_API_KEY_ICP from .env)
//
// The URL and key are read from the environment and never printed. Each call runs the agent once (a few credits).
import "dotenv/config";

const useIcp = process.argv[2] === "icp";
const url = useIcp ? process.env.DRONAHQ_WEBHOOK_ICP : process.env.DRONAHQ_TEST_URL;
const key = useIcp ? process.env.DRONAHQ_API_KEY_ICP : process.env.DRONAHQ_TEST_KEY;
if (!url || !key) {
  console.error(useIcp ? "DRONAHQ_WEBHOOK_ICP / DRONAHQ_API_KEY_ICP are not set in backend/.env." : "Set DRONAHQ_TEST_URL and DRONAHQ_TEST_KEY first (see the top of this file).");
  process.exitCode = 1;
} else {
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": key },
    body: JSON.stringify({ message: "hello from the probe" }),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status} in ${Date.now() - started} ms\n`);
  let body = null;
  try {
    body = JSON.parse(text);
    console.log(JSON.stringify(body, null, 2));
  } catch {
    console.log(text);
  }
  console.log();
  if (body && body.response !== undefined && body.response !== null) {
    console.log("RESULT: the webhook RETURNED the agent's output (see `response` above).");
  } else if (body && "response" in body) {
    console.log("RESULT: the run succeeded but `response` is null: no output came back.");
  } else {
    console.log("RESULT: no `response` field in the reply (Response is probably set to None, or the call failed).");
  }
}
