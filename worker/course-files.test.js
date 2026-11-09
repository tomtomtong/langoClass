import assert from "node:assert/strict";
import test from "node:test";
import { copyUpload, courseUrls, rewriteCourseUrls } from "./course-files.js";

const course = {
  banner: "/uploads/courses/b.png",
  sections: [
    {
      banner: "",
      exercises: [
        {
          type: "slides",
          items: [{ title: "Hi", bullets: ["a"], image: "/uploads/material/m.png", audioUrl: "/uploads/slides/s1.mp3" }],
        },
        { type: "video", items: [{ videoUrl: "/uploads/videos/v.mp4" }] },
      ],
    },
  ],
};

test("a slide's voice clip is part of the course's files, so export and copy carry it", () => {
  const urls = courseUrls(course);
  assert.ok(urls.includes("/uploads/slides/s1.mp3"));
  assert.ok(urls.includes("/uploads/material/m.png"));
  assert.ok(urls.includes("/uploads/videos/v.mp4"));
});

test("rewriting a course's URLs also rewrites the voice clip", () => {
  const copy = rewriteCourseUrls(course, (url) => (url ? `/copied${url}` : url));
  assert.equal(copy.sections[0].exercises[0].items[0].audioUrl, "/copied/uploads/slides/s1.mp3");
  assert.equal(copy.sections[0].exercises[0].items[0].image, "/copied/uploads/material/m.png");
  assert.equal(course.sections[0].exercises[0].items[0].audioUrl, "/uploads/slides/s1.mp3", "the original is untouched");
});

test("copying a course keeps a lecture.json URL as it is", async () => {
  const url = "/uploads/lectures/lango-cambridge-s8-u1-1/lecture.json?v=1";
  const env = { UPLOADS: { get: async () => assert.fail("a lecture is not read"), put: async () => assert.fail("a lecture is not copied") } };
  assert.equal(await copyUpload(env, url, "questions"), url);
});

test("copyUpload keeps the extension of an image whose URL has a query", async () => {
  const puts = [];
  const env = {
    UPLOADS: {
      get: async () => ({ body: new Uint8Array([1]), size: 1, httpMetadata: { contentType: "image/png" } }),
      put: async (key) => puts.push(key),
    },
  };
  const copy = await copyUpload(env, "/uploads/questions/q.png?v=2", "questions");
  assert.match(copy, /^\/uploads\/questions\/\d+-\w+\.png$/);
  assert.equal(puts.length, 1);
});
