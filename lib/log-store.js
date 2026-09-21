const fs = require("fs");
const { randomUUID } = require("crypto");
const paths = require("./paths");

const MAX_ENTRIES = 8000;
const COMPACT_EVERY = 200;

/** @type {Array<object>} */
let entries = [];
let appendCount = 0;
let loaded = false;

const CATEGORIES = [
  "login",
  "school",
  "class",
  "ai",
  "student",
  "presence",
  "server",
];

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  paths.ensurePersistentDirs();
  const file = paths.appLogsFile;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "", "utf8");
    entries = [];
    return;
  }

  try {
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const start = Math.max(0, lines.length - MAX_ENTRIES);
    entries = [];
    for (let i = start; i < lines.length; i += 1) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed && typeof parsed === "object") entries.push(parsed);
      } catch {
        // skip corrupt lines
      }
    }
    if (lines.length > MAX_ENTRIES) persistAll();
  } catch {
    entries = [];
  }
}

function persistAll() {
  paths.ensurePersistentDirs();
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : "");
  fs.writeFileSync(paths.appLogsFile, body, "utf8");
  appendCount = 0;
}

function appendLine(entry) {
  paths.ensurePersistentDirs();
  fs.appendFileSync(paths.appLogsFile, `${JSON.stringify(entry)}\n`, "utf8");
}

function trimEntries() {
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
}

function normalizeCategory(category) {
  const value = String(category || "server").trim().toLowerCase();
  return CATEGORIES.includes(value) ? value : "server";
}

function safeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch {
    return { note: "meta_not_serializable" };
  }
}

/**
 * Append one structured app log entry.
 * @param {{ category?: string, action?: string, message?: string, level?: string, meta?: object, source?: string }} input
 */
function append(input = {}) {
  ensureLoaded();
  const entry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    category: normalizeCategory(input.category),
    action: String(input.action || "event").slice(0, 120),
    level: String(input.level || "info").slice(0, 20),
    message: String(input.message || "").slice(0, 2000),
    source: String(input.source || "server").slice(0, 80),
    meta: safeMeta(input.meta),
  };
  entries.push(entry);
  const overflow = entries.length > MAX_ENTRIES;
  trimEntries();
  try {
    if (overflow || appendCount >= COMPACT_EVERY) {
      persistAll();
    } else {
      appendLine(entry);
      appendCount += 1;
    }
  } catch {
    // ignore persistence failures
  }
  return entry;
}

function query({
  category,
  q,
  level,
  limit = 200,
  offset = 0,
  since,
  until,
} = {}) {
  ensureLoaded();
  const needle = String(q || "").trim().toLowerCase();
  const cat = category ? normalizeCategory(category) : "";
  const lvl = level ? String(level).trim().toLowerCase() : "";
  const sinceMs = since ? Date.parse(since) : NaN;
  const untilMs = until ? Date.parse(until) : NaN;
  const max = Math.min(1000, Math.max(1, Number(limit) || 200));
  const skip = Math.max(0, Number(offset) || 0);

  const filtered = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (cat && entry.category !== cat) continue;
    if (lvl && String(entry.level).toLowerCase() !== lvl) continue;
    if (Number.isFinite(sinceMs)) {
      const t = Date.parse(entry.ts);
      if (!Number.isFinite(t) || t < sinceMs) continue;
    }
    if (Number.isFinite(untilMs)) {
      const t = Date.parse(entry.ts);
      if (!Number.isFinite(t) || t > untilMs) continue;
    }
    if (needle) {
      const hay = `${entry.action} ${entry.message} ${JSON.stringify(entry.meta)}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    filtered.push(entry);
  }

  return {
    total: filtered.length,
    limit: max,
    offset: skip,
    entries: filtered.slice(skip, skip + max),
  };
}

function stats() {
  ensureLoaded();
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const byLevel = {};
  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    const lvl = entry.level || "info";
    byLevel[lvl] = (byLevel[lvl] || 0) + 1;
  }
  return {
    total: entries.length,
    byCategory,
    byLevel,
    oldest: entries[0]?.ts || null,
    newest: entries[entries.length - 1]?.ts || null,
  };
}

function clear() {
  ensureLoaded();
  entries = [];
  persistAll();
  return { ok: true };
}

function listCategories() {
  return [...CATEGORIES];
}

module.exports = {
  CATEGORIES,
  append,
  query,
  stats,
  clear,
  listCategories,
};
