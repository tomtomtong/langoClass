import assert from "node:assert/strict";
import test from "node:test";
import { accessGate, resetAccessKeys, verifyAccessJwt } from "./access.js";
import { handleTurnstileConfig, turnstileGate } from "./turnstile.js";

const TS_ENV = { TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };

function req(method, path, headers = {}) {
  const url = new URL(path, "https://class.lango.ai");
  return [new Request(url, { method, headers }), url];
}

const siteverify = (success) => async () => Response.json({ success });

test("turnstile is off until both keys are set", async () => {
  const [r, u] = req("POST", "/api/lango/login");
  assert.equal(await turnstileGate(r, {}, u), null);
  const [c, cu] = req("GET", "/api/turnstile");
  assert.deepEqual(await handleTurnstileConfig(c, {}, cu).json(), { siteKey: "" });
});

test("turnstile blocks guarded routes without a valid token", async () => {
  for (const [method, path] of [["POST", "/api/lango/login"], ["POST", "/api/logs/login"], ["GET", "/api/join/lookup?studentId=1"]]) {
    const [r, u] = req(method, path);
    assert.equal((await turnstileGate(r, TS_ENV, u, siteverify(true))).status, 403);
    const [bad, bu] = req(method, path, { "x-turnstile-token": "t" });
    assert.equal((await turnstileGate(bad, TS_ENV, bu, siteverify(false))).status, 403);
    const [ok, ou] = req(method, path, { "x-turnstile-token": "t" });
    assert.equal(await turnstileGate(ok, TS_ENV, ou, siteverify(true)), null);
  }
});

test("turnstile leaves other routes alone", async () => {
  const [r, u] = req("GET", "/api/lango/classList");
  assert.equal(await turnstileGate(r, TS_ENV, u, siteverify(false)), null);
});

const DOMAIN = "lango.cloudflareaccess.com";
const AUD = "aud-tag";

async function keyPair() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
  return { pair, certs: async () => Response.json({ keys: [jwk] }) };
}

const b64 = (v) => Buffer.from(typeof v === "string" ? v : new Uint8Array(v)).toString("base64url");

async function jwt(privateKey, claims) {
  const head = b64(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64(sig)}`;
}

const good = () => ({ aud: [AUD], iss: `https://${DOMAIN}`, exp: Math.floor(Date.now() / 1000) + 600, email: "a@lango.ai" });

test("access JWT verification checks signature, aud, iss and exp", async () => {
  resetAccessKeys();
  const { pair, certs } = await keyPair();
  const opts = { domain: DOMAIN, aud: AUD, fetcher: certs };
  assert.equal((await verifyAccessJwt(await jwt(pair.privateKey, good()), opts)).email, "a@lango.ai");
  assert.equal(await verifyAccessJwt(await jwt(pair.privateKey, { ...good(), aud: ["other"] }), opts), null);
  assert.equal(await verifyAccessJwt(await jwt(pair.privateKey, { ...good(), iss: "https://evil" }), opts), null);
  assert.equal(await verifyAccessJwt(await jwt(pair.privateKey, { ...good(), exp: 1 }), opts), null);
  const other = await keyPair();
  assert.equal(await verifyAccessJwt(await jwt(other.pair.privateKey, good()), opts), null);
  assert.equal(await verifyAccessJwt("junk", opts), null);
});

test("access gate guards admin paths only when configured", async () => {
  resetAccessKeys();
  const { pair, certs } = await keyPair();
  const env = { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD };
  const [none, nu] = req("GET", "/api/logs");
  assert.equal(await accessGate(none, {}, nu, certs), null);
  assert.equal((await accessGate(none, env, nu, certs)).status, 403);
  const [page, pu] = req("GET", "/config.html");
  assert.equal((await accessGate(page, env, pu, certs)).status, 403);
  const token = await jwt(pair.privateKey, good());
  const [ok, ou] = req("GET", "/api/logs/stats", { "cf-access-jwt-assertion": token });
  assert.equal(await accessGate(ok, env, ou, certs), null);
  const [pub, pubu] = req("POST", "/api/lango/login");
  assert.equal(await accessGate(pub, env, pubu, certs), null);
});
