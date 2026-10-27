import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { ZipWriter, openZipEntry, readZipEntries } from "./course-zip.js";
import { api, developerToken, getDoc, memoryD1, memoryR2, putDoc } from "./test-env.js";

const require = createRequire(import.meta.url);
const archiver = require("archiver");
const AdmZip = require("adm-zip");

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6, 7, 8]);

// A backup the way lib/course-export.js writes it: archiver, deflate level 6.
async function nodeBackup(files) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  archive.on("data", (chunk) => chunks.push(chunk));
  const ended = new Promise((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });
  for (const [name, data] of Object.entries(files)) archive.append(Buffer.from(data), { name });
  archive.finalize();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}

function memorySource(bytes) {
  return {
    size: bytes.length,
    bytes: async (start, end) => bytes.slice(start, end),
    stream: (start, end) => new Response(bytes.slice(start, end)).body,
  };
}

async function setup() {
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), ORIGIN: "" };
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleStoreApi, env, token) };
}

function backupCourse() {
  return {
    id: 4,
    name: "Animals",
    description: "Farm animals",
    banner: "assets/courses/banner.png",
    langCode: "en",
    sections: [
      {
        id: 1,
        title: "Farm",
        banner: "/uploads/sections/old.png",
        exercises: [
          {
            id: 9,
            type: "mcquiz",
            title: "Cow",
            items: [
              { image: "assets/questions/cow.png", text: "Moo?" },
              { image: "assets/questions/missing.png", text: "Gone" },
            ],
          },
        ],
      },
    ],
  };
}

test("the reader inflates entries from a backup Node's exporter wrote", async () => {
  const zip = await nodeBackup({ "course.json": '{"name":"A"}', "assets/courses/x.png": PNG });
  const source = memorySource(zip);
  const entries = await readZipEntries(source);
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ["assets/courses/x.png", "course.json"]);
  const png = entries.find((entry) => entry.name.endsWith(".png"));
  assert.deepEqual(new Uint8Array(await new Response(await openZipEntry(source, png)).arrayBuffer()), PNG);
});

test("adm-zip, which Node's importer uses, reads the writer's output", async () => {
  const { readable, writable } = new TransformStream();
  const zip = new ZipWriter(writable.getWriter());
  const done = (async () => {
    await zip.add("course.json", '{"name":"B"}');
    await zip.add("assets/videos/v.mp4", new Response(new Uint8Array(70000).fill(7)).body);
    await zip.finish();
  })();
  const bytes = Buffer.from(await new Response(readable).arrayBuffer());
  await done;
  const read = new AdmZip(bytes);
  assert.equal(read.readAsText("course.json"), '{"name":"B"}');
  assert.equal(read.getEntry("assets/videos/v.mp4").getData().length, 70000);
});

test("a chunked import puts files in R2 and the course in D1", async () => {
  const { env, call } = await setup();
  const zip = await nodeBackup({
    "manifest.json": JSON.stringify({ version: 1 }),
    "course.json": JSON.stringify(backupCourse()),
    "assets/courses/banner.png": PNG,
    "assets/questions/cow.png": PNG,
    "assets/sections/old.png": PNG,
  });
  const init = await (await call("/api/cms/courses/import-one/init", {
    method: "POST",
    json: { totalBytes: zip.length, totalChunks: 3, fileName: "a.zip" },
  })).json();
  assert.equal(init.ok, true);
  const cuts = [0, 101, 400, zip.length];
  for (let i = 0; i < 3; i += 1) {
    const form = new FormData();
    form.append("uploadId", init.uploadId);
    form.append("chunkIndex", String(i));
    form.append("chunk", new Blob([zip.slice(cuts[i], cuts[i + 1])]), `chunk-${i}`);
    const sent = await call("/api/cms/courses/import-one/chunk", { method: "POST", body: form });
    assert.equal(sent.status, 200);
  }
  const done = await call("/api/cms/courses/import-one/complete", { method: "POST", json: { uploadId: init.uploadId } });
  const result = await done.json();
  assert.equal(done.status, 200, JSON.stringify(result));
  assert.equal(result.imported, 1);
  assert.equal(result.courses[0].exerciseCount, 1);

  const [course] = (await getDoc(env, "teacher-courses")).courses;
  assert.equal(course.id, result.courses[0].id);
  assert.equal(course.teacherId, 835);
  assert.match(course.banner, /^\/uploads\/courses\/import-835-\d+-\w+\.png$/);
  assert.match(course.sections[0].banner, /^\/uploads\/sections\/import-835-/);
  assert.match(course.sections[0].exercises[0].items[0].image, /^\/uploads\/questions\/import-835-/);
  assert.equal(course.sections[0].exercises[0].items[1].image, null);
  assert.deepEqual(env.UPLOADS.objects.get(course.banner.slice(1)).bytes, PNG);
  assert.equal([...env.UPLOADS.objects.keys()].some((key) => key.startsWith("import-tmp/")), false);
});

test("a broken backup leaves existing courses alone on import-all", async () => {
  const { env, call } = await setup();
  await putDoc(env, "teacher-courses", { courses: [{ id: -1, teacherId: 835, name: "Keep", sections: [] }] });
  const form = new FormData();
  form.append("file", new Blob([await nodeBackup({ "readme.txt": "no course" })]), "x.zip");
  const response = await call("/api/cms/courses/import-all", { method: "POST", body: form });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "No course.json found in ZIP.");
  assert.equal((await getDoc(env, "teacher-courses")).courses[0].name, "Keep");
});

test("an export imports back as the same course with its files", async () => {
  const { env, call } = await setup();
  await env.UPLOADS.put("uploads/courses/b.png", PNG);
  await putDoc(env, "teacher-courses", {
    courses: [{
      id: -3,
      teacherId: 835,
      name: "Colours",
      banner: "/uploads/courses/b.png",
      langCode: "en",
      sections: [{ id: 1, title: "Red", order: 1, exercises: [{ id: 2, type: "video", items: [{ videoUrl: "/uploads/videos/gone.mp4" }] }] }],
    }],
  });

  const exported = await call("/api/cms/courses/-3/export");
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("content-disposition"), 'attachment; filename="course--3-colours.zip"');
  const bytes = Buffer.from(await exported.arrayBuffer());
  const zip = new AdmZip(bytes);
  const course = JSON.parse(zip.readAsText("course.json"));
  assert.equal(course.banner, "assets/courses/b.png");
  assert.deepEqual(new Uint8Array(zip.getEntry("assets/courses/b.png").getData()), PNG);
  const manifest = JSON.parse(zip.readAsText("manifest.json"));
  assert.equal(manifest.courses[0].assetCount, 1);
  assert.equal(manifest.courses[0].assets.find((asset) => asset.assetPath === "assets/videos/gone.mp4").error, "File not found");

  const form = new FormData();
  form.append("file", new Blob([bytes]), "course.zip");
  const imported = await (await call("/api/cms/courses/import-one", { method: "POST", body: form })).json();
  assert.equal(imported.imported, 1);
  const copy = (await getDoc(env, "teacher-courses")).courses.find((item) => item.id === imported.courses[0].id);
  assert.equal(copy.name, "Colours");
  assert.notEqual(copy.banner, "/uploads/courses/b.png");
  assert.deepEqual(env.UPLOADS.objects.get(copy.banner.slice(1)).bytes, PNG);
});

test("export-all reports no courses with a 404", async () => {
  const { call } = await setup();
  const response = await call("/api/cms/courses/export-all");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, "No courses to export.");
});
