import assert from "node:assert/strict";
import test from "node:test";
import { handleLogsApi, writeLog } from "./app-logs.js";
import { memoryD1 } from "./test-env.js";

function call(env, path, { method = "GET", token, body } = {}) {
  const url = new URL(path, "https://class.lango.ai");
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleLogsApi(new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, url);
}

async function signIn(env) {
  const response = await call(env, "/api/logs/login", {
    method: "POST",
    body: { username: "langoclass-admin", password: "langoclasspassword123" },
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

test("logs need the admin login", async () => {
  const env = { DB: memoryD1() };
  assert.equal((await call(env, "/api/logs")).status, 401);
  assert.equal((await call(env, "/api/logs", { token: "123.abc" })).status, 401);
  const wrong = await call(env, "/api/logs/login", { method: "POST", body: { username: "langoclass-admin", password: "nope" } });
  assert.equal(wrong.status, 401);
  const token = await signIn(env);
  assert.equal((await call(env, "/api/logs", { token })).status, 200);
});

test("an expired or forged admin token is refused", async () => {
  const env = { DB: memoryD1() };
  const token = await signIn(env);
  const [, signature] = token.split(".");
  assert.equal((await call(env, "/api/logs", { token: `${Date.now() - 1}.${signature}` })).status, 401);
  assert.equal((await call(env, "/api/logs", { token: `${Date.now() + 999999999}.${signature}` })).status, 401);
});

test("Worker secrets replace the default admin login", async () => {
  const env = { DB: memoryD1(), LOG_ADMIN_USERNAME: "boss", LOG_ADMIN_PASSWORD: "s3cret" };
  const old = await call(env, "/api/logs/login", { method: "POST", body: { username: "langoclass-admin", password: "langoclasspassword123" } });
  assert.equal(old.status, 401);
  const ok = await call(env, "/api/logs/login", { method: "POST", body: { username: "boss", password: "s3cret" } });
  assert.equal(ok.status, 200);
});

test("logs filter, search, count and clear", async () => {
  const env = { DB: memoryD1() };
  await writeLog(env, { category: "ai", action: "tts_failed", message: "Inworld timeout", level: "error", meta: { room: "123456" } });
  await writeLog(env, { category: "school", action: "class_list_loaded", message: "Loaded 3 class(es)" });
  await writeLog(env, { category: "nonsense", action: "x" });
  const token = await signIn(env);

  const errors = await (await call(env, "/api/logs?level=error", { token })).json();
  assert.equal(errors.total, 1);
  assert.equal(errors.entries[0].action, "tts_failed");
  assert.deepEqual(errors.entries[0].meta, { room: "123456" });

  const search = await (await call(env, "/api/logs?q=123456", { token })).json();
  assert.equal(search.total, 1);

  const school = await (await call(env, "/api/logs?category=school", { token })).json();
  assert.equal(school.entries[0].message, "Loaded 3 class(es)");

  const stats = await (await call(env, "/api/logs/stats", { token })).json();
  assert.equal(stats.total, 4);
  assert.equal(stats.byCategory.server, 1);
  assert.equal(stats.byCategory.login, 1);
  assert.equal(stats.byLevel.error, 1);

  assert.deepEqual(await (await call(env, "/api/logs/debug-files", { token })).json(), { files: [] });
  assert.equal((await call(env, "/api/logs", { method: "DELETE", token })).status, 200);
  const after = await (await call(env, "/api/logs", { token })).json();
  assert.deepEqual(after.entries.map((entry) => entry.action), ["logs_cleared"]);
});

test("a log write without the table does not throw", async () => {
  const env = { DB: memoryD1({ migrate: false }) };
  const entry = await writeLog(env, { action: "x" });
  assert.equal(entry.category, "server");
});
