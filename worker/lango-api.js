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
  if (method === "POST" && pathname === "/api/lango/admin/login") return adminLogin(request, env);
  if ((method === "GET" || method === "HEAD") && pathname === "/api/lango/admin/me") return adminMe(request, env);
  if ((method === "GET" || method === "HEAD") && pathname === "/api/lango/admin/directory") return adminDirectory(request, env);
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

// Admin portal (admin.html). Same newcms accounts as teachers, but only a user
// whose newcms role is "admin" gets in; the role comes from newcms, never the browser.
function isAdminUser(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

async function adminLogin(request, env) {
  const input = await readJson(request);
  const login = String(input.login || input.username || input.email || "").trim();
  const password = input.password;
  if (!login || !password) return json({ message: "Username and password are required." }, 400);

  const { ok, status, data } = await cmsRequest(env, "POST", "/api/login", { body: { login, password } });
  if (!ok) {
    await writeLog(env, { category: "login", action: "admin_portal_login_failed", message: `Admin portal login failed: ${login}`, level: "warn", meta: { login, status } });
    return cmsError(status, data, "Login failed");
  }
  const token = data?.token;
  const user = data?.user;
  if (!token || !user?.id) return json({ message: "Login succeeded but token or user id was missing." }, 502);
  if (!isAdminUser(user)) {
    await writeLog(env, { category: "login", action: "admin_portal_login_denied", message: `Not an admin: ${login}`, level: "warn", meta: { login, role: user.role ?? null } });
    return json({ message: "This account is not an admin. Teachers sign in at the Course CMS." }, 403);
  }
  await writeLog(env, { category: "login", action: "admin_portal_login_ok", message: `Admin signed in: ${login}`, meta: { login, user: { id: user.id, schoolId: user.school_id ?? user.schoolId ?? null } } });
  return json({ ok: true, token, user: { ...user, token, school_id: user.school_id ?? user.schoolId ?? null } });
}

// Re-checks the token with newcms on every call, so a demoted admin loses access at once.
export async function requireAdmin(request, env) {
  const token = bearerToken(request);
  if (!token) return { response: json({ message: "Missing auth token." }, 401) };
  const { ok, status, data } = await cmsRequest(env, "GET", "/api/me", { token });
  if (!ok) return { response: cmsError(status === 403 ? 401 : status, data, "Session expired") };
  const user = data?.user || data;
  if (!isAdminUser(user)) return { response: json({ message: "Admin access required." }, 403) };
  return { token, user };
}

async function adminMe(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin.response) return admin.response;
  return json({ ok: true, user: { ...admin.user, school_id: admin.user.school_id ?? admin.user.schoolId ?? null } });
}

// Read-only directory for the admin portal: every school with its teachers and classes.
// Only whitelisted fields leave here; student rosters and passwords are never included.
async function adminDirectory(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin.response) return admin.response;
  const { token } = admin;

  const schoolsRes = await cmsRequest(env, "GET", "/api/schools", { token });
  if (!schoolsRes.ok) return cmsError(schoolsRes.status, schoolsRes.data, "Failed to load schools");
  const rawSchools = Array.isArray(schoolsRes.data?.schools) ? schoolsRes.data.schools : [];

  const schools = await Promise.all(
    rawSchools.map(async (school) => {
      const id = encodeURIComponent(school.id);
      const [teachersRes, classesRes] = await Promise.all([
        cmsRequest(env, "GET", `/api/schools/${id}/teachers`, { token }),
        cmsRequest(env, "GET", `/api/schools/${id}/classes`, { token }),
      ]);
      const teachers = (Array.isArray(teachersRes.data?.teachers) ? teachersRes.data.teachers : []).map((t) => ({
        id: t.id,
        username: t.username ?? null,
        email: t.email ?? null,
        teacherId: t.teacher_id ?? null,
        nameEn: t.name_en ?? null,
        nameZh: t.name_zh ?? null,
        classIds: Array.isArray(t.class_ids) ? t.class_ids : [],
      }));
      const classes = (Array.isArray(classesRes.data?.classes) ? classesRes.data.classes : []).map((c) => ({
        classId: c.class_id,
        studentCount: Number(c.student_count) || 0,
      }));
      return {
        id: school.id,
        name: school.name || school.id,
        teachers,
        classes,
        studentCount: classes.reduce((n, c) => n + c.studentCount, 0),
        partial: !teachersRes.ok || !classesRes.ok,
      };
    }),
  );

  await writeLog(env, {
    category: "server",
    action: "admin_directory_viewed",
    message: `Admin viewed school directory: ${admin.user?.username || admin.user?.id}`,
    meta: { admin: { id: admin.user?.id ?? null }, schools: schools.length },
  });
  return json({ ok: true, schools });
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
