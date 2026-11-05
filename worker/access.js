// Cloudflare Access in front of the admin pages (System Logs, Config). Access
// itself blocks at the edge; this checks the Cf-Access-Jwt-Assertion it adds, so
// a request that reaches the Worker some other way is still refused.
// Enforced only when ACCESS_TEAM_DOMAIN and ACCESS_AUD are set.
const PROTECTED = [/^\/log\.html$/, /^\/config\.html$/, /^\/api\/logs(\/|$)/, /^\/api\/config(\/|$)/];
const KEY_TTL_MS = 60 * 60 * 1000;

let keyCache = { domain: "", expires: 0, keys: new Map() };

export function accessProtected(pathname) {
  return PROTECTED.some((pattern) => pattern.test(pathname));
}

// Returns a 403 Response when a protected path lacks a valid Access token, else null.
export async function accessGate(request, env, url, fetcher = fetch) {
  const domain = teamDomain(env);
  const aud = String(env?.ACCESS_AUD || "").trim();
  if (!domain || !aud || !accessProtected(url.pathname)) return null;
  const token = request.headers.get("cf-access-jwt-assertion") || "";
  const claims = await verifyAccessJwt(token, { domain, aud, fetcher });
  if (claims) return null;
  return new Response("Forbidden: sign in through Cloudflare Access.", { status: 403 });
}

export async function verifyAccessJwt(token, { domain, aud, fetcher = fetch, now = Date.now() }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = JSON.parse(decodeText(parts[0]));
    claims = JSON.parse(decodeText(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) return null;
  if (claims.iss !== `https://${domain}`) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf * 1000 > now + 60_000) return null;

  const key = await signingKey(domain, header.kid, fetcher);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  return ok ? claims : null;
}

async function signingKey(domain, kid, fetcher) {
  if (keyCache.domain !== domain || keyCache.expires <= Date.now() || !keyCache.keys.has(kid)) {
    try {
      const res = await fetcher(`https://${domain}/cdn-cgi/access/certs`);
      const { keys = [] } = await res.json();
      const imported = new Map();
      for (const jwk of keys) {
        if (!jwk.kid) continue;
        imported.set(
          jwk.kid,
          await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
        );
      }
      keyCache = { domain, expires: Date.now() + KEY_TTL_MS, keys: imported };
    } catch (error) {
      console.error(JSON.stringify({ message: "access_certs_failed", error: String(error?.message || error) }));
      return null;
    }
  }
  return keyCache.keys.get(kid) || null;
}

function teamDomain(env) {
  return String(env?.ACCESS_TEAM_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function decodeBytes(segment) {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function decodeText(segment) {
  return new TextDecoder().decode(decodeBytes(segment));
}

export function resetAccessKeys() {
  keyCache = { domain: "", expires: 0, keys: new Map() };
}
