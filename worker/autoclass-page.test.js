import assert from "node:assert/strict";
import test from "node:test";
import { isAutoclassPath, serveAutoclassPage } from "./autoclass-page.js";

const assets = { fetch: async (request) => new Response(`asset ${new URL(request.url).pathname}`) };
const get = (path) => new Request(`https://class.lango.ai${path}`);

test("the autoclass page and its files are the autoclass paths", () => {
  for (const path of ["/autoclass.html", "/autoclass.js", "/autoclass.css", "/autoclass-analysis.js", "/autoclass/animal-homes.cues.json"]) {
    assert.equal(isAutoclassPath(path), true, path);
  }
  for (const path of ["/host.html", "/join.html", "/autoclassroom/x", "/uploads/autoclass/a.mp3", "/api/autoclass"]) {
    assert.equal(isAutoclassPath(path), false, path);
  }
});

test("autoclass is a 404 unless AUTOCLASS is on", async () => {
  const off = await serveAutoclassPage(get("/autoclass.html"), { ASSETS: assets }, "/autoclass.html");
  assert.equal(off.status, 404);
  const on = await serveAutoclassPage(get("/autoclass.html"), { ASSETS: assets, AUTOCLASS: "1" }, "/autoclass.html");
  assert.equal(on.status, 200);
  assert.equal(await on.text(), "asset /autoclass.html");
});

test("other paths are left alone", async () => {
  assert.equal(await serveAutoclassPage(get("/host.html"), { ASSETS: assets, AUTOCLASS: "1" }, "/host.html"), null);
});
