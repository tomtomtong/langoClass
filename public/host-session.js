/** Host waiting room — live updates via Socket.IO. */
let hostSessionSocket = null;
let hostSessionRoomId = null;

function currentHostUiLocale() {
  return window.LangoI18n?.getLocale?.() || "en";
}

function emitHostSessionJoin(socket, roomId, { resolve, reject } = {}) {
  socket.emit("host_session", { roomId, uiLocale: currentHostUiLocale() }, (res) => {
    if (!res?.ok) {
      reject?.(new Error(res?.error || "Could not connect to waiting room."));
      return;
    }
    if (typeof renderParticipants === "function") {
      renderParticipants(res.participants || [], { announceJoins: false });
    }
    resolve?.(res);
  });
}

function syncHostSessionLocale(locale = currentHostUiLocale()) {
  if (!hostSessionSocket || !hostSessionRoomId) return;
  const run = () => {
    hostSessionSocket.emit(
      "set_session_locale",
      { roomId: hostSessionRoomId, uiLocale: locale },
      () => {}
    );
  };
  if (hostSessionSocket.connected) run();
  else hostSessionSocket.once("connect", run);
}

function getHostSessionSocket() {
  if (!hostSessionSocket) {
    hostSessionSocket = io({ transports: ["websocket", "polling"] });
    hostSessionSocket.on("session_lobby_update", (data) => {
      if (typeof renderParticipants === "function") {
        renderParticipants(data.participants || [], { announceJoins: true });
      }
    });
    hostSessionSocket.on("session_ended", ({ reason }) => {
      $("#waiting-error").textContent = reason || "Session ended.";
    });
    hostSessionSocket.io.on("reconnect", () => {
      if (!hostSessionRoomId) return;
      emitHostSessionJoin(hostSessionSocket, hostSessionRoomId);
    });
  }
  return hostSessionSocket;
}

function connectHostSession(roomId) {
  hostSessionRoomId = normalizePin(roomId) || String(roomId || "").trim();
  const socket = getHostSessionSocket();

  return new Promise((resolve, reject) => {
    const attach = () => {
      emitHostSessionJoin(socket, hostSessionRoomId, { resolve, reject });
    };

    if (socket.connected) attach();
    else {
      socket.once("connect", attach);
      socket.once("connect_error", () =>
        reject(new Error("Could not connect to class server."))
      );
    }
  });
}

function startSessionViaSocket(roomId) {
  const socket = getHostSessionSocket();

  return new Promise((resolve, reject) => {
    const run = () => {
      socket.emit("start_session", { roomId }, (res) => {
        if (!res?.ok) reject(new Error(res?.error || "Could not start class."));
        else resolve(res);
      });
    };

    if (socket.connected) run();
    else socket.once("connect", run);
  });
}

function selectSessionExerciseViaSocket(roomId, exercise, course) {
  const socket = getHostSessionSocket();

  return new Promise((resolve, reject) => {
    const run = () => {
      socket.emit("select_session_exercise", { roomId, exercise, course }, (res) => {
        if (!res?.ok) reject(new Error(res?.error || "Could not select exercise."));
        else resolve(res);
      });
    };

    if (socket.connected) run();
    else socket.once("connect", run);
  });
}

function startNextExerciseViaSocket(roomId, exercise, course) {
  const socket = getHostSessionSocket();

  return new Promise((resolve, reject) => {
    const run = () => {
      socket.emit("start_next_exercise", { roomId, exercise, course }, (res) => {
        if (!res?.ok) reject(new Error(res?.error || "Could not start next exercise."));
        else resolve(res);
      });
    };

    if (socket.connected) run();
    else socket.once("connect", run);
  });
}

function disconnectHostSession() {
  hostSessionRoomId = null;
  if (hostSessionSocket) {
    hostSessionSocket.disconnect();
    hostSessionSocket = null;
  }
}
