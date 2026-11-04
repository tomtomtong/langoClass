import assert from "node:assert/strict";
import test from "node:test";
import { courseUrls, rewriteCourseUrls } from "./course-files.js";

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
