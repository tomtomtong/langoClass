const express = require("express");
const http = require("http");
const os = require("os");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");
const path = require("path");
const { normalizeClassListResponse } = require("./lib/lango-classes");
const cmsStore = require("./lib/cms-store");
const scoreStore = require("./lib/score-store");
const sessionStore = require("./lib/session-store");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;
const LANGO_API_BASE = "https://dev.api.lango.ai/v1";
const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL || "https://58ef-138-199-60-185.ngrok-free.app"
).replace(/\/$/, "");

app.use(express.json());

const UPLOADS_DIR = path.join(__dirname, "public", "uploads", "courses");
const SECTION_UPLOADS_DIR = path.join(__dirname, "public", "uploads", "sections");
const QUESTION_UPLOADS_DIR = path.join(__dirname, "public", "uploads", "questions");
const MAX_MC_OPTIONS = 6;
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(SECTION_UPLOADS_DIR)) {
  fs.mkdirSync(SECTION_UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(QUESTION_UPLOADS_DIR)) {
  fs.mkdirSync(QUESTION_UPLOADS_DIR, { recursive: true });
}

const bannerUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_IMAGE_EXTS.has(ext) ? ext : ".jpg";
      cb(null, `course-${req.params.courseId}-${Date.now()}${safeExt}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, WebP, or GIF images are allowed."), ok);
  },
});

const sectionBannerUpload = multer({
  storage: multer.diskStorage({
    destination: SECTION_UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_IMAGE_EXTS.has(ext) ? ext : ".jpg";
      cb(null, `section-${req.params.courseId}-${req.params.sectionId}-${Date.now()}${safeExt}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, WebP, or GIF images are allowed."), ok);
  },
});

