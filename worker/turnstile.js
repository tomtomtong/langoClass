// Cloudflare Turnstile on the routes a bot would hammer: teacher login, System
// Logs login and the student ID join lookup. Pages send the widget token in the
// X-Turnstile-Token header. Until TURNSTILE_SECRET_KEY is set nothing is checked.
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const GUARDED = new Set([
  "POST /api/lango/login",
  "POST /api/lango/admin/login",
  "POST /api/logs/login",
  "GET /api/join/lookup",
]);

export function handleTurnstileConfig(request, env, url) {
  if (request.method.toUpperCase() !== "GET" || url.pathname !== "/api/turnstile") return null;
  return Response.json(
    { siteKey: turnstileEnabled(env) ? String(env.TURNSTILE_SITE_KEY || "") : "" },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}

// Returns a 403 Response when a guarded request has no valid token, else null.
export async function turnstileGate(request, env, url, fetcher = fetch) {
  if (!turnstileEnabled(env)) return null;
  const method = request.method.toUpperCase() === "HEAD" ? "GET" : request.method.toUpperCase();
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!GUARDED.has(`${method} ${pathname}`)) return null;

  const token = String(request.headers.get("x-turnstile-token") || "").trim();
  if (token && (await verifyTurnstile(env, token, request.headers.get("cf-connecting-ip"), fetcher))) {
    return null;
  }
  return Response.json(
    { ok: false, code: "turnstile_failed", message: "Security check failed. Please refresh the page and try again." },
    { status: 403 }
  );
}

export async function verifyTurnstile(env, token, remoteIp, fetcher = fetch) {
  const form = new FormData();
  form.append("secret", String(env.TURNSTILE_SECRET_KEY));
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);
  try {
    const res = await fetcher(SITEVERIFY_URL, { method: "POST", body: form });
    const data = await res.json();
    return data?.success === true;
  } catch (error) {
    console.error(JSON.stringify({ message: "turnstile_verify_failed", error: String(error?.message || error) }));
    return false;
  }
}

function turnstileEnabled(env) {
  return Boolean(env?.TURNSTILE_SECRET_KEY && env?.TURNSTILE_SITE_KEY);
}
