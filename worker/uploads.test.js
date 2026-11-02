import assert from "node:assert/strict";
import test from "node:test";
import { collectUploadPaths, mirrorStoredUploads, serveUpload, uploadKey } from "./uploads.js";

test("upload keys stay inside the upload folders", () => {
  assert.equal(uploadKey("/uploads/courses/course--24-1789535179085.png"), "uploads/courses/course--24-1789535179085.png");
  assert.equal(uploadKey("/uploads/community/1/1788247596505-2a7007dc.jpg"), "uploads/community/1/1788247596505-2a7007dc.jpg");
  assert.equal(
    uploadKey("/uploads/lectures/lango-cambridge-s8-u1-1/voice/intro.mp3"),
    "uploads/lectures/lango-cambridge-s8-u1-1/voice/intro.mp3"
  );
  assert.equal(uploadKey("/uploads/courses/../../server.js"), "");
  assert.equal(uploadKey("/uploads/other/file.png"), "");
  assert.equal(uploadKey("/host.html"), "");
});

test("course JSON yields the upload paths it references", () => {
  const paths = collectUploadPaths({
    banner: "/uploads/courses/a.png",
    sections: [{ videoUrl: "https://classroom.lango.ai/uploads/videos/clip.mp4", note: "keep" }],
  });
  assert.deepEqual([...paths], ["/uploads/courses/a.png", "/uploads/videos/clip.mp4"]);
});

test("an upload in R2 is served from R2, with ranges", async () => {
  const bucket = memoryBucket();
  await bucket.put("uploads/courses/a.png", "png-bytes", { httpMetadata: { contentType: "image/png" } });

  const full = await serveUpload(new Request("https://class.lango.ai/uploads/courses/a.png"), { bucket });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("x-upload-store"), "r2");
  assert.equal(full.headers.get("content-type"), "image/png");
  assert.equal(await full.text(), "png-bytes");

  const ranged = await serveUpload(
    new Request("https://class.lango.ai/uploads/courses/a.png", { headers: { range: "bytes=0-1" } }),
    { bucket }
  );
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 0-1/9");
});

test("an upload missing from R2 is a 404, not a request to the old server", async () => {
  const bucket = memoryBucket();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const got = await serveUpload(new Request("https://class.lango.ai/uploads/courses/missing.png"), { bucket });
    assert.equal(got.status, 404);
    assert.equal(got.headers.get("cache-control"), "no-store");
    const head = await serveUpload(new Request("https://class.lango.ai/uploads/courses/missing.png", { method: "HEAD" }), { bucket });
    assert.equal(head.status, 404);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a saved upload response copies the new file into R2", async () => {
  const bucket = memoryBucket();
  const response = new Response(JSON.stringify({ url: "/uploads/questions/q.png" }), {
    headers: { "content-type": "application/json" },
  });
  const stored = await mirrorStoredUploads(response, {
    bucket,
    origin: "https://classroom.lango.ai",
    method: "POST",
    fetchImpl: async () =>
      new Response("image", { status: 200, headers: { "content-type": "image/png", "content-length": "5" } }),
  });
  assert.equal(stored, 1);
  assert.equal(bucket.objects.get("uploads/questions/q.png").size, 5);
  assert.deepEqual(await response.json(), { url: "/uploads/questions/q.png" });
});

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async head(key) {
      return objects.get(key) || null;
    },
    async get(key, opts) {
      const item = objects.get(key);
      if (!item) return null;
      const headers = opts?.onlyIf instanceof Headers ? opts.onlyIf : new Headers();
      if (headers.get("if-none-match") === item.httpEtag) {
        return { key, size: item.size, httpEtag: item.httpEtag, writeHttpMetadata: item.writeHttpMetadata };
      }
      const range = opts?.range instanceof Headers ? opts.range.get("range") : "";
      if (range) {
        return {
          key,
          size: item.size,
          httpEtag: item.httpEtag,
          range: { offset: 0, length: 2 },
          body: new Blob([item.bytes.slice(0, 2)]).stream(),
          writeHttpMetadata: item.writeHttpMetadata,
        };
      }
      return {
        key,
        size: item.size,
        httpEtag: item.httpEtag,
        range: { offset: 0, length: item.size },
        body: new Blob([item.bytes]).stream(),
        writeHttpMetadata: item.writeHttpMetadata,
      };
    },
    async put(key, body, opts) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const contentType = opts?.httpMetadata?.contentType || "application/octet-stream";
      objects.set(key, {
        key,
        size: bytes.byteLength,
        bytes,
        httpEtag: '"stored"',
        writeHttpMetadata(headers) {
          headers.set("content-type", contentType);
        },
      });
    },
  };
}
