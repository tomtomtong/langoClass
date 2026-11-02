// System Logs (/api/logs*): structured app log rows in the D1 app_logs table
// (migration 0001) and the admin login that guards them. Each row's body is the
// entry lib/log-store.js wrote on Node, so imported Node logs show alongside.
import { json, readJson } from "./d1-store.js";

const MAX_ENTRIES = 8000;
const TRIM_EVERY = 100;
const CATEGORIES = ["login", "school", "class", "ai", "student", "presence", "server"];
// The Node defaults (server.js); Worker secrets LOG_ADMIN_USERNAME and
// LOG_ADMIN_PASSWORD replace them.
const ADMIN_USERNAME = "langoclass-admin";
const ADMIN_PASSWORD = "langoclasspassword123";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

let writesSinceTrim = 0;

// Never throws: a missing table or a D1 hiccup only goes to the Worker log.
export async function writeLog(env, input = {}) {
  const entry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    category: category(input.category),
    action: String(input.action || "event").slice(0, 120),
    level: String(input.level || "info").slice(0, 20),
    message: String(input.message || "").slice(0, 2000),
    source: String(input.source || "worker").slice(0, 80),
    meta: safeMeta(input.meta),
  };
  console.log(JSON.stringify({ message: "app_log", ...entry }));
  if (!env?.DB) return entry;
  try {
    await env.DB.prepare(
      "INSERT INTO app_logs (id, created_at, category, level, body) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(entry.id, entry.ts, entry.category, entry.level, JSON.stringify(entry))
      .run();
    writesSinceTrim += 1;
    if (writesSinceTrim >= TRIM_EVERY) {
      writesSinceTrim = 0;
      await env.DB.prepare(
        "DELETE FROM app_logs WHERE created_at < (SELECT created_at FROM app_logs ORDER BY created_at DESC LIMIT 1 OFFSET ?)"
      )
        .bind(MAX_ENTRIES - 1)
        .run();
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "app_log_failed", error: error instanceof Error ? error.message : String(error) }));
  }
  return entry;
}

export async function handleLogsApi(request, env, url) {
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "/api/logs" && !pathname.startsWith("/api/logs/")) return null;
  if (!env.DB) return null;
  const method = request.method.toUpperCase();

  if (method === "POST" && pathname === "/api/logs/login") return login(request, env);
  if (method === "POST" && pathname === "/api/logs/logout") {
    if (await adminSession(request, env)) {
      await writeLog(env, { category: "login", action: "admin_logout", message: "Admin signed out of System Logs", meta: { username: adminUsername(env) } });
    }
    return json({ ok: true });
  }

  const routes = {
    "GET /api/logs/categories": async () => json({ categories: [...CATEGORIES] }),
    "GET /api/logs/stats": () => stats(env),
    "GET /api/logs": () => query(env, url.searchParams),
    // Cursor debug files lived on the Node server's disk; the Worker has none.
    "GET /api/logs/debug-files": async () => json({ files: [] }),
    "DELETE /api/logs": async () => {
      await env.DB.prepare("DELETE FROM app_logs").run();
      await writeLog(env, { category: "server", action: "logs_cleared", message: "Admin cleared structured app logs", meta: { username: adminUsername(env) } });
      return json({ ok: true });
    },
  };
  const route = routes[`${method} ${pathname}`];
  if (!route) return null;
  if (!(await adminSession(request, env))) {
    return json({ message: "Invalid or expired admin session." }, 401);
  }
  try {
    return await route();
  } catch (error) {
    if (!/no such table/i.test(error instanceof Error ? error.message : String(error))) throw error;
    // Until migration 0001 runs there are no logs to show.
    return pathname === "/api/logs/stats" ? json(emptyStats()) : json({ total: 0, limit: 200, offset: 0, entries: [] });
  }
}

