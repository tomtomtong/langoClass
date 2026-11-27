import { matchApiRoute } from "./api-routes.js";
import { handleStoreApi } from "./d1-api.js";
import { handleLogsApi } from "./app-logs.js";
import { handleConfigApi, withSettings } from "./app-settings.js";
import { handleRoomApi } from "./room-api.js";
import { handleJoinLinks } from "./join-links.js";
import { serveUpload, uploadKey } from "./uploads.js";
import { serveAutoclassPage } from "./autoclass-page.js";
import { handleMaterialApi } from "./material.js";
import { handleModelRequest } from "./models.js";
import { handleVideoRequest } from "./video.js";
import { handleAutoclassApi } from "./autoclass-api.js";
import { cleanAllRenders } from "./autoclass-cleanup.js";
import { handleTurnstileConfig, turnstileGate } from "./turnstile.js";
import { logRuntime, noteHost, observeApi } from "./lango-log.js";

export { RoomDurableObject } from "./room.js";
export { GroupDurableObject } from "./group.js";
export { MediaContainer } from "./media-container.js";
export { VideoContainer } from "./video-container.js";
export { AutoclassContainer } from "./autoclass-container.js";

const PAGE_REDIRECTS = new Map([
  ["/", "/host.html"],
  // The old elderly join page: one join page now takes the room's look. Keeps ?room= etc.
  ["/hk/join.html", "/join.html"],
  // The old elderly host page: elderly mode is now a host setting; ?theme=elderly turns it on.
  ["/hk", "/host.html"],
  ["/hk/", "/host.html"],
  ["/hk/host.html", "/host.html"],
]);
const ELDERLY_HOST_PATHS = new Set(["/hk", "/hk/", "/hk/host.html"]);

const app = {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    if (request.method === "GET" || request.method === "HEAD") {
      const asked = incoming.pathname;
      const destination = PAGE_REDIRECTS.get(asked);
      if (destination) {
        incoming.pathname = destination;
        if (ELDERLY_HOST_PATHS.has(asked)) incoming.searchParams.set("theme", "elderly");
        return Response.redirect(incoming.toString(), 302);
      }
    }

    const autoclass = await serveAutoclassPage(request, env, incoming.pathname);
    if (autoclass) return autoclass;

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

    try {
      const autoclass = await handleAutoclassApi(request, env, incoming);
      if (autoclass) return autoclass;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "autoclass_request_failed",
          path: incoming.pathname,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return Response.json({ message: "Autoclass backend unavailable." }, { status: 502 });
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

  // Cron triggers (wrangler.jsonc "triggers"). Hourly: remove autoclass renders nobody plays.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      cleanAllRenders(env)
        .then((summary) => console.log(JSON.stringify({ message: "autoclass_clean_run", ...summary })))
        .catch((error) => logRuntime(env, ctx, "autoclass_clean_failed", error))
    );
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
