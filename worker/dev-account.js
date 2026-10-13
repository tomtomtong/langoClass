// School login used to accept this teacher (id 835). newcms.lango.ai no longer
// has the account, so class.lango.ai recognizes the same prefilled login locally.
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

const DEV_CLASSES = [
  { id: 62, name: "5A", studentCount: 7, level: null },
  { id: 579, name: "5B", studentCount: 2, level: null },
  { id: 195, name: "5C", studentCount: 24, level: null },
  { id: 2913, name: "5D", studentCount: 13, level: null },
];

export async function developerLogin(request) {
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

export async function developerClassList(request) {
  if (!(await isDeveloperRequest(request))) return null;
  return Response.json({
    ok: true,
    teacher: { id: DEV_TEACHER_ID, username: DEV_USERNAME },
    classList: DEV_CLASSES,
  });
}

export async function developerAuth(request) {
  if (!(await isDeveloperRequest(request))) return null;
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
