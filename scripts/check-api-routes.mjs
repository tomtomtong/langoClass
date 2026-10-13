import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchApiRoute } from "../worker/api-routes.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function expressRoutes() {
  const src = fs.readFileSync(path.join(root, "server.js"), "utf8");
  return [...src.matchAll(/app\.(get|post|put|patch|delete)\(\s*"(\/api\/[^"]+)"/g)].map((match) => ({
    method: match[1].toUpperCase(),
    path: match[2],
  }));
}

function workerRoutes() {
  const src = fs.readFileSync(path.join(root, "worker", "api-routes.js"), "utf8");
  return [...src.matchAll(/\{\s*method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)"\s*\}/g)].map((match) => ({
    method: match[1],
    path: match[2],
  }));
}

const fromExpress = expressRoutes();
const fromWorker = workerRoutes();
assert.deepEqual(
  fromWorker,
  fromExpress,
  "worker/api-routes.js is out of date with server.js HTTP routes"
);

function expect(method, pathname, routePath) {
  const route = matchApiRoute(method, pathname);
  assert.equal(route?.path ?? null, routePath, `${method} ${pathname}`);
}

expect("GET", "/api/cms/courses/export-all", "/api/cms/courses/export-all");
expect("GET", "/api/cms/courses/12", "/api/cms/courses/:courseId");
expect("GET", "/api/cms/courses/12/", "/api/cms/courses/:courseId");
expect("GET", "/api/cms/courses/12/export", "/api/cms/courses/:courseId/export");
expect("POST", "/api/cms/courses/12/export", null);
expect("GET", "/api/config/", "/api/config");
expect("HEAD", "/api/config", "/api/config");
expect("GET", "/api/room-qr.svg", "/api/room-qr.svg");
expect("GET", "/api/room-qrsvg", null);
expect("GET", "/api/cms/question-tts/abc", "/api/cms/question-tts/:cacheKey");
expect("DELETE", "/api/cms/courses/9", "/api/cms/courses/:courseId");
expect("GET", "/api/does-not-exist", null);

console.log(`API routes match Express (${fromExpress.length})`);
