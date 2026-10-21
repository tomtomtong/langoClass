// Session HTTP still reaches Node so Socket.IO can find the room. The same
// room id is then stored in that room's Durable Object.
export async function handleRoomApi(request, env, url, proxy) {
  if (!env.ROOM) return null;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "POST" && pathname === "/api/session/start") {
    return rememberRoom(request, env, proxy, async (data, body) => {
      const roomId = roomIdOf(data);
      if (!roomId) return false;
      const user = body.user || {};
      const summary = await env.ROOM.getByName(roomId).open({
        roomId,
        teacherId: user.id ?? null,
        classItem: body.class || null,
        course: body.course ? { id: body.course.id, name: body.course.name || body.course.title || "" } : null,
        exercise: body.exercise || null,
        uiLocale: body.uiLocale || "en",
      });
      console.log(JSON.stringify({ message: "room_opened", roomId, teacherId: summary?.teacherId ?? null }));
      return true;
    });
  }

  if (method === "PUT" && pathname === "/api/session/roster") {
    return rememberRoom(request, env, proxy, async (data, body) => {
      const roomId = roomIdOf(body) || roomIdOf(data);
      if (!roomId) return false;
      const result = await env.ROOM.getByName(roomId).syncRoster(body.class || null);
      console.log(JSON.stringify({ message: "room_roster", roomId, ok: !!result?.ok }));
      return !!result?.ok;
    });
  }

  if (method === "POST" && pathname === "/api/session/end") {
    return rememberRoom(request, env, proxy, async (_data, body) => {
      const roomId = roomIdOf(body);
      if (!roomId) return false;
      const result = await env.ROOM.getByName(roomId).close();
      console.log(JSON.stringify({ message: "room_closed", roomId, scoresPending: result?.scoresPending || 0 }));
      return true;
    });
  }

  return null;
}

async function rememberRoom(request, env, proxy, persist) {
  const incoming = request.clone();
  const proxied = await proxy(request);
  if (!proxied.ok) return proxied;

  let data = null;
  let body = {};
  try {
    data = await proxied.clone().json();
  } catch {
    data = null;
  }
  try {
    body = (await incoming.json()) || {};
  } catch {
    body = {};
  }

  try {
    const stored = await persist(data, stripSecrets(body));
    if (!stored) return proxied;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "room_store_failed",
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return proxied;
  }

  const headers = new Headers(proxied.headers);
  headers.set("x-room-store", "durable-object");
  return new Response(proxied.body, {
    status: proxied.status,
    statusText: proxied.statusText,
    headers,
  });
}

function roomIdOf(value) {
  const raw = value?.roomId || value?.sessionId || "";
  const pin = String(raw).replace(/\D/g, "").slice(0, 6);
  return pin.length === 6 ? pin : "";
}

function stripSecrets(body) {
  if (!body || typeof body !== "object") return {};
  const user = body.user && typeof body.user === "object" ? { ...body.user } : body.user;
  if (user && typeof user === "object") delete user.token;
  return { ...body, user };
}
