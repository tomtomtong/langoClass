import { matchApiRoute } from "./api-routes.js";
import { handleStoreApi } from "./d1-api.js";
import { handleRoomApi } from "./room-api.js";
import { mirrorStoredUploads, serveUpload, uploadKey } from "./uploads.js";
import { prepareMaterialRequest } from "./material.js";
import { handleModelRequest } from "./models.js";
import { handleVideoRequest } from "./video.js";

export { RoomDurableObject } from "./room.js";
export { MediaContainer } from "./media-container.js";

const PAGE_REDIRECTS = new Map([
  ["/", "/host.html"],
  ["/hk", "/hk/host.html"],
  ["/hk/", "/hk/host.html"],
]);

export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    if (request.method === "GET" || request.method === "HEAD") {
      const destination = PAGE_REDIRECTS.get(incoming.pathname);
      if (destination) {
        incoming.pathname = destination;
        return Response.redirect(incoming.toString(), 302);
      }
    }

    const origin = String(env.ORIGIN || "").replace(/\/$/, "");
    if (!origin) {
      console.error(JSON.stringify({ message: "origin_missing" }));
      return new Response("Origin is not configured", { status: 500 });
    }

    const roomId = roomSocketId(incoming.pathname);
    if (roomId) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      if (!env.ROOM) return new Response("Room store is not configured", { status: 500 });
      return env.ROOM.getByName(roomId).fetch(request);
    }

    try {
      const modeled = await handleModelRequest(request, env, incoming);
      if (modeled) return modeled;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "model_request_failed",
          path: incoming.pathname,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return new Response("Model backend unavailable", { status: 502 });
    }

    try {
      const video = await handleVideoRequest(request, env, incoming);
      if (video) return video;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "video_request_failed",
          path: incoming.pathname,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return new Response("Video backend unavailable", { status: 502 });
    }

    if (uploadKey(incoming.pathname)) {
      try {
        return await serveUpload(request, {
          bucket: env.UPLOADS,
          origin,
          waitUntil: (promise) => ctx.waitUntil(promise),
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "upload_request_failed",
            path: incoming.pathname,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        return new Response("Upload unavailable", { status: 502 });
      }
    }

    if (isApiPath(incoming.pathname)) {
      const route = matchApiRoute(request.method, incoming.pathname);
      if (!route) {
        console.error(
          JSON.stringify({
            message: "api_route_unmatched",
            method: request.method,
            path: incoming.pathname,
          })
        );
      }
      try {
        const stored = await handleStoreApi(request, env, incoming);
        if (stored) return rememberUploads(stored, request, env, origin, ctx);
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "d1_request_failed",
            path: incoming.pathname,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        return new Response("Store unavailable", { status: 502 });
      }
      try {
        const roomed = await handleRoomApi(request, env, incoming);
        if (roomed) return rememberUploads(roomed, request, env, origin, ctx);
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "room_request_failed",
            path: incoming.pathname,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        return new Response("Room unavailable", { status: 502 });
      }
    }

    let outbound = request;
    let mediaRuntime = "";
    if (isApiPath(incoming.pathname)) {
      try {
        const prepared = await prepareMaterialRequest(request, env, incoming);
        if (prepared?.response) return prepared.response;
        if (prepared?.request) outbound = prepared.request;
        mediaRuntime = prepared?.media || "";
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "media_request_failed",
            path: incoming.pathname,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        return new Response("Media unavailable", { status: 502 });
      }
    }

    try {
      const proxied = rememberUploads(await proxyToOrigin(outbound, origin), outbound, env, origin, ctx);
      if (mediaRuntime === "container") {
        const headers = new Headers(proxied.headers);
        headers.set("x-media-runtime", "container");
        return new Response(proxied.body, { status: proxied.status, statusText: proxied.statusText, headers });
      }
      return proxied;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "origin_proxy_failed",
          path: incoming.pathname,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return new Response("Origin unavailable", { status: 502 });
    }
  },
};

function rememberUploads(response, request, env, origin, ctx) {
  if (!env.UPLOADS || !response) return response;
  const method = request.method;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return response;
  ctx.waitUntil(
    mirrorStoredUploads(response, { bucket: env.UPLOADS, origin, method }).catch((error) => {
      console.error(
        JSON.stringify({
          message: "upload_mirror_failed",
          error: error instanceof Error ? error.message : String(error),
        })
      );
    })
  );
  return response;
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function roomSocketId(pathname) {
  const match = pathname.match(/^\/api\/room\/(\d{6})\/ws\/?$/);
  return match ? match[1] : "";
}

async function proxyToOrigin(request, origin) {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const proxied = new Request(target, request);
  proxied.headers.delete("host");
  proxied.headers.set("X-Forwarded-Host", incoming.host);
  proxied.headers.set("X-Forwarded-Proto", incoming.protocol.replace(/:$/, ""));

  const response = await fetch(proxied);
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return response;
  }
  return rewriteOriginRedirect(response, incoming, origin);
}

function rewriteOriginRedirect(response, incoming, origin) {
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("Location");
  if (!location) return response;

  let redirected;
  try {
    redirected = new URL(location, origin);
  } catch {
    return response;
  }
  if (redirected.host !== new URL(origin).host) return response;

  redirected.protocol = incoming.protocol;
  redirected.host = incoming.host;
  const headers = new Headers(response.headers);
  headers.set("Location", redirected.toString());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
