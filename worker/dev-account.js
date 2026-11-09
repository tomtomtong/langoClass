// A built-in teacher (id 835) with placeholder classes, for local work and tests only.
// It is off unless the Worker is started with DEV_LOGIN=1 (for example in .dev.vars),
// so a deployed site never accepts it and the login page is never prefilled with it.
const DEV_USERNAME = "lango-developer-alex";
const DEV_PASSWORD = "lango123";
const DEV_TEACHER_ID = 835;
const TOKEN_PAYLOAD = "langoclass-dev-835";

const DEV_USER = {
  id: DEV_TEACHER_ID,
  username: DEV_USERNAME,
  firstName: "ALEX",
  lastName: "Kyaw",
  school_id: null,
  schoolId: null,
  schoolName: null,
};

// The dev teacher has no school_id, so host.js cannot fetch /api/lango/classStudents
// and falls back to the class's own studentList. Ship placeholder rosters here.
const DEV_CLASSES = [
  devClass(62, "5A", 7),
  devClass(579, "5B", 2),
  devClass(195, "5C", 24),
  devClass(2913, "5D", 13),
];

function devClass(id, name, studentCount) {
  const studentList = Array.from({ length: studentCount }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: id * 1000 + index + 1,
      studentCode: `${name}-${number}`,
      firstName: "Student",
      lastName: number,
      fullName: `${name} Student ${number}`,
    };
  });
  return { id, name, studentCount, level: null, studentList };
}

export function devLoginEnabled(env) {
  return /^(1|true|yes|on)$/i.test(String(env?.DEV_LOGIN ?? "").trim());
}

export async function developerLogin(request, env) {
  if (!devLoginEnabled(env)) return null;
  let body = {};
  try {
    body = (await request.clone().json()) || {};
  } catch {
    return null;
  }
  const login = String(body.login || body.username || body.email || "")
    .trim()
    .toLowerCase();
  if (login !== DEV_USERNAME || !sameSecret(String(body.password || ""), DEV_PASSWORD)) {
    return null;
  }
  const token = await developerToken();
  const user = { ...DEV_USER, token };
  return Response.json({ ok: true, token, user });
}

export async function developerClassList(request, env) {
  if (!devLoginEnabled(env) || !(await isDeveloperRequest(request))) return null;
  return Response.json({
    ok: true,
    teacher: { id: DEV_TEACHER_ID, username: DEV_USERNAME },
    classList: DEV_CLASSES,
  });
}

export async function developerAuth(request, env) {
  if (!devLoginEnabled(env) || !(await isDeveloperRequest(request))) return null;
  const raw = request.headers.get("x-teacher-id");
  if (raw != null && String(raw).trim() && String(raw).trim() !== String(DEV_TEACHER_ID)) {
    return null;
  }
  return { token: bearerToken(request), teacherId: DEV_TEACHER_ID };
}

async function isDeveloperRequest(request) {
  const token = bearerToken(request);
  if (!token) return false;
  return sameSecret(token, await developerToken());
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
}

async function developerToken() {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(DEV_PASSWORD),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(TOKEN_PAYLOAD)
  );
  return `dev.${hex(new Uint8Array(signature))}`;
}

function hex(bytes) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function sameSecret(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
