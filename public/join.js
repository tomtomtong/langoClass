const ROOM_STORAGE_KEY = "lango_join_participant";

const urlParams = new URLSearchParams(window.location.search);
const urlRoom = (urlParams.get("room") || urlParams.get("roomId") || "").trim();
const urlPin = urlParams.get("pin");
const urlToken = (
  urlParams.get("token") ||
  urlParams.get("studentId") ||
  urlParams.get("userId") ||
  ""
).trim();
const urlNickname = (
  urlParams.get("nickname") ||
  urlParams.get("username") ||
  urlParams.get("name") ||
  urlParams.get("displayName") ||
  ""
).trim();

function resolveStudentUserId(roomId, stored) {
  if (urlToken) return urlToken;
  if (stored?.roomId === roomId && stored.userId) return stored.userId;
  return undefined;
}

function resolveDisplayName(roomId, stored) {
  if (urlNickname) return urlNickname.slice(0, 40);
  if (stored?.roomId === roomId && stored.displayName) {
    return String(stored.displayName).trim().slice(0, 40);
  }
  return "";
}

function roomJoinUrl({ roomId = "", token = "", name = "" } = {}) {
  const url = new URL("/join.html", window.location.origin);
  if (roomId) url.searchParams.set("room", roomId);
  if (token) url.searchParams.set("token", token);
  if (name) url.searchParams.set("name", name);
  return `${url.pathname}${url.search}`;
}