async function login(request, env) {
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    await writeLog(env, { category: "login", action: "admin_login_rejected", message: "Missing admin credentials", level: "warn" });
    return json({ message: "Username and password are required." }, 400);
  }
  const userOk = await sameText(username, adminUsername(env));
  const passOk = await sameText(password, adminPassword(env));
  if (!userOk || !passOk) {
    await writeLog(env, { category: "login", action: "admin_login_failed", message: "Admin log login failed", level: "warn", meta: { username } });
    return json({ message: "Invalid username or password." }, 401);
  }
  const expires = Date.now() + TOKEN_TTL_MS;
  const token = `${expires}.${await sign(env, String(expires))}`;
  await writeLog(env, { category: "login", action: "admin_login_ok", message: "Admin signed into System Logs", meta: { username: adminUsername(env) } });
  return json({ ok: true, token, username: adminUsername(env), expiresInMs: TOKEN_TTL_MS });
}

// Tokens are signed with the admin password, so changing it signs everyone out.
async function adminSession(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) <= Date.now()) return false;
  return sameText(signature, await sign(env, expires));
}

async function query(env, params) {
  const where = [];
  const binds = [];
  const cat = params.get("category");
  if (cat) {
    where.push("category = ?");
    binds.push(category(cat));
  }
  const level = String(params.get("level") || "").trim().toLowerCase();
  if (level) {
    where.push("lower(coalesce(level, 'info')) = ?");
    binds.push(level);
  }
  for (const [name, op] of [["since", ">="], ["until", "<="]]) {
    const time = Date.parse(params.get(name) || "");
    if (Number.isFinite(time)) {
      where.push(`created_at ${op} ?`);
      binds.push(new Date(time).toISOString());
    }
  }
  const needle = String(params.get("q") || "").trim().toLowerCase();
  if (needle) {
    where.push("instr(lower(coalesce(json_extract(body, '$.action'), '') || ' ' || coalesce(json_extract(body, '$.message'), '') || ' ' || coalesce(json_extract(body, '$.meta'), '')), ?) > 0");
    binds.push(needle);
  }
  const limit = Math.min(1000, Math.max(1, Number(params.get("limit")) || 200));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await env.DB.prepare(`SELECT count(*) AS n FROM app_logs ${clause}`).bind(...binds).first();
  const { results } = await env.DB.prepare(
    `SELECT body FROM app_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();
  return json({ total: Number(total?.n) || 0, limit, offset, entries: (results || []).map(row) });
}

async function stats(env) {
  const { results: categories } = await env.DB.prepare("SELECT category, count(*) AS n FROM app_logs GROUP BY category").all();
  const { results: levels } = await env.DB.prepare("SELECT coalesce(level, 'info') AS level, count(*) AS n FROM app_logs GROUP BY 1").all();
  const range = await env.DB.prepare("SELECT count(*) AS n, min(created_at) AS oldest, max(created_at) AS newest FROM app_logs").first();
  const result = emptyStats();
  for (const entry of categories || []) result.byCategory[entry.category] = Number(entry.n) || 0;
  for (const entry of levels || []) result.byLevel[entry.level || "info"] = Number(entry.n) || 0;
  result.total = Number(range?.n) || 0;
  result.oldest = range?.oldest || null;
  result.newest = range?.newest || null;
  return json(result);
}

function emptyStats() {
  return { total: 0, byCategory: Object.fromEntries(CATEGORIES.map((name) => [name, 0])), byLevel: {}, oldest: null, newest: null };
}

function row({ body }) {
  try {
    return JSON.parse(body);
  } catch {
    return { message: "Unreadable log entry", meta: {} };
  }
}

function category(value) {
  const text = String(value || "server").trim().toLowerCase();
  return CATEGORIES.includes(text) ? text : "server";
}

function safeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch {
    return { note: "meta_not_serializable" };
  }
}

function adminUsername(env) {
  return String(env?.LOG_ADMIN_USERNAME || "").trim() || ADMIN_USERNAME;
}

function adminPassword(env) {
  return String(env?.LOG_ADMIN_PASSWORD || "") || ADMIN_PASSWORD;
}

async function sign(env, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${adminUsername(env)}\n${adminPassword(env)}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Compares digests so the time taken does not depend on where the texts differ.
async function sameText(a, b) {
  const digest = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}