const questionImageUpload = multer({
  storage: multer.diskStorage({
    destination: QUESTION_UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_IMAGE_EXTS.has(ext) ? ext : ".jpg";
      const owner = String(req.headers["x-teacher-id"] || req.params.courseId || "upload").replace(/\W/g, "");
      cb(null, `question-${owner}-${Date.now()}${safeExt}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, WebP, or GIF images are allowed."), ok);
  },
});

function handleQuestionImageUpload(req, res) {
  questionImageUpload.single("image")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided." });
    }

    const url = `/uploads/questions/${req.file.filename}`;
    return res.json({ url });
  });
}

function deleteLocalUpload(uploadUrl) {
  const url = String(uploadUrl || "");
  if (
    !url.startsWith("/uploads/courses/") &&
    !url.startsWith("/uploads/sections/") &&
    !url.startsWith("/uploads/questions/")
  ) {
    return;
  }
  const filePath = path.join(__dirname, "public", url);
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore missing files */
  }
}

function deleteLocalBanner(bannerUrl) {
  deleteLocalUpload(bannerUrl);
}

function deleteSectionBanners(sections) {
  for (const section of sections || []) {
    deleteLocalUpload(section?.banner);
  }
}

const QUESTION_TIME_MS = 15000;
const BASE_POINTS = 1000;
const MAX_TIME_BONUS = 500;

/** @type {Map<string, Game>} */
const games = new Map();

/** @type {Map<string, { pin: string, role: 'host' | 'player' | 'session_player', playerId?: string }>} */
const socketMeta = new Map();

function normalizePin(pin) {
  return String(pin || "").replace(/\D/g, "").slice(0, 6);
}

function getLocalIPv4() {
  const addresses = [];
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

function isRoomIdInUse(pin) {
  return games.has(pin) || sessionStore.getSession(pin) !== null;
}

function generateRoomId() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (isRoomIdInUse(pin));
  return pin;
}

function generatePin() {
  return generateRoomId();
}

function normalizeClientQuiz(quiz) {
  const questions = (quiz?.questions || [])
    .slice(0, 20)
    .map((q) => {
      const options = (q.options || []).slice(0, MAX_MC_OPTIONS).map((o) => String(o).slice(0, 200));
      const correctIndex = Math.min(
        Math.max(0, options.length - 1),
        Math.max(0, Number(q.correctIndex) || 0)
      );
      const image = String(q.image || q.imageUrl || "").trim().slice(0, 500);
      return {
        text: String(q.text || "").slice(0, 500),
        options,
        correctIndex,
        timeLimit: Math.min(60, Math.max(5, Number(q.timeLimit) || 15)),
        image: image || null,
      };
    })
    .filter((q) => q.text && q.options.length >= 2);

  return {
    title: String(quiz?.title || "Class quiz").slice(0, 100),
    questions,
    fastMode: !!quiz?.fastMode,
  };
}

function attachSessionContext(game) {
  const session = sessionStore.getSession(game.pin);
  if (!session) return;

  game.sessionContext = {
    teacherId: session.teacherId,
    classId: session.classId,
    courseId: session.courseId,
    exerciseId: session.exercise?.id,
    exerciseTitle: session.exercise?.title || session.exercise?.subTitle || "",
    exerciseType: session.exercise?.type || "mcquiz",
  };
}

function persistExerciseScores(game) {
  const ctx = game.sessionContext;
  if (!ctx?.teacherId || !ctx?.classId || !ctx?.exerciseId) return null;

  const session = sessionStore.getSession(game.pin);
  const participantById = session
    ? new Map([...session.participants.values()].map((p) => [p.userId, p]))
    : null;

  const scores = [...game.players.values()].map((player) => {
    const participant = participantById?.get(player.id);
    return {
      studentUserId: player.id,
      displayName: participant?.displayName || player.name,
      score: player.score,
    };
  });

  return scoreStore.saveExerciseScores({
    teacherId: ctx.teacherId,
    classId: ctx.classId,
    courseId: ctx.courseId,
    exerciseId: ctx.exerciseId,
    exerciseTitle: ctx.exerciseTitle,
    exerciseType: ctx.exerciseType,
    roomId: game.pin,
    scores,
  });
}

function createRoomGame(hostSocketId, roomId, quizPayload) {
  const pin = normalizeRoomId(roomId);
  if (!pin) return null;

  const normalized = normalizeClientQuiz(quizPayload);
  if (!normalized.questions.length) return null;

  const existing = games.get(pin);
  if (existing) clearQuestionTimer(existing);

  const game = {
    pin,
    hostId: hostSocketId,
    quiz: normalized,
    status: "lobby",
    players: new Map(),
    currentQuestionIndex: -1,
    questionStartedAt: null,
    answers: new Map(),
    questionTimer: null,
    isRoomGame: true,
    sessionContext: null,
    scoresSaved: false,
    fastMode: !!normalized.fastMode,
  };

  attachSessionContext(game);
  games.set(pin, game);
  return game;
}

function emitCurrentQuestion(socket, game) {
  const question = game.quiz.questions[game.currentQuestionIndex];
  if (!question) return;

  socket.emit("question_start", {
    questionIndex: game.currentQuestionIndex,
    totalQuestions: game.quiz.questions.length,
    text: question.text,
    options: question.options,
    timeLimit: question.timeLimit || 15,
    image: question.image || null,
  });
}

function createGame(hostSocketId, quizPayload) {
  const normalized = normalizeClientQuiz(quizPayload);
  if (!normalized.questions.length) return null;

  const pin = generatePin();

  const game = {
    pin,
    hostId: hostSocketId,
    quiz: normalized,
    status: "lobby",
    players: new Map(),
    currentQuestionIndex: -1,
    questionStartedAt: null,
    answers: new Map(),
    questionTimer: null,
    fastMode: !!normalized.fastMode,
  };

  games.set(pin, game);
  return game;
}

function getLeaderboard(game) {
  return [...game.players.values()]
    .map((p) => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function broadcastLobby(game) {
  const payload = {
    pin: game.pin,
    quizTitle: game.quiz.title,
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
    })),
    status: game.status,
  };

  io.to(game.pin).emit("lobby_update", payload);
}

function clearQuestionTimer(game) {
  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
    game.questionTimer = null;
  }
}

function endQuestion(game) {
  if (game.status !== "question") return;

  clearQuestionTimer(game);
  game.status = "results";

  const question = game.quiz.questions[game.currentQuestionIndex];
  const optionCount = question.options?.length || 4;
  const answerCounts = Array.from({ length: optionCount }, () => 0);
  const results = [];

  for (const player of game.players.values()) {
    const answer = game.answers.get(player.id);
    if (answer) {
      answerCounts[answer.answerIndex]++;
      if (answer.answerIndex === question.correctIndex) {
        const timeTaken = answer.timeMs;
        const timeLimitMs = (question.timeLimit || 15) * 1000;
        const timeRatio = Math.max(0, 1 - timeTaken / timeLimitMs);
        const points = Math.round(BASE_POINTS + MAX_TIME_BONUS * timeRatio);
        player.score += points;
        results.push({
          playerId: player.id,
          name: player.name,
          correct: true,
          points,
          answerIndex: answer.answerIndex,
        });
      } else {
        results.push({
          playerId: player.id,
          name: player.name,
          correct: false,
          points: 0,
          answerIndex: answer.answerIndex,
        });
      }
    } else {
      results.push({
        playerId: player.id,
        name: player.name,
        correct: false,
        points: 0,
        answerIndex: null,
      });
    }
  }

  if (game.fastMode) {
    const isLast = game.currentQuestionIndex + 1 >= game.quiz.questions.length;
    io.to(game.pin).emit("question_between", {
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.quiz.questions.length,
      isLast,
    });
    setTimeout(() => startQuestion(game), 1500);
    return;
  }

  io.to(game.pin).emit("question_results", {
    questionIndex: game.currentQuestionIndex,
    correctIndex: question.correctIndex,
    answerCounts,
    results,
    leaderboard: getLeaderboard(game),
  });
}

function startQuestion(game) {
  const nextIndex = game.currentQuestionIndex + 1;

  if (nextIndex >= game.quiz.questions.length) {
    game.status = "finished";
    if (!game.scoresSaved) {
      const result = persistExerciseScores(game);
      game.scoresSaved = true;
      if (result?.saved > 0) {
        console.log(
          `[scores] Saved ${result.saved} score(s) for class ${game.sessionContext?.classId} exercise ${game.sessionContext?.exerciseId} (room ${game.pin})`
        );
      }
    }
    io.to(game.pin).emit("game_finished", {
      leaderboard: getLeaderboard(game),
    });
    return;
  }

  game.currentQuestionIndex = nextIndex;
  game.status = "question";
  game.answers.clear();
  game.questionStartedAt = Date.now();

  const question = game.quiz.questions[nextIndex];
  const timeLimit = (question.timeLimit || 15) * 1000;

  io.to(game.pin).emit("question_start", {
    questionIndex: nextIndex,
    totalQuestions: game.quiz.questions.length,
    text: question.text,
    options: question.options,
    timeLimit: question.timeLimit || 15,
    image: question.image || null,
  });

  clearQuestionTimer(game);
  game.questionTimer = setTimeout(() => endQuestion(game), timeLimit);
}

function removePlayerFromGame(socketId) {
  const meta = socketMeta.get(socketId);
  if (!meta) return;

  const game = games.get(meta.pin);
  if (!game) {
    if (meta.role === "host") {
      endSession(meta.pin, "Host left the session");
    }
    socketMeta.delete(socketId);
    return;
  }

  if (meta.role === "host") {
    clearQuestionTimer(game);
    io.to(game.pin).emit("game_ended", { reason: "Host left the game" });
    games.delete(meta.pin);
    endSession(meta.pin, "Host left the session");
  } else if (meta.playerId) {
    game.players.delete(meta.playerId);
    if (game.status === "lobby") {
      broadcastLobby(game);
    }
  }

  socketMeta.delete(socketId);
}

function pickToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return auth.trim() || null;
}

function pickTeacherId(req) {
  const header = req.headers["x-teacher-id"];
  const fromBody = req.body?.teacherId;
  const raw = header ?? fromBody;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function requireCmsAuth(req, res) {
  const token = pickToken(req);
  if (!token) {
    res.status(401).json({ message: "Missing auth token." });
    return null;
  }

  const teacherId = pickTeacherId(req);
  if (!teacherId) {
    res.status(400).json({ message: "Missing teacher id." });
    return null;
  }

  const { ok } = await langoRequest("GET", "/whiteboard/classList", { token });
  if (!ok) {
    res.status(401).json({ message: "Invalid or expired token." });
    return null;
  }

  return { token, teacherId };
}

async function langoRequest(method, endpoint, { token, body } = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${LANGO_API_BASE}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  return { ok: res.ok, status: res.status, data };
}

function normalizeRoomId(roomId) {
  const id = normalizePin(roomId);
  return id.length === 6 ? id : null;
}

function broadcastSessionLobby(session) {
  io.to(session.roomId).emit("session_lobby_update", {
    roomId: session.roomId,
    status: session.status,
    participants: sessionStore.participantPayload(session),
    count: session.participants.size,
  });
}

function removeFromSession(socketId) {
  const meta = socketMeta.get(socketId);
  if (!meta || meta.role !== "session_player") return;

  const session = sessionStore.getSession(meta.pin);
  if (!session) return;

  sessionStore.removeParticipantBySocket(session, socketId);
  broadcastSessionLobby(session);
}

function endSession(roomId, reason) {
  const session = sessionStore.getSession(roomId);
  if (!session) return;

  session.status = "ended";
  io.to(roomId).emit("session_ended", { reason: reason || "Session ended" });
  sessionStore.deleteSession(roomId);
}

function courseDisplayName(course) {
  return course?.name || course?.title || course?.courseName || "Whiteboard session";
}

function courseBanner(course) {
  return (
    course?.banner ||
    course?.bannerUrl ||
    course?.image ||
    course?.thumbnail ||
    course?.cover ||
    ""
  );
}

function teacherDisplayName(user) {
  if (!user) return "Teacher";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.username || user.email || `User ${user.id}`;
}

function buildNotificationData(extra = {}) {
  return {
    ...extra,
    base_endpoint: PUBLIC_BASE_URL,
  };
}

app.post("/api/lango/login", async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = req.body?.password;
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  const { ok, status, data } = await langoRequest("POST", "/user/login", {
    body: { username, password },
  });

  if (!ok) {
    return res.status(status).json(data || { message: "Login failed" });
  }
  return res.json(data);
});

app.get("/api/lango/classList", async (req, res) => {
  const token = pickToken(req);
  if (!token) return res.status(401).json({ message: "Missing auth token." });

  const { ok, status, data } = await langoRequest("GET", "/whiteboard/classList", { token });
  if (!ok) return res.status(status).json(data || { message: "Failed to load classes" });
  return res.json({
    ...normalizeClassListResponse(data),
    _rawClassList: data,
  });
});

app.post("/api/lango/sendNotification", async (req, res) => {
  const token = pickToken(req);
  if (!token) return res.status(401).json({ message: "Missing auth token." });

  const { class_id, title, body, data: notifyData } = req.body || {};
  if (!class_id || !title) {
    return res.status(400).json({ message: "class_id and title are required." });
  }

  const notifyBody = {
    class_id,
    title,
    body: body || "Class will start soon",
    data: buildNotificationData(notifyData || {}),
  };

  const { ok, status, data } = await langoRequest("POST", "/whiteboard/sendNotification", {
    token,
    body: notifyBody,
  });

  if (!ok) {
    return res.status(status).json(data || { message: "Failed to send notification." });
  }

  return res.json({ ok: true, notification: notifyBody, apiResponse: data });
});

app.get("/api/cms/courses", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;
  const classId = req.query.classId != null ? Number(req.query.classId) : undefined;
  return res.json({
    courses: cmsStore.listCoursesForTeacher(auth.teacherId, {
      classId: Number.isFinite(classId) ? classId : undefined,
    }),
  });
});

app.post("/api/cms/courses", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;
  const course = cmsStore.createCourse(auth.teacherId, req.body || {});
  return res.status(201).json({ course });
});

app.get("/api/cms/courses/:courseId", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const courseId = Number(req.params.courseId);
  const course = cmsStore.getCourseForTeacher(courseId, auth.teacherId);
  if (!course) return res.status(404).json({ message: "Course not found." });

  return res.json(cmsStore.courseDetailResponse(course));
});

app.put("/api/cms/courses/:courseId", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const courseId = Number(req.params.courseId);
  const existing = cmsStore.getCourseForTeacher(courseId, auth.teacherId);
  if (!existing) return res.status(404).json({ message: "Course not found." });

  if (req.body?.banner != null) {
    const newBanner = String(req.body.banner).trim().slice(0, 500);
    if (newBanner !== existing.banner) {
      deleteLocalBanner(existing.banner);
    }
  }

  const course = cmsStore.updateCourse(courseId, auth.teacherId, req.body || {});

  return res.json({
    course: {
      id: course.id,
      name: course.name,
      description: course.description,
      banner: course.banner,
      langCode: course.langCode,
      classIds: course.classIds || [],
      updatedAt: course.updatedAt,
    },
  });
});

app.put("/api/cms/courses/:courseId/sections", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const courseId = Number(req.params.courseId);
  const existing = cmsStore.getCourseForTeacher(courseId, auth.teacherId);
  if (!existing) return res.status(404).json({ message: "Course not found." });

  const incoming = req.body?.sections || [];
  const oldBanners = new Map((existing.sections || []).map((section) => [section.id, section.banner || ""]));

  for (const section of incoming) {
    if (section.id == null) continue;
    const oldBanner = oldBanners.get(section.id) || "";
    const newBanner = String(section.banner || "").trim();
    if (oldBanner && oldBanner !== newBanner) {
      deleteLocalUpload(oldBanner);
    }
    oldBanners.delete(section.id);
  }

  for (const banner of oldBanners.values()) {
    if (banner) deleteLocalUpload(banner);
  }

  const course = cmsStore.saveSections(courseId, auth.teacherId, incoming);
  if (!course) return res.status(404).json({ message: "Course not found." });

  return res.json({
    sections: course.sections || [],
    updatedAt: course.updatedAt,
  });
});

app.post("/api/cms/courses/:courseId/sections/:sectionId/banner", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const courseId = Number(req.params.courseId);
  const sectionId = Number(req.params.sectionId);
  const course = cmsStore.getCourseForTeacher(courseId, auth.teacherId);
  if (!course) return res.status(404).json({ message: "Course not found." });

  sectionBannerUpload.single("banner")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided." });
    }

    const url = `/uploads/sections/${req.file.filename}`;
    const updated = cmsStore.updateSectionBanner(courseId, auth.teacherId, sectionId, url);
    if (updated?.oldBanner) {
      deleteLocalUpload(updated.oldBanner);
    }

    return res.json({
      url,
      section: updated?.section || { id: sectionId, banner: url },
      updatedAt: updated?.updatedAt || null,
    });
  });
});

app.post("/api/cms/question-image", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;
  handleQuestionImageUpload(req, res);
});

app.post("/api/cms/courses/:courseId/question-image", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const courseId = Number(req.params.courseId);
  const course = cmsStore.getCourseForTeacher(courseId, auth.teacherId);
  if (!course) return res.status(404).json({ message: "Course not found." });

  handleQuestionImageUpload(req, res);
});

app.post("/api/cms/courses/:courseId/banner", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const courseId = Number(req.params.courseId);
  const course = cmsStore.getCourseForTeacher(courseId, auth.teacherId);
  if (!course) return res.status(404).json({ message: "Course not found." });

  bannerUpload.single("banner")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided." });
    }

    const oldBanner = course.banner;
    const url = `/uploads/courses/${req.file.filename}`;
    const updated = cmsStore.updateCourse(courseId, auth.teacherId, { banner: url });
    deleteLocalBanner(oldBanner);

    return res.json({
      url,
      course: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        banner: updated.banner,
        langCode: updated.langCode,
        classIds: updated.classIds || [],
        updatedAt: updated.updatedAt,
      },
    });
  });
});

app.delete("/api/cms/courses/:courseId", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const courseId = Number(req.params.courseId);
  const course = cmsStore.getCourseForTeacher(courseId, auth.teacherId);
  if (!course) return res.status(404).json({ message: "Course not found." });

  deleteLocalBanner(course.banner);
  deleteSectionBanners(course.sections);
  cmsStore.deleteCourse(courseId, auth.teacherId);

  return res.json({ ok: true });
});

app.post("/api/session/start", async (req, res) => {
  const token = pickToken(req);
  if (!token) return res.status(401).json({ message: "Missing auth token." });

  const { class: classItem, course, exercise, user } = req.body || {};
  if (!classItem?.id || !course?.id || !exercise?.id || !user?.id) {
    return res.status(400).json({
      message: "class, course, exercise, and user with id are required.",
    });
  }

  const sessionId = generateRoomId();
  sessionStore.createSession({
    roomId: sessionId,
    teacherId: user.id,
    classId: classItem.id,
    courseId: course.id,
    exercise,
    classItem,
    course,
  });

  const notifyBody = {
    class_id: classItem.id,
    title: courseDisplayName(course),
    body: "Class will start soon",
    data: buildNotificationData({
      session_id: sessionId,
      class_name: classItem.name || `Class ${classItem.id}`,
      teacher_name: teacherDisplayName(user),
      banner: courseBanner(course),
    }),
  };

  const { ok, status, data } = await langoRequest("POST", "/whiteboard/sendNotification", {
    token,
    body: notifyBody,
  });

  if (!ok) {
    return res.status(status).json({
      message: data?.message || "sendNotification failed after session was created.",
      sessionId,
      roomId: sessionId,
      notifyPayload: notifyBody,
      apiResponse: data,
    });
  }

  return res.status(201).json({
    sessionId,
    roomId: sessionId,
    notification: notifyBody,
    apiResponse: data,
  });
});

app.get("/api/scores", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const classId = Number(req.query.classId);
  if (!Number.isFinite(classId)) {
    return res.status(400).json({ message: "classId query parameter is required." });
  }

  const courseId = req.query.courseId != null ? Number(req.query.courseId) : undefined;
  const exerciseId = req.query.exerciseId != null ? Number(req.query.exerciseId) : undefined;
  const roomId = req.query.roomId ? String(req.query.roomId).trim() : undefined;

  return res.json({
    classId,
    teacherId: auth.teacherId,
    semesterTotals: scoreStore.listSemesterTotalsForClass(auth.teacherId, classId),
    students: scoreStore.listStudentsForClass(auth.teacherId, classId),
    scores: scoreStore.listScoresForClass(auth.teacherId, classId, {
      courseId: Number.isFinite(courseId) ? courseId : undefined,
      exerciseId: Number.isFinite(exerciseId) ? exerciseId : undefined,
      roomId,
    }),
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.redirect("/host.html");
});

app.get("/api/network-urls", (_req, res) => {
  res.json({ port: PORT, addresses: getLocalIPv4(), publicBaseUrl: PUBLIC_BASE_URL });
});

io.on("connection", (socket) => {
  socket.on("host_session", ({ roomId }, callback) => {
    const pin = normalizeRoomId(roomId);
    if (!pin) {
      callback?.({ ok: false, error: "Invalid room code. Enter the 6-digit code from your teacher." });
      return;
    }

    const session = sessionStore.getSession(pin);
    if (!session) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    sessionStore.setHost(session, socket.id);
    socket.join(pin);
    socketMeta.set(socket.id, { pin, role: "host" });

    callback?.({
      ok: true,
      roomId: pin,
      status: session.status,
      participants: sessionStore.participantPayload(session),
    });

    broadcastSessionLobby(session);
  });

  socket.on("join_session", ({ roomId, displayName, nickname, userId }, callback) => {
    const pin = normalizeRoomId(roomId);
    if (!pin) {
      callback?.({ ok: false, error: "Enter a valid 6-digit room code from your teacher." });
      return;
    }

    const session = sessionStore.getSession(pin);
    if (!session) {
      callback?.({ ok: false, error: "Room not found. Check the 6-digit code with your teacher." });
      return;
    }

    if (session.status === "ended") {
      callback?.({ ok: false, error: "This class session has ended." });
      return;
    }

    const name = String(displayName || nickname || "")
      .trim()
      .slice(0, 40);
    if (!name) {
      callback?.({ ok: false, error: "Enter your name." });
      return;
    }

    let playerId = String(userId || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64);
    if (!playerId) playerId = sessionStore.generateParticipantId();

    const nameTaken = [...session.participants.values()].some(
      (p) => p.userId !== playerId && p.displayName.toLowerCase() === name.toLowerCase()
    );
    if (nameTaken) {
      callback?.({ ok: false, error: "Name already taken in this class." });
      return;
    }

    sessionStore.addParticipant(session, {
      userId: playerId,
      displayName: name,
      socketId: socket.id,
    });

    socket.join(pin);
    socketMeta.set(socket.id, { pin, role: "session_player", playerId });

    callback?.({
      ok: true,
      roomId: pin,
      userId: playerId,
      displayName: name,
      sessionStatus: session.status,
    });

    broadcastSessionLobby(session);

    if (session.status === "start") {
      socket.emit("session_started", { exercise: session.exercise });
    }
  });

  socket.on("start_session", ({ roomId }, callback) => {
    const meta = socketMeta.get(socket.id);
    const pin = normalizeRoomId(roomId) || meta?.pin;
    if (!meta || meta.role !== "host" || !pin) {
      callback?.({ ok: false, error: "Only the host can start the class." });
      return;
    }

    const session = sessionStore.getSession(pin);
    if (!session) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    const alreadyStarted = session.status === "start";
    if (!alreadyStarted) {
      sessionStore.startSession(session);
    }

    io.to(pin).emit("session_started", { exercise: session.exercise });
    broadcastSessionLobby(session);

    callback?.({
      ok: true,
      roomId: pin,
      status: "start",
      alreadyStarted,
    });
  });

  socket.on("start_next_exercise", ({ roomId, exercise }, callback) => {
    const meta = socketMeta.get(socket.id);
    const pin = normalizeRoomId(roomId) || meta?.pin;
    if (!meta || meta.role !== "host" || !pin) {
      callback?.({ ok: false, error: "Only the host can start the next exercise." });
      return;
    }

    const session = sessionStore.getSession(pin);
    if (!session) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (!exercise?.id) {
      callback?.({ ok: false, error: "Exercise is required." });
      return;
    }

    if (!sessionStore.updateExercise(session, exercise)) {
      callback?.({ ok: false, error: "Could not update exercise." });
      return;
    }

    if (session.status !== "start") {
      sessionStore.startSession(session);
    }

    io.to(pin).emit("session_started", { exercise: session.exercise });
    broadcastSessionLobby(session);

    callback?.({
      ok: true,
      roomId: pin,
      status: session.status,
      exercise: session.exercise,
    });
  });

  socket.on("create_game", ({ quiz }, callback) => {
    const game = createGame(socket.id, quiz);
    if (!game) {
      callback?.({ ok: false, error: "Invalid quiz — add at least one question with options." });
      return;
    }

    socket.join(game.pin);
    socketMeta.set(socket.id, { pin: game.pin, role: "host" });

    callback?.({
      ok: true,
      pin: game.pin,
      quizTitle: game.quiz.title,
      questionCount: game.quiz.questions.length,
    });

    broadcastLobby(game);
  });

  socket.on("join_game", ({ pin, nickname }, callback) => {
    const normalizedPin = normalizePin(pin);
    const game = games.get(normalizedPin);

    if (!game) {
      callback?.({
        ok: false,
        error: "Game not found. Check the PIN.",
        hint:
          "Use the exact join link from the host screen. On a phone, do not use localhost — use the host's Wi‑Fi address or shared link.",
      });
      return;
    }

    if (game.status !== "lobby") {
      callback?.({ ok: false, error: "Game already started." });
      return;
    }

    const name = String(nickname || "").trim().slice(0, 20);
    if (!name) {
      callback?.({ ok: false, error: "Enter a nickname." });
      return;
    }

    const nameTaken = [...game.players.values()].some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (nameTaken) {
      callback?.({ ok: false, error: "Nickname already taken." });
      return;
    }

    const playerId = socket.id;
    game.players.set(playerId, { id: playerId, name, score: 0 });
    socket.join(game.pin);
    socketMeta.set(socket.id, { pin: game.pin, role: "player", playerId });

    callback?.({
      ok: true,
      pin: game.pin,
      quizTitle: game.quiz.title,
      playerId,
    });

    broadcastLobby(game);
  });

  function hostStartGame() {
    const meta = socketMeta.get(socket.id);
    if (!meta || meta.role !== "host") return;

    const game = games.get(meta.pin);
    if (!game || game.status !== "lobby") return;
    if (!game.isRoomGame && game.players.size === 0) return;

    attachSessionContext(game);

    game.status = "starting";
    io.to(game.pin).emit("game_starting", {
      totalQuestions: game.quiz.questions.length,
      fastMode: !!game.fastMode,
    });

    setTimeout(() => startQuestion(game), 2000);
  }

  socket.on("start_game", hostStartGame);
  socket.on("start_room_game", hostStartGame);

  socket.on("create_room_game", ({ roomId, quiz }, callback) => {
    const game = createRoomGame(socket.id, roomId, quiz);
    if (!game) {
      callback?.({ ok: false, error: "Invalid room or quiz." });
      return;
    }

    socket.join(game.pin);
    socketMeta.set(socket.id, { pin: game.pin, role: "host" });

    callback?.({
      ok: true,
      roomId: game.pin,
      quizTitle: game.quiz.title,
      questionCount: game.quiz.questions.length,
    });

    broadcastLobby(game);
  });

  socket.on("join_room_game", ({ roomId, nickname, userId }, callback) => {
    const pin = normalizeRoomId(roomId);
    if (!pin) {
      callback?.({ ok: false, error: "Invalid room code. Enter the 6-digit code from your teacher." });
      return;
    }

    const game = games.get(pin);
    if (!game || !game.isRoomGame) {
      callback?.({
        ok: false,
        error: "Class quiz not started yet. Wait for your teacher.",
      });
      return;
    }

    if (game.status === "finished") {
      callback?.({ ok: false, error: "Class quiz has ended." });
      return;
    }

    const session = sessionStore.getSession(pin);
    let name = String(nickname || "").trim().slice(0, 40);
    let playerId = String(userId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

    if (session) {
      if (!playerId) {
        callback?.({ ok: false, error: "Rejoin the class waiting room first." });
        return;
      }

      const participant = session.participants.get(playerId);
      if (!participant) {
        callback?.({
          ok: false,
          error: "Join the class waiting room before the quiz starts.",
        });
        return;
      }

      name = participant.displayName || name;
    } else if (!playerId) {
      playerId = socket.id;
    }

    if (!name) {
      callback?.({ ok: false, error: "Enter your name." });
      return;
    }

    const existing = game.players.get(playerId);
    if (existing && existing.name.toLowerCase() !== name.toLowerCase()) {
      const nameTaken = [...game.players.values()].some(
        (p) => p.id !== playerId && p.name.toLowerCase() === name.toLowerCase()
      );
      if (nameTaken) {
        callback?.({ ok: false, error: "Name already taken in this class." });
        return;
      }
    } else if (!existing) {
      const nameTaken = [...game.players.values()].some(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (nameTaken) {
        callback?.({ ok: false, error: "Name already taken in this class." });
        return;
      }
    }

    game.players.set(playerId, {
      id: playerId,
      name,
      score: existing?.score || 0,
      socketId: socket.id,
    });
    socket.join(game.pin);
    socketMeta.set(socket.id, { pin: game.pin, role: "player", playerId });

    callback?.({
      ok: true,
      roomId: game.pin,
      quizTitle: game.quiz.title,
      playerId,
    });

    if (game.status === "lobby") {
      broadcastLobby(game);
    } else if (game.status === "question") {
      socket.emit("game_starting", { totalQuestions: game.quiz.questions.length });
      emitCurrentQuestion(socket, game);
    }
  });

  socket.on("next_question", () => {
    const meta = socketMeta.get(socket.id);
    if (!meta || meta.role !== "host") return;

    const game = games.get(meta.pin);
    if (!game || game.status !== "results") return;

    startQuestion(game);
  });

  socket.on("submit_answer", ({ answerIndex }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || meta.role !== "player" || !meta.playerId) return;

    const game = games.get(meta.pin);
    if (!game || game.status !== "question") return;
    if (game.answers.has(meta.playerId)) return;

    const idx = Number(answerIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;

    game.answers.set(meta.playerId, {
      answerIndex: idx,
      timeMs: Date.now() - game.questionStartedAt,
    });

    socket.emit("answer_received");

    if (game.answers.size >= game.players.size) {
      endQuestion(game);
    }
  });

  socket.on("disconnect", () => {
    removeFromSession(socket.id);
    removePlayerFromGame(socket.id);
  });
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`QuizLive running at ${base}`);
  console.log(`  Host: ${base}/host.html`);
  console.log(`  CMS:  ${base}/cms.html`);
  console.log(`  Join: ${base}/join.html`);
});
