const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildBuzzinAnswerAnnouncement } = require("../lib/buzzin-announcement");

test("Cantonese announcement is Cantonese", () => {
  const t = buildBuzzinAnswerAnnouncement("AI係咩？", "Tom", "yue");
  assert.match(t, /到你喇/);
  assert.match(t, /Tom/);
  assert.match(t, /AI係咩？/);
});

test("Mandarin announcement is Mandarin", () => {
  assert.match(buildBuzzinAnswerAnnouncement("什么是AI？", "Tom", "zh-CN"), /轮到你啦/);
});

test("English and unknown languages fall back to English", () => {
  assert.match(buildBuzzinAnswerAnnouncement("Q?", "Tom", "en"), /you're up/);
  assert.match(buildBuzzinAnswerAnnouncement("Q?", "Tom", "ja"), /you're up/);
  assert.match(buildBuzzinAnswerAnnouncement("", "", undefined), /your question.*Student, you're up/);
});
