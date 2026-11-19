// The autoclass page (public/autoclass*.{html,js,css} and its cues in public/autoclass/) is an
// internal test. wrangler.jsonc sends those paths here first, and they are served only while
// the Worker has AUTOCLASS=1; without it they are a plain 404 and nothing else changes.
// Turn it on with `wrangler dev --var AUTOCLASS:1`, or add "AUTOCLASS": "1" to the vars.

export function isAutoclassPath(pathname) {
  return /^\/autoclass(?:[.-][^/]*|\/.*)$/.test(String(pathname || ""));
}

export function autoclassEnabled(env) {
  return /^(1|true|yes|on)$/i.test(String(env?.AUTOCLASS ?? "").trim());
}

export async function serveAutoclassPage(request, env, pathname) {
  if (!isAutoclassPath(pathname)) return null;
  if (!autoclassEnabled(env) || !env.ASSETS) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return env.ASSETS.fetch(request);
}
