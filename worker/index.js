import { matchApiRoute } from "./api-routes.js";
import { handleStoreApi } from "./d1-api.js";
import { handleLogsApi } from "./app-logs.js";
import { handleConfigApi, withSettings } from "./app-settings.js";
import { handleRoomApi } from "./room-api.js";
import { handleJoinLinks } from "./join-links.js";
import { serveUpload, uploadKey } from "./uploads.js";
import { handleMaterialApi } from "./material.js";
import { handleModelRequest } from "./models.js";
import { handleVideoRequest } from "./video.js";
import { accessGate } from "./access.js";
import { handleTurnstileConfig, turnstileGate } from "./turnstile.js";
import { logRuntime, noteHost, observeApi } from "./lango-log.js";

export { RoomDurableObject } from "./room.js";
export { MediaContainer } from "./media-container.js";
export { VideoContainer } from "./video-container.js";

const ADMIN_PAGES = new Set(["/log.html", "/config.html"]);

const PAGE_REDIRECTS = new Map([
  ["/", "/host.html"],
  ["/hk", "/hk/host.html"],
  ["/hk/", "/hk/host.html"],
]);

const app = {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    const denied = await accessGate(request, env, incoming);
    if (denied) return denied;
    // run_worker_first sends these pages here only so Access can be checked.
    if (ADMIN_PAGES.has(incoming.pathname) && env.ASSETS) return env.ASSETS.fetch(request);
    if (request.method === "GET" || request.method === "HEAD") {
      const destination = PAGE_REDIRECTS.get(incoming.pathname);
      if (destination) {
        incoming.pathname = destination;
        return Response.redirect(incoming.toString(), 302);
      }
    }

    const roomId = roomSocketId(incoming.pathname);
    if (roomId) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      if (!env.ROOM) return new Response("Room store is not configured", { status: 500 });
      return env.ROOM.getByName(roomId).fetch(request);
    }

    if (isApiPath(incoming.pathname)) env = await settledEnv(env);

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
        return await serveUpload(request, { bucket: env.UPLOADS });
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

    if (!isApiPath(incoming.pathname)) return new Response("Not found", { status: 404 });

    const turnstileConfig = handleTurnstileConfig(request, env, incoming);
    if (turnstileConfig) return turnstileConfig;
    const challenged = await turnstileGate(request, env, incoming);
    if (challenged) return challenged;

    const joinLinks = handleJoinLinks(request, env, incoming);
    if (joinLinks) return joinLinks;
    try {
      const admin = (await handleConfigApi(request, env, incoming)) || (await handleLogsApi(request, env, incoming));
      if (admin) return admin;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "admin_request_failed",
          path: incoming.pathname,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return new Response("Store unavailable", { status: 502 });
    }
    try {
      const stored = await handleStoreApi(request, env, incoming);
      if (stored) return stored;
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
      if (roomed) return roomed;
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

    try {
      const material = await handleMaterialApi(request, env, incoming);
      if (material) return material;
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

    return unservedApi(request, incoming);
  },
};

// Reports API failures and host actions to log.lango.ai around the handlers above.
export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    noteHost(incoming.hostname);
    if (!isApiPath(incoming.pathname)) return app.fetch(request, env, ctx);
    const started = Date.now();
    let response;
    try {
      response = await app.fetch(request, env, ctx);
    } catch (error) {
      logRuntime(env, ctx, "unhandled_error", error);
      throw error;
    }
    observeApi(env, ctx, request, incoming.pathname, response.status, Date.now() - started);
    return response;
  },
};

// The Node server (classroom.lango.ai) is retired. Routes it served that the
// Worker does not run yet answer at once instead of waiting on it.
function unservedApi(request, incoming) {
  const route = matchApiRoute(request.method, incoming.pathname);
  console.error(
    JSON.stringify({
      message: route ? "api_route_not_ported" : "api_route_unmatched",
      method: request.method,
      path: incoming.pathname,
    })
  );
  if (!route) return jsonResponse({ message: "Not found." }, 404);
  return jsonResponse({ message: "This feature is not available on class.lango.ai yet." }, 503);
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Settings saved on the Config page; if D1 cannot be read, the Worker's own
// variables still serve the request.
async function settledEnv(env) {
  try {
    return await withSettings(env);
  } catch (error) {
    console.error(
      JSON.stringify({ message: "settings_read_failed", error: error instanceof Error ? error.message : String(error) })
    );
    return env;
  }
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function roomSocketId(pathname) {
  const match = pathname.match(/^\/api\/room\/(\d{6})\/ws\/?$/);
  return match ? match[1] : "";
}
