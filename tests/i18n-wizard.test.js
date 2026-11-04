const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SECTION_KINDS } = require("../lib/course-plan");

require("../public/i18n.js");
require("../public/i18n-cms.js");
require("../public/i18n-wizard.js");

const i18n = globalThis.LangoI18n;
const root = path.join(__dirname, "..", "public");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const cmsJs = read("cms.js");
const cmsHtml = read("cms.html");
const wizardSource = read("i18n-wizard.js");

function table(locale) {
  i18n.setLocale(locale, { persist: false, apply: false });
  return (key) => {
    const value = i18n.t(key);
    return value === key ? null : value;
  };
}

// The keys declared in i18n-wizard.js, per locale, read from the source.
function declaredKeys(blockName) {
  const start = wizardSource.indexOf(`const ${blockName} = {`);
  const end = wizardSource.indexOf("\n  };", start);
  const block = wizardSource.slice(start, end);
  return [...block.matchAll(/^\s*"([\w.]+)":\s*"((?:[^"\\]|\\.)*)",?$/gm)].map((m) => ({ key: m[1], text: m[2] }));
}

test("every wizard string exists in both English and Traditional Chinese with the same placeholders", () => {
  const en = declaredKeys("EN");
  const zh = declaredKeys("ZH_TW");
  assert.ok(en.length > 100, "expected the English table to be parsed");
  assert.deepEqual(
    en.map((e) => e.key).sort(),
    zh.map((e) => e.key).sort(),
    "English and zh-TW must declare exactly the same keys"
  );
  const zhByKey = new Map(zh.map((e) => [e.key, e.text]));
  const holes = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const { key, text } of en) {
    assert.equal(holes(zhByKey.get(key)), holes(text), `placeholders differ for ${key}`);
    assert.notEqual(zhByKey.get(key).trim(), "", `empty zh-TW text for ${key}`);
  }
});

test("every wiz.* key the CMS references resolves in both languages", () => {
  const used = new Set();
  for (const source of [cmsJs, cmsHtml]) {
    for (const m of source.matchAll(/["'`](wiz\.[\w]+(?:\.[\w]+)*)["'`]/g)) used.add(m[1]);
  }
  for (const m of cmsJs.matchAll(/\bphase\(\s*[\d.]+,\s*"([\w.]+)"\)/g)) {
    used.add(`wiz.extract.${m[1]}`);
    used.add(`wiz.extract.${m[1]}Detail`);
  }
  for (const kind of SECTION_KINDS) used.add(`wiz.kind.${kind}`);
  for (const code of ["empty", "short", "long"]) used.add(`wiz.warn.${code}`);
  for (const level of ["easy", "medium", "hard"]) used.add(`wiz.diff.${level}`);

  for (const locale of ["en", "zh-TW"]) {
    const lookup = table(locale);
    const missing = [...used].filter((key) => lookup(key) === null);
    assert.deepEqual(missing, [], `missing in ${locale}`);
  }
});

test("zh-TW wizard text has no leftover English sentences", () => {
  const zh = declaredKeys("ZH_TW");
  const english = zh.filter(({ text }) => /[A-Za-z]{4,}/.test(text.replace(/\{\w+\}/g, "")));
  // Product and file names are allowed to stay in Latin letters.
  const allowed = /PDF|Lango|AI|YouTube/g;
  const offenders = english.filter(({ text }) => /[A-Za-z]{4,}/.test(text.replace(allowed, "").replace(/\{\w+\}/g, "")));
  assert.deepEqual(offenders.map((o) => o.key), []);
});

test("the Auto step labels show up in Chinese for the course wizard", () => {
  const lookup = table("zh-TW");
  assert.equal(lookup("wiz.step.material"), "教材");
  assert.equal(lookup("wiz.step.outline"), "大綱");
  assert.equal(lookup("wiz.step.check"), "檢查");
  assert.equal(lookup("wiz.step.finish"), "儲存");
});

test("nothing in the wizard falls back to English in zh-TW", () => {
  const start = cmsHtml.indexOf('id="cms-ai-wizard"');
  const end = cmsHtml.indexOf('id="btn-save-exercises"');
  const keys = new Set(
    [...cmsHtml.slice(start, end).matchAll(/data-i18n(?:-placeholder)?="([\w.]+)"/g)].map((m) => m[1])
  );
  for (const m of cmsJs.matchAll(/cmsT\("((?:cms\.ai|cms\.type|cms\.batch)\.[\w.]+)"/g)) keys.add(m[1]);

  const english = {};
  const en = table("en");
  for (const key of keys) english[key] = en(key);
  const zh = table("zh-TW");
  const leftovers = [...keys].filter(
    (key) => zh(key) === english[key] && /[A-Za-z]{4,}/.test(english[key] || "")
  );
  assert.deepEqual(leftovers, [], "these keys have no zh-TW text");
});
