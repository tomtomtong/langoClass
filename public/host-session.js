/** Host waiting room — live updates via Socket.IO. */
let hostSessionSocket = null;

function getHostSessionSocket() {
  if (!hostSessionSocket) {
    hostSessionSocket = io({ transports: ["websocket", "polling"] });
    hostSessionSocket.on("session_lobby_update", (data) => {
      if (typeof renderParticipants === "function") {
        renderParticipants(data.participants || []);
      }
    });
    hostSessionSocket.on("session_ended", ({ reason }) => {
      $("#waiting-error").textContent = reason || "Session ended.";
    });
  }
  return hostSessionSocket;
}

function connectHostSession(roomId) {
  const socket = getHostSessionSocket();

  return new Promise((resolve, reject) => {
    const attach = () => {
      socket.emit("host_session", { roomId }, (res) => {
        if (!res?.ok) {
          reject(new Error(res?.error || "Could not connect to waiting room."));
          return;
        }
        renderParticipants(res.participants || []);
        resolve(res);
      });
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
  if (hostSessionSocket) {
    hostSessionSocket.disconnect();
    hostSessionSocket = null;
  }
}
