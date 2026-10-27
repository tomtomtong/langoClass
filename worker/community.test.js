import assert from "node:assert/strict";
import test from "node:test";
import { handleStoreApi } from "./d1-api.js";
import { api, developerToken, getDoc, memoryD1, memoryR2, putDoc } from "./test-env.js";

const PNG = new Uint8Array([137, 80, 78, 71, 9, 9]);

function course(extra = {}) {
  return {
    id: -2,
    teacherId: 835,
    name: "Animals",
    description: "Farm",
    banner: "/uploads/courses/a.png",
    langCode: "en",
    sections: [{ id: 1, title: "Farm", exercises: [{ id: 1, type: "mcquiz", items: [{ image: "/uploads/questions/q.png" }] }] }],
    ...extra,
  };
}

async function setup(courses = [course()]) {
  const env = { DB: memoryD1(), UPLOADS: memoryR2(), ORIGIN: "" };
  await env.UPLOADS.put("uploads/courses/a.png", PNG);
  await env.UPLOADS.put("uploads/questions/q.png", PNG);
  await putDoc(env, "teacher-courses", { courses });
  const token = await developerToken(handleStoreApi, env);
  return { env, call: api(handleStoreApi, env, token) };
}

// Another teacher, accepted by a stubbed CMS class check.
function otherTeacher(env) {
  const call = api(handleStoreApi, env, "other-token");
  return (path, init = {}) => call(path, { ...init, headers: { ...(init.headers || {}), "x-teacher-id": "900" } });
}

async function withCms(run) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/teachers/900/classes")) return Response.json({ ok: true });
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("publishing snapshots the course files and marks the course shared", async () => {
  const { env, call } = await setup();
  const response = await call("/api/cms/courses/-2/community/publish", {
    method: "POST",
    json: { authorName: "Alex", featured: true },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.listing.id, 1);
  assert.equal(body.listing.featured, true);
  assert.equal(body.course.communityListingId, 1);

  const [listing] = (await getDoc(env, "community-courses")).listings;
  assert.match(listing.banner, /^\/uploads\/community\/1\/\d+-\w+\.png$/);
  assert.match(listing.sections[0].exercises[0].items[0].image, /^\/uploads\/community\/1\//);
  assert.deepEqual(env.UPLOADS.objects.get(listing.banner.slice(1)).bytes, PNG);
  assert.equal((await getDoc(env, "teacher-courses")).courses[0].communityListingId, 1);

  const list = await (await call("/api/cms/community/courses")).json();
  assert.equal(list.courses.length, 1);
  assert.equal(list.courses[0].isOwner, true);
  const detail = await (await call("/api/cms/community/courses/1")).json();
  assert.deepEqual(detail.course.sections, [{ title: "Farm", exerciseCount: 1, types: ["mcquiz"] }]);
});

test("a course with no exercises cannot be shared", async () => {
  const { call } = await setup([course({ sections: [] })]);
  const response = await call("/api/cms/courses/-2/community/publish", { method: "POST", json: {} });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Add at least one exercise before sharing to Community.");
});

test("another teacher copies a listing once, with their own files", async () => {
  const { env, call } = await setup();
  await call("/api/cms/courses/-2/community/publish", { method: "POST", json: {} });
  await withCms(async () => {
    const other = otherTeacher(env);
    const first = await (await other("/api/cms/community/courses/1/copy", { method: "POST", json: {} })).json();
    assert.equal(first.alreadyCopied, false);
    assert.equal(first.course.sourceCommunityId, 1);
    const again = await (await other("/api/cms/community/courses/1/copy", { method: "POST", json: {} })).json();
    assert.equal(again.alreadyCopied, true);
    assert.equal(again.course.id, first.course.id);

    const copy = (await getDoc(env, "teacher-courses")).courses.find((item) => item.id === first.course.id);
    assert.equal(copy.teacherId, 900);
    // Listing files sit under community/<id>/, so copies land in questions/,
    // as lib/community-store.js destCategoryFromUrl does.
    assert.match(copy.banner, /^\/uploads\/questions\/\d+-\w+\.png$/);
    assert.match(copy.sections[0].exercises[0].items[0].image, /^\/uploads\/questions\//);
    assert.equal((await getDoc(env, "community-courses")).listings[0].copyCount, 1);

    const list = await (await other("/api/cms/community/courses")).json();
    assert.equal(list.courses[0].alreadyCopied, true);
  });
});

test("reports hide a listing at three, and owners cannot report", async () => {
  const { env, call } = await setup();
  await call("/api/cms/courses/-2/community/publish", { method: "POST", json: {} });
  const own = await call("/api/cms/community/courses/1/report", { method: "POST", json: { reason: "x" } });
  assert.equal((await own.json()).message, "You cannot report your own listing.");

  const store = await getDoc(env, "community-courses");
  store.listings[0].reports = [{ teacherId: 1 }, { teacherId: 2 }];
  await putDoc(env, "community-courses", store);
  await withCms(async () => {
    const result = await (await otherTeacher(env)("/api/cms/community/courses/1/report", { method: "POST", json: { reason: "spam" } })).json();
    assert.deepEqual(result, { ok: true, hidden: true });
  });
  assert.equal((await (await call("/api/cms/community/courses")).json()).courses.length, 0);
});

test("unsharing clears the course link and hides the listing", async () => {
  const { env, call } = await setup();
  await call("/api/cms/courses/-2/community/publish", { method: "POST", json: {} });
  const response = await call("/api/cms/courses/-2/community/unpublish", { method: "POST", json: {} });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.course.communityListingId, null);
  assert.equal((await getDoc(env, "community-courses")).listings[0].status, "unpublished");
  const feature = await call("/api/cms/community/courses/1/feature", { method: "POST", json: {} });
  assert.equal((await feature.json()).message, "Share the course to Community before featuring it.");
});
