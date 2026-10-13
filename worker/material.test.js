import assert from "node:assert/strict";
import test from "node:test";
import { developerLogin } from "./dev-account.js";
import { fileKind, prepareMaterialRequest, truncateMaterial } from "./material.js";

async function developerBearer() {
  const response = await developerLogin(
    new Request("https://class.lango.ai/api/lango/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "lango-developer-alex", password: "lango123" }),
    })
  );
  const body = await response.json();
  return body.token;
}

test("document kinds are recognized from the file name", () => {
  assert.equal(fileKind({ name: "notes.DOCX", type: "" }), "docx");
  assert.equal(fileKind({ name: "scan.pdf", type: "" }), "pdf");
  assert.equal(fileKind({ name: "photo.HEIC", type: "" }), "heic");
  assert.equal(fileKind({ name: "clip.mp4", type: "video/mp4" }), "other");
});

test("material text keeps the classroom truncation marker", () => {
  const result = truncateMaterial("a".repeat(20), 8);
  assert.equal(result.truncated, true);
  assert.equal(result.originalLength, 20);
  assert.match(result.text, /truncated for generation/);
});

test("a Word upload is read in the container and the JSON shape stays the same", async () => {
  const form = new FormData();
  form.set("file", new File(["unused"], "Lesson.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  const request = new Request("https://class.lango.ai/api/cms/extract-material", {
    method: "POST",
    headers: { authorization: `Bearer ${await developerBearer()}` },
    body: form,
  });
  const env = {
    MEDIA: {
      getByName() {
        return {
          async fetch() {
            return Response.json({ text: "Hello from Word" });
          },
        };
      },
    },
  };
  const prepared = await prepareMaterialRequest(request, env, new URL(request.url));
  assert.equal(prepared.response.headers.get("x-media-runtime"), "container");
  const body = await prepared.response.json();
  assert.equal(body.ok, true);
  assert.equal(body.text, "Hello from Word");
  assert.equal(body.format, "docx");
  assert.deepEqual(body.extraction.methods, ["docx"]);
  assert.equal(body.imageAssetCount, 0);
});

test("a short PDF falls back so scanned pages can still be read", async () => {
  const form = new FormData();
  form.set("file", new File(["unused"], "scan.pdf", { type: "application/pdf" }));
  const request = new Request("https://class.lango.ai/api/cms/extract-material", {
    method: "POST",
    headers: { authorization: `Bearer ${await developerBearer()}` },
    body: form,
  });
  let called = false;
  const env = {
    MEDIA: {
      getByName() {
        return {
          async fetch() {
            called = true;
            return Response.json({ text: "x" });
          },
        };
      },
    },
  };
  const prepared = await prepareMaterialRequest(request, env, new URL(request.url));
  assert.equal(called, true);
  assert.equal(prepared.response, undefined);
  assert.equal(prepared.request.method, "POST");
});