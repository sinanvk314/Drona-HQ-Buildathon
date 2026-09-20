// Sign-in: tokens, the access code, the middleware and who-did-it.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_ACCESS_CODE = "open-sesame";
process.env.AUTH_SECRET = "test-secret";
const { config } = await import("../src/config.js");
const auth = await import("../src/services/auth.js");

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const run = (headers, path = "/campaigns") => {
  const r = res();
  let user = null;
  auth.authMiddleware({ path, headers }, r, () => (user = auth.currentUser()));
  return { r, user };
};

test("a valid token identifies its user, and tampering or expiry invalidates it", () => {
  const token = auth.issueToken("Priya S.");
  assert.deepEqual(auth.verifyToken(token), { name: "Priya S." });
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ name: "Admin", exp: Date.now() + 1e9 })).toString("base64url");
  assert.equal(auth.verifyToken(`${forged}.${signature}`), null, "a payload swapped under the same signature is rejected");
  assert.equal(auth.verifyToken(`${payload}.${signature.slice(0, -2)}xx`), null, "a bad signature is rejected");
  assert.equal(auth.verifyToken(token, Date.now() + (config.auth.ttlHours + 1) * 3600 * 1000), null, "an expired token is rejected");
  assert.equal(auth.verifyToken("garbage"), null);
  assert.equal(auth.verifyToken(""), null);
});

test("names are cleaned, and an empty name becomes the default user", () => {
  assert.equal(auth.cleanName("  Rohit   K.  "), "Rohit K.");
  assert.equal(auth.cleanName("<script>alert(1)</script>"), "scriptalert1script");
  assert.equal(auth.cleanName(""), "JD");
  assert.equal(auth.cleanName(undefined), "JD");
  assert.equal(auth.cleanName("x".repeat(100)).length, 40);
});

test("with an access code set, login needs the right code", () => {
  assert.equal(auth.authConfig().codeRequired, true);
  assert.throws(() => auth.login({ name: "Sinan", code: "wrong" }, "1.1.1.1"), /Incorrect access code/);
  assert.throws(() => auth.login({ name: "Sinan" }, "1.1.1.1"), /Incorrect access code/);
  const ok = auth.login({ name: "Sinan", code: "open-sesame" }, "1.1.1.1");
  assert.equal(ok.user.name, "Sinan");
  assert.deepEqual(auth.verifyToken(ok.token), { name: "Sinan" });
});

test("repeated wrong codes from one address are slowed down, others are not", () => {
  for (let i = 0; i < 8; i++) assert.throws(() => auth.login({ name: "x", code: "nope" }, "9.9.9.9"), /Incorrect/);
  assert.throws(() => auth.login({ name: "x", code: "open-sesame" }, "9.9.9.9"), /Too many attempts/);
  assert.equal(auth.login({ name: "x", code: "open-sesame" }, "8.8.8.8").user.name, "x");
});

test("the API refuses anonymous requests when a code is set, lets sign-in through, and knows who is calling", () => {
  assert.equal(run({}).r.code, 401);
  assert.equal(run({ authorization: "Bearer nonsense" }).r.code, 401);
  assert.equal(run({}, "/auth/login").r.code, null, "the login route is reachable");
  const token = auth.issueToken("Priya S.");
  const signedIn = run({ authorization: `Bearer ${token}` });
  assert.equal(signedIn.r.code, null);
  assert.equal(signedIn.user, "Priya S.", "the request runs as the signed-in user");
});

test("in open mode (no code) the API works without a session, as the default user", () => {
  const saved = config.auth.accessCode;
  config.auth.accessCode = "";
  try {
    assert.equal(auth.authConfig().codeRequired, false);
    const anonymous = run({});
    assert.equal(anonymous.r.code, null);
    assert.equal(anonymous.user, "JD");
    assert.equal(auth.login({ name: "Sinan" }).user.name, "Sinan", "login only asks for a name");
    assert.equal(run({ authorization: `Bearer ${auth.issueToken("Sinan")}` }).user, "Sinan", "a signed-in name is still recorded");
  } finally {
    config.auth.accessCode = saved;
  }
});

test("outside a request the current user is the default", () => {
  assert.equal(auth.currentUser(), "JD");
});