function loadStoredParticipant() {
  try {
    return JSON.parse(localStorage.getItem(ROOM_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveStoredParticipant(data) {
  localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(data));
}

function clearStoredParticipant() {
  localStorage.removeItem(ROOM_STORAGE_KEY);
}

let roomSessionSocket = null;

function showPlayerPassiveWaiting({
  title = "Exercise complete",
  message = "No action is needed. Please watch the teacher's screen.",
} = {}) {
  $("#room-passive-waiting-title").textContent = title;
  $("#room-passive-waiting-status").textContent = message;
  showScreen("room-passive-waiting");
}

function getRoomSessionSocket() {
  if (!roomSessionSocket) {
    roomSessionSocket = io({ transports: ["websocket", "polling"] });

    roomSessionSocket.on("session_started", ({ exercise }) => {
      if (!roomParticipant) return;
      window.roomFastQuizCompleted = false;
      $("#room-waiting-status").textContent = "Class is starting — get ready!";
      startRoomExercise(
        roomParticipant.roomId,
        roomParticipant.displayName,
        roomParticipant.userId,
        exercise
      );
    });

    roomSessionSocket.on("session_ended", () => {
      location.href = roomJoinUrl({
        roomId: roomParticipant?.roomId || "",
        token: roomParticipant?.userId || urlToken || "",
        name: roomParticipant?.displayName || "",
      });
    });

    roomSessionSocket.on("room_exercise_wrap_up", (payload) => {
      if (!roomParticipant) return;

      if (window.roomFastQuizCompleted) {
        showPlayerPassiveWaiting();
        return;
      }

      const hasScores =
        (payload?.exerciseLeaderboard || []).length > 0 ||
        (payload?.semesterLeaderboard || []).length > 0;

      if (hasScores) {
        showScreen("player-finished");
        showExerciseLeaderboards({
          exerciseLeaderboard: payload.exerciseLeaderboard,
          semesterLeaderboard: payload.semesterLeaderboard,
          highlightId: roomParticipant.userId,
          exerciseListEl: $("#player-final-leaderboard"),
          semesterListEl: $("#player-semester-leaderboard"),
          semesterWrapEl: $("#player-semester-leaderboard-wrap"),
          exerciseWrapEl: $("#player-exercise-leaderboard-wrap"),
        });
        const playBtn = $("#btn-play-again");
        if (playBtn) playBtn.hidden = true;
        return;
      }

      $("#room-waiting-status").textContent =
        "You're in class — your teacher will start the next activity when ready.";
      showScreen("room-waiting");
    });
  }
  return roomSessionSocket;
}

function stopRoomStatusPoll() {
  /* Session status is pushed over Socket.IO — no polling. */
}

function startRoomStatusPoll() {
  /* Session status is pushed over Socket.IO — no polling. */
}

function initRoomJoin() {
  $("#join-panel-quiz").hidden = true;
  $("#join-panel-room").hidden = false;

  const stored = loadStoredParticipant();
  const activeRoom = normalizePin(urlRoom || stored?.roomId || "");
  if (stored?.roomId && (urlRoom === stored.roomId || !urlRoom)) {
    roomParticipant = stored;
    if (urlToken) roomParticipant.userId = urlToken;
  }

  $("#btn-leave-room").addEventListener("click", () => {
    stopRoomStatusPoll();
    stopRoomQuizJoinRetry();
    if (roomSessionSocket) roomSessionSocket.disconnect();
    roomSessionSocket = null;
    clearStoredParticipant();
    location.href = roomJoinUrl({
      roomId: roomParticipant?.roomId || urlRoom || "",
      token: roomParticipant?.userId || urlToken || "",
      name: roomParticipant?.displayName || urlNickname || "",
    });
  });

  if (!activeRoom) {
    $("#join-room-status").textContent = "";
    $("#join-room-error").textContent =
      "Open the join link from your teacher's notification.";
    return;
  }

  const displayName = resolveDisplayName(activeRoom, stored);
  if (!displayName) {
    $("#join-room-status").textContent = "";
    $("#join-room-error").textContent =
      "Your name is missing from the join link. Ask your teacher for a new link.";
    return;
  }

  void doJoinRoom(activeRoom, displayName);
}

function doJoinRoom(roomId, displayNameOverride) {
  const stored = loadStoredParticipant();
  const displayName = (displayNameOverride || resolveDisplayName(roomId, stored)).trim();
  $("#join-room-error").textContent = "";
  $("#join-room-status").textContent = "Joining waiting room…";

  if (!roomId) {
    $("#join-room-status").textContent = "";
    $("#join-room-error").textContent =
      "Open the join link from your teacher's notification.";
    return;
  }
  if (!displayName) {
    $("#join-room-status").textContent = "";
    $("#join-room-error").textContent = "Your name is missing from the join link.";
    return;
  }

  const socket = getRoomSessionSocket();

  const attemptJoin = () => {
    socket.emit(
      "join_session",
      {
        roomId,
        displayName,
        userId: resolveStudentUserId(roomId, stored),
      },
      (data) => {
        if (!data?.ok) {
          $("#join-room-status").textContent = "";
          $("#join-room-error").textContent = data?.error || "Failed to join room.";
          return;
        }

        const participant = {
          roomId: data.roomId,
          userId: data.userId,
          displayName: data.displayName,
        };
        saveStoredParticipant(participant);
        roomParticipant = participant;

        $("#room-waiting-status").textContent =
          data.sessionStatus === "start"
            ? "Class is starting — get ready!"
            : "You're in class — your teacher will start an activity when ready.";
        showScreen("room-waiting");

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("room", data.roomId);
        nextUrl.searchParams.delete("roomId");
        if (data.userId) nextUrl.searchParams.set("token", data.userId);
        else nextUrl.searchParams.delete("token");
        if (data.displayName) nextUrl.searchParams.set("name", data.displayName);
        else nextUrl.searchParams.delete("name");
        nextUrl.searchParams.delete("nickname");
        nextUrl.searchParams.delete("username");
        nextUrl.searchParams.delete("displayName");
        history.replaceState(null, "", nextUrl);
      }
    );
  };

  if (socket.connected) attemptJoin();
  else {
    socket.once("connect", attemptJoin);
    socket.once("connect_error", () => {
      $("#join-room-status").textContent = "";
      $("#join-room-error").textContent = "Could not connect to class server.";
    });
  }
}

function initQuizJoin() {
  const pin = normalizePin(urlPin || "");
  if (pin.length !== 6) {
    $("#join-panel-quiz").hidden = true;
    $("#join-panel-link-required").hidden = false;
    return;
  }

  const socket = io({ transports: ["websocket", "polling"] });
  let myPlayerId = null;
  let currentQuestion = null;
  let quizFastMode = false;

  const statusEl = $("#connection-status");
  const joinBtn = $("#btn-join-game");

  function setConnectionStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = `connection-status${type ? ` ${type}` : ""}`;
  }

  function updateJoinButton() {
    joinBtn.disabled = !socket.connected;
  }

  socket.on("connect", () => {
    setConnectionStatus("Connected — enter your nickname", "ok");
    updateJoinButton();
  });

  socket.on("disconnect", () => {
    setConnectionStatus("Disconnected — reconnecting…", "err");
    updateJoinButton();
  });

  socket.on("connect_error", () => {
    setConnectionStatus("Cannot reach server — check the join link from the host", "err");
    updateJoinButton();
  });

  function doJoin() {
    const nickname = $("#join-nickname").value.trim();
    $("#join-error").textContent = "";

    if (!nickname) {
      $("#join-error").textContent = "Enter a nickname.";
      return;
    }

    joinBtn.disabled = true;

    socket.emit("join_game", { pin, nickname }, (res) => {
      joinBtn.disabled = !socket.connected;

      if (!res?.ok) {
        let msg = res?.error || "Failed to join";
        if (res?.hint) msg += ` ${res.hint}`;
        $("#join-error").textContent = msg;
        return;
      }

      myPlayerId = res.playerId;
      $("#room-waiting-title").textContent = res.quizTitle || "Waiting Room";
      $("#room-waiting-status").textContent = "Waiting for host to start…";
      $("#btn-leave-room").hidden = true;
      showScreen("room-waiting");
    });
  }

  joinBtn.addEventListener("click", () => {
    if (!socket.connected) {
      $("#join-error").textContent =
        "Still connecting to the server. Wait a moment and try again.";
      return;
    }
    doJoin();
  });

  socket.on("game_starting", ({ fastMode } = {}) => {
    quizFastMode = !!fastMode;
    $("#room-waiting-status").textContent = "Get ready…";
  });

  socket.on("question_start", (data) => {
    currentQuestion = data;
    clearTimer();
    resetPlayerMcqAnsweredState();
    showScreen("player-question");
    $("#player-q-meta").textContent = `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
    setQuestionImage(
      $("#player-question-image"),
      $("#player-question-image-wrap"),
      typeof resolvedMediaUrl === "function" ? resolvedMediaUrl(data.image) : data.image
    );
    $("#player-question-text").textContent = data.text;
    $("#answer-feedback").textContent = "";

    renderOptions($("#player-options"), data.options, {
      clickable: true,
      optionLabels: ["A.", "B.", "C.", "D.", "E.", "F."],
      onClick: (index, btn) => {
        showPlayerMcqAnsweredState(index);
        socket.emit("submit_answer", { answerIndex: index });
        $("#answer-feedback").textContent = "Answer locked in!";
      },
    });

    startDeadlineTimer(
      data.endsAt,
      data.timeLimit,
      (remaining) => {
        $("#timer-text").textContent = remaining;
        $("#timer-ring").classList.toggle("urgent", remaining <= 5);
      },
      () => {
        $("#player-options").querySelectorAll(".player-btn").forEach((b) => (b.disabled = true));
        $("#answer-feedback").textContent = "Time's up!";
      }
    );
  });

  socket.on("answer_received", () => {
    $("#answer-feedback").textContent = quizFastMode
      ? "Answer saved — next question coming…"
      : "Waiting for others…";
  });

  socket.on("question_between", ({ isLast } = {}) => {
    if (!quizFastMode) return;
    clearTimer();
    $("#answer-feedback").textContent = isLast
      ? "Calculating your score…"
      : "Next question coming…";
  });

  socket.on("question_results", ({ results, leaderboard }) => {
    if (quizFastMode) return;
    clearTimer();
    showScreen("player-results");
    const mine = results.find((r) => r.playerId === myPlayerId);
    renderPlayerMcqResult(mine, leaderboard, myPlayerId);
  });

  socket.on("game_finished", ({ leaderboard, semesterLeaderboard, exerciseLeaderboard }) => {
    const wasFastMode = quizFastMode;
    quizFastMode = false;
    clearTimer();
    if (wasFastMode) {
      showPlayerPassiveWaiting();
      return;
    }
    showScreen("player-finished");
    showExerciseLeaderboards({
      exerciseLeaderboard: exerciseLeaderboard || leaderboard,
      semesterLeaderboard,
      highlightId: myPlayerId,
      exerciseListEl: $("#player-final-leaderboard"),
      semesterListEl: $("#player-semester-leaderboard"),
      semesterWrapEl: $("#player-semester-leaderboard-wrap"),
      exerciseWrapEl: $("#player-exercise-leaderboard-wrap"),
    });
    const playBtn = $("#btn-play-again");
    if (playBtn) playBtn.hidden = false;
  });

  socket.on("game_ended", () => {
    clearTimer();
    location.href = "/join.html";
  });

  if (urlNickname) $("#join-nickname").value = urlNickname.slice(0, 20);

  $("#btn-play-again")?.addEventListener("click", () => {
    location.href = "/join.html";
  });

  updateJoinButton();

  if (urlNickname && socket.connected) doJoin();
  else if (urlNickname) socket.once("connect", doJoin);
}

function initJoinLinkRequired() {
  $("#join-panel-quiz").hidden = true;
  $("#join-panel-room").hidden = true;
  $("#join-panel-link-required").hidden = false;
}

if (urlParams.has("preview")) {
  /* Layout preview mode — join-preview.js drives the UI. */
} else if (urlPin) {
  initQuizJoin();
} else if (urlRoom || loadStoredParticipant()?.roomId || urlToken || urlNickname) {
  initRoomJoin();
  $("#btn-play-again")?.addEventListener("click", () => {
    location.href = "/join.html";
  });
} else {
  initJoinLinkRequired();
}
