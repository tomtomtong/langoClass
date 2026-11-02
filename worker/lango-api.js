// School login and class rosters from newcms, as server.js /api/lango/* served
// them. The dev account is answered first in d1-api.js; everyone else lands here.
import { normalizeClassListResponse, normalizeStudent } from "./classes.js";
import { writeLog } from "./app-logs.js";
import { json, readJson } from "./d1-store.js";

const CMS_BASE_DEFAULT = "https://newcms.lango.ai";

export async function handleLangoApi(request, env, url) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  if (method === "POST" && pathname === "/api/lango/login") return login(request, env);
  if ((method === "GET" || method === "HEAD") && pathname === "/api/lango/classList") return classList(request, env);
  if ((method === "GET" || method === "HEAD") && pathname === "/api/lango/classStudents") return classStudents(request, env, url);
  return null;
}

async function login(request, env) {
  const input = await readJson(request);
  const login = String(input.login || input.username || input.email || "").trim();
  const password = input.password;
  const schoolId = input.school_id ?? input.schoolId;
  if (!login || !password) {
    await writeLog(env, { category: "login", action: "teacher_login_rejected", message: "Missing username or password", level: "warn", meta: { login } });
    return json({ message: "Username and password are required." }, 400);
  }

  const body = { login, password };
  if (schoolId != null && String(schoolId).trim()) body.school_id = String(schoolId).trim();

  const { ok, status, data } = await cmsRequest(env, "POST", "/api/login", { body });
  if (!ok) {
    await writeLog(env, { category: "login", action: "teacher_login_failed", message: `Teacher login failed: ${login}`, level: "warn", meta: { login, status } });
    return cmsError(status, data, "Login failed");
  }

  const token = data?.token;
  const user = data?.user;
  if (!token || !user?.id) return json({ message: "Login succeeded but token or user id was missing." }, 502);
  await writeLog(env, {
    category: "login",
    action: "teacher_login_ok",
    message: `Teacher signed in: ${login}`,
    meta: { login, user: { id: user.id, schoolId: user.school_id ?? user.schoolId ?? null } },
  });
  return json({
    ok: true,
    token,
    user: { ...user, token, school_id: user.school_id ?? user.schoolId ?? body.school_id ?? null },
  });
}

async function classList(request, env) {
  const token = bearerToken(request);
  if (!token) return json({ message: "Missing auth token." }, 401);
  const teacherId = String(request.headers.get("x-teacher-id") || "").trim();
  if (!teacherId) return json({ message: "Missing teacher id (X-Teacher-Id header)." }, 400);

  const { ok, status, data } = await cmsRequest(env, "GET", `/api/teachers/${encodeURIComponent(teacherId)}/classes`, { token });
  if (!ok) return cmsError(status, data, "Failed to load classes");
  return json({ ...normalizeClassListResponse(data), teacher: data?.teacher || null, _rawClassList: data });
}

async function classStudents(request, env, url) {
  const token = bearerToken(request);
  if (!token) return json({ message: "Missing auth token." }, 401);
  const schoolId = String(url.searchParams.get("schoolId") || url.searchParams.get("school_id") || "").trim();
  const classId = String(url.searchParams.get("classId") || url.searchParams.get("class_id") || "").trim();
  if (!schoolId || !classId) return json({ message: "schoolId and classId query parameters are required." }, 400);

  const query = new URLSearchParams({ sort: "class_no", order: "asc" });
  const path = `/api/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}/students?${query}`;
  const { ok, status, data } = await cmsRequest(env, "GET", path, { token });
  if (!ok) return cmsError(status, data, "Failed to load students");

  const raw = Array.isArray(data?.students) ? data.students : [];
  const students = raw.map(normalizeStudent).filter(Boolean);
  return json({ ok: true, schoolId, classId, total: data?.total ?? students.length, students });
}

async function cmsRequest(env, method, path, { token, body } = {}) {
  const base = String(env.CMS_API_BASE || CMS_BASE_DEFAULT).replace(/\/$/, "");
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text, error: text };
  }
  return { ok: response.ok, status: response.status, data };
}

function cmsError(status, data, fallback) {
  const message = data?.error || data?.message || fallback;
  return json({ message, error: data?.error, ...(data || {}) }, status);
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : header.trim();
}
