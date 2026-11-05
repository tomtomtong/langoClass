import assert from "node:assert/strict";
import test from "node:test";
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
