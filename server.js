const express = require("express");
const http = require("http");
const os = require("os");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");
const path = require("path");
const { normalizeClassListResponse, findStudentById } = require("./lib/lango-classes");
const cmsStore = require("./lib/cms-store");
const { isLiveMcQuizExercise, isVideoExercise, mcQuizPayloadFromExercise } = require("./lib/exercise-quiz");
const scoreStore = require("./lib/score-store");
const hostProgressStore = require("./lib/host-progress-store");
const sessionStore = require("./lib/session-store");
const paths = require("./lib/paths");
const settingsStore = require("./lib/settings-store");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024,
});

const PORT = process.env.PORT || 6000;
const LANGO_API_BASE = "https://dev.api.lango.ai/v1";
const ENV_PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL || "https://test.n9n.uk"
).replace(/\/$/, "");
const ENV_INWORLD_API_KEY = String(process.env.INWORLD_API_KEY || "").trim();
const ENV_INWORLD_LLM_MODEL = String(process.env.INWORLD_LLM_MODEL || "auto").trim();
const ENV_INWORLD_STT_MODEL = String(process.env.INWORLD_STT_MODEL || "inworld/inworld-stt-1").trim();
const ENV_INWORLD_STT_LANGUAGE = String(process.env.INWORLD_STT_LANGUAGE || "en").trim();
const ENV_QWEN_API_KEY = String(process.env.QWEN_API_KEY || "").trim();
const ENV_QWEN_MODEL = String(process.env.QWEN_MODEL || "qwen-plus").trim();
const ENV_OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || "").trim();
const ENV_OPENROUTER_BUZZIN_MODEL = String(
  process.env.OPENROUTER_BUZZIN_MODEL || "mistralai/voxtral-small-24b-2507"
).trim();
const INWORLD_API_BASE = "https://api.inworld.ai";
const INWORLD_BUZZIN_TTS_VOICE_ID = "default-zylgts2tamenvybeti3z0w__uncle_tommy";
const INWORLD_TTS_MODEL_ID = "inworld-tts-1.5-max";
const QWEN_API_BASE = String(
  process.env.QWEN_API_BASE || "https://dashscope.aliyuncs.com/compatible-mode/v1"
).replace(/\/$/, "");
const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const TRANSCRIBE_DEFAULT_MODEL = "mistralai/voxtral-small-24b-2507";
const TRANSCRIBE_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const QUESTION_PREVIEW_SECONDS = 5;
const TRANSCRIBE_PROMPT =
  "Listen to this audio and respond with exactly two sections:\n\n" +
  "Transcript:\n" +
  "Write exactly what was spoken, verbatim. No extra commentary in this section.\n\n" +
  "Pronunciation feedback:\n" +
  "Comment on pronunciation quality. Note any mispronounced or unclear words, " +
  "stress, rhythm, or intonation issues, and give brief constructive tips. " +
  "If pronunciation is generally good, say so and mention any small improvements.";

function getPublicBaseUrl() {
  const saved = settingsStore.readSettings().publicBaseUrl;
  return saved || ENV_PUBLIC_BASE_URL;
}

function getInworldApiKey() {
  const saved = settingsStore.readSettings().inworldApiKey;
  return saved || ENV_INWORLD_API_KEY;
}

function getInworldLlmModel() {
  const saved = settingsStore.readSettings().inworldLlmModel;
  return saved || ENV_INWORLD_LLM_MODEL || "auto";
}

function getInworldSttModel() {
  const saved = settingsStore.readSettings().inworldSttModel;
  return saved || ENV_INWORLD_STT_MODEL || "inworld/inworld-stt-1";
}

function getInworldSttLanguage() {
  const saved = settingsStore.readSettings().inworldSttLanguage;
  return saved || ENV_INWORLD_STT_LANGUAGE || "en";
}

function getQwenApiKey() {
  const saved = settingsStore.readSettings().qwenApiKey;
  return saved || ENV_QWEN_API_KEY;
}

function getQwenModel() {
  const saved = settingsStore.readSettings().qwenModel;
  return saved || ENV_QWEN_MODEL || "qwen-plus";
}

function getOpenRouterApiKey() {
  const saved = settingsStore.readSettings().openrouterApiKey;
  return saved || ENV_OPENROUTER_API_KEY;
}

function getOpenRouterBuzzinModel() {
  const saved = settingsStore.readSettings().openrouterBuzzinModel;
  return saved || ENV_OPENROUTER_BUZZIN_MODEL || "mistralai/voxtral-small-24b-2507";
}

function maskApiKey(key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `••••${trimmed.slice(-4)}`;
}

function normalizePublicBaseUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error("URL must start with http:// or https://");
  }
  return trimmed;
}

app.use(express.json());

paths.ensurePersistentDirs();

const UPLOADS_DIR = paths.uploadsCoursesDir;
const SECTION_UPLOADS_DIR = paths.uploadsSectionsDir;
const QUESTION_UPLOADS_DIR = paths.uploadsQuestionsDir;
const MAX_MC_OPTIONS = 6;
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

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

const transcribeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TRANSCRIBE_MAX_AUDIO_BYTES },
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
  const filePath = paths.uploadFilePath(url);
  if (!filePath) return;
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
const VIDEO_EXERCISE_POINTS = 200;

/** @type {Map<string, Game>} */
const games = new Map();

/** @type {Map<string, { pin: string, role: 'host' | 'player' | 'session_player', playerId?: string }>} */
const socketMeta = new Map();

const BUZZIN_WINNER_COUNT = 1;
const BUZZIN_JOIN_SECONDS = 20;
const BUZZIN_RESPONSE_MAX_LEN = 500;
const BUZZIN_AUDIO_MAX_BYTES = 4 * 1024 * 1024;

/** @type {Map<string, BuzzInRound>} */
const buzzInRounds = new Map();

/** @typedef {{ roundId: number, phase: 'join' | 'typing' | 'done', status: 'open' | 'closed', topic: string, buzzes: Array<{ playerId: string, displayName: string, rank: number, at: number }>, responses: Array<{ playerId: string, displayName: string, rank: number, text: string, at: number, analysis: string | null, analysisStatus: 'pending' | 'done' | 'error', analysisAudio: string | null, analysisAudioFormat: string | null }>, turnIndex: number, joinEndsAt: number, joinTimer: ReturnType<typeof setTimeout> | null }} BuzzInRound */

function buzzinTopicFromExercise(exercise) {
  if (!exercise) return "";
  const items = Array.isArray(exercise.items) ? exercise.items : [];
  const first = items[0] || {};
  const legacyQuestion = Array.isArray(first.questions) ? first.questions[0] : null;
  return String(
    first.topic ||
      legacyQuestion ||
      first.title ||
      exercise.title ||
      ""
  ).trim();
}

async function analyzeBuzzinStudentResponse({ topic, studentName, responseText }) {
  const apiKey = getInworldApiKey();
  if (!apiKey) {
    return { ok: false, error: "LLM not configured. Add an Inworld API key in Config." };
  }

  const model = getInworldLlmModel();
  const prompt = `You are a helpful English teacher assistant reviewing a student's spoken answer in class.

Discussion topic: ${topic}
Student name: ${studentName}
Student answer: ${responseText}

Write brief teacher-facing feedback in 2-4 sentences. Comment on how well the answer addresses the topic, note one language or vocabulary strength, and give one gentle suggestion. Be encouraging and concise. Plain text only, no bullet points.`;

  try {
    const analysis = await inworldLlmComplete(
      apiKey,
      model,
      [{ role: "user", content: prompt }],
      320
    );
    return { ok: true, analysis: analysis || "No feedback generated." };
  } catch (err) {
    return { ok: false, error: err.message || "Analysis failed." };
  }
}

async function analyzeAndAttachBuzzinResponse(pin, playerId, ctx) {
  const result = await analyzeBuzzinStudentResponse(ctx);
  const round = buzzInRounds.get(pin);
  if (!round) return;

  const entry = round.responses.find((r) => r.playerId === playerId);
  if (!entry) return;

  if (result.ok) {
    entry.analysis = result.analysis;
    entry.analysisStatus = "done";
    entry.analysisAudio = null;
    entry.analysisAudioFormat = null;

    try {
      const tts = await inworldTtsSynthesize(getInworldApiKey(), result.analysis);
      entry.analysisAudio = tts.audioContent;
      entry.analysisAudioFormat = tts.format;
    } catch {
      /* Text feedback still shown if TTS fails. */
    }
  } else {
    entry.analysis = result.error;
    entry.analysisStatus = "error";
    entry.analysisAudio = null;
    entry.analysisAudioFormat = null;
  }

  broadcastBuzzInUpdate(pin, "buzzin_response_analyzed");
}

function buzzinAudioMimeType(format) {
  const normalized = String(format || "webm").trim().toLowerCase().replace(/^\./, "");
  const map = {
    webm: "audio/webm",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
  };
  return map[normalized] || `audio/${normalized}`;
}

function parseBuzzinAudioPayload(audioBase64, format) {
  const raw = String(audioBase64 || "").trim();
  if (!raw) {
    throw new Error("Record your answer before submitting.");
  }

  let base64Data = raw;
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    if (comma === -1) {
      throw new Error("Invalid audio data.");
    }
    base64Data = raw.slice(comma + 1);
  }

  const bytes = Buffer.from(base64Data, "base64");
  if (!bytes.length) {
    throw new Error("Invalid audio data.");
  }
  if (bytes.length > BUZZIN_AUDIO_MAX_BYTES) {
    throw new Error("Recording is too long. Try a shorter answer.");
  }

  const audioFormat = String(format || "webm").trim().toLowerCase().replace(/^\./, "") || "webm";
  const mimeType = buzzinAudioMimeType(audioFormat);
  return {
    audioFormat,
    mimeType,
    base64Data,
  };
}

async function parseOpenRouterResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { message: text || res.statusText };
  }
}

function openRouterErrorMessage(data, status) {
  const parts = [];
  const primary = data?.error?.message || data?.message;
  if (primary) parts.push(primary);
  if (data?.error?.metadata) {
    parts.push(JSON.stringify(data.error.metadata));
  }
  if (data?.error?.code) {
    parts.push(`code: ${data.error.code}`);
  }
  return parts.join(" — ") || `OpenRouter API returned ${status}.`;
}

function inworldSttAudioEncoding(format) {
  const normalized = String(format || "wav").trim().toLowerCase().replace(/^\./, "");
  const map = {
    wav: "AUTO_DETECT",
    webm: "AUTO_DETECT",
    mp3: "MP3",
    m4a: "MP3",
    ogg: "OGG_OPUS",
    flac: "FLAC",
  };
  return map[normalized] || "AUTO_DETECT";
}

async function transcribeBuzzinAudioWithInworld(audioBase64, format, apiKeyOverride) {
  const apiKey = String(apiKeyOverride || getInworldApiKey() || "").trim();
  if (!apiKey) {
    throw new Error("Inworld is not configured. Add an API key in Config.");
  }

  const modelId = getInworldSttModel();
  const language = getInworldSttLanguage();
  const { audioFormat, base64Data } = parseBuzzinAudioPayload(audioBase64, format);
  const audioEncoding = inworldSttAudioEncoding(audioFormat);

  const res = await fetch(`${INWORLD_API_BASE}/stt/v1/transcribe`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transcribeConfig: {
        modelId,
        audioEncoding,
        language,
      },
      audioData: {
        content: base64Data,
      },
    }),
  });

  const data = await parseInworldResponse(res);
  if (!res.ok) {
    throw new Error(`Transcription (${modelId}): ${inworldErrorMessage(data, res.status)}`);
  }

  const text = data?.transcription?.transcript?.trim?.() || "";
  if (!text) {
    throw new Error("Could not transcribe your recording. Try again.");
  }
  return text;
}

async function transcribeBuzzinAudio(audioBase64, format) {
  if (getInworldApiKey()) {
    return transcribeBuzzinAudioWithInworld(audioBase64, format);
  }
  if (getOpenRouterApiKey()) {
    return transcribeBuzzinAudioWithOpenRouter(audioBase64, format);
  }
  throw new Error("Inworld is not configured. Add an API key in Config.");
}

async function transcribeBuzzinAudioWithOpenRouter(audioBase64, format) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter is not configured. Add an API key in Config.");
  }

  const model = getOpenRouterBuzzinModel();
  const { audioFormat, base64Data } = parseBuzzinAudioPayload(audioBase64, format);

  const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getPublicBaseUrl(),
      "X-Title": "Lango Buzz In",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: base64Data,
                format: audioFormat,
              },
            },
            {
              type: "text",
              text: "Transcribe the spoken words in this audio verbatim. Return only the transcript with no commentary or punctuation unless clearly spoken.",
            },
          ],
        },
      ],
      max_tokens: 512,
    }),
  });

  const data = await parseOpenRouterResponse(res);
  if (!res.ok) {
    throw new Error(`Transcription (${model}): ${openRouterErrorMessage(data, res.status)}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim?.() || "";
  if (!text) {
    throw new Error("Could not transcribe your recording. Try again.");
  }
  return text;
}

function extractOpenRouterMessageText(data) {
  const choices = data?.choices || [];
  if (!choices.length) return "";
  const content = choices[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text")
      .map((part) => String(part.text || "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

function audioFormatFromFilename(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase().replace(/^\./, "");
  return ext || "webm";
}

async function transcribeOpenRouterAudio({ apiKey, model, audioBuffer, format, prompt, maxTokens = 1024 }) {
  const key = String(apiKey || getOpenRouterApiKey() || "").trim();
  if (!key) {
    throw new Error("OpenRouter is not configured. Add an API key in Config.");
  }

  const buzzinModel =
    String(model || getOpenRouterBuzzinModel() || TRANSCRIBE_DEFAULT_MODEL).trim() ||
    TRANSCRIBE_DEFAULT_MODEL;
  if (!audioBuffer?.length) {
    throw new Error("The selected audio file is empty.");
  }
  if (audioBuffer.length > TRANSCRIBE_MAX_AUDIO_BYTES) {
    throw new Error("Audio file is too large (max 25 MB).");
  }

  const audioFormat = String(format || "webm").trim().toLowerCase().replace(/^\./, "") || "webm";
  const base64Data = audioBuffer.toString("base64");

  const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getPublicBaseUrl(),
      "X-Title": "OpenRouter Audio Transcribe",
    },
    body: JSON.stringify({
      model: buzzinModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: base64Data,
                format: audioFormat,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    }),
  });

  const data = await parseOpenRouterResponse(res);
  if (!res.ok) {
    const err = new Error(
      `Transcription (${buzzinModel}): ${openRouterErrorMessage(data, res.status)}`
    );
    err.openRouterDetails = data;
    throw err;
  }

  const text = extractOpenRouterMessageText(data);
  if (!text) {
    throw new Error("Could not transcribe the audio. Try another file or model.");
  }
  return text;
}

function clearBuzzInJoinTimer(round) {
  if (round?.joinTimer) {
    clearTimeout(round.joinTimer);
    round.joinTimer = null;
  }
}

function buzzInCurrentTurn(round) {
  if (round.phase !== "typing") return null;
  return round.buzzes[round.turnIndex] || null;
}

function buzzInPublicPayload(round) {
  const joinRemainingMs = round.phase === "join" ? Math.max(0, round.joinEndsAt - Date.now()) : 0;
  return {
    roundId: round.roundId,
    phase: round.phase,
    status: round.status,
    winners: round.buzzes.slice(0, BUZZIN_WINNER_COUNT),
    buzzes: round.buzzes,
    totalBuzzes: round.buzzes.length,
    winnerCount: BUZZIN_WINNER_COUNT,
    joinSeconds: BUZZIN_JOIN_SECONDS,
    joinEndsAt: round.joinEndsAt,
    joinSecondsRemaining: Math.ceil(joinRemainingMs / 1000),
    topic: round.topic || "",
    currentTurn: buzzInCurrentTurn(round),
    responses: round.responses,
    typingComplete: round.phase === "done",
  };
}

function broadcastBuzzInUpdate(pin, eventName = "buzzin_update") {
  const round = buzzInRounds.get(pin);
  if (!round) return;
  io.to(pin).emit(eventName, buzzInPublicPayload(round));
}

function closeBuzzInJoinWindow(pin) {
  const round = buzzInRounds.get(pin);
  if (!round || round.phase !== "join") return;

  clearBuzzInJoinTimer(round);
  round.phase = round.buzzes.length ? "typing" : "done";
  round.status = "closed";
  round.turnIndex = 0;
  broadcastBuzzInUpdate(pin, "buzzin_join_closed");
}

function advanceBuzzInTurn(pin) {
  const round = buzzInRounds.get(pin);
  if (!round || round.phase !== "typing") return;

  round.turnIndex += 1;
  if (round.turnIndex >= round.buzzes.length) {
    round.phase = "done";
  }
  broadcastBuzzInUpdate(pin);
}

function createBuzzInRound(pin, topic = "") {
  const existing = buzzInRounds.get(pin);
  if (existing) clearBuzzInJoinTimer(existing);

  const joinEndsAt = Date.now() + BUZZIN_JOIN_SECONDS * 1000;
  const round = {
    roundId: Date.now(),
    phase: "join",
    status: "open",
    topic: String(topic || "").trim(),
    buzzes: [],
    responses: [],
    turnIndex: 0,
    joinEndsAt,
    joinTimer: setTimeout(() => closeBuzzInJoinWindow(pin), BUZZIN_JOIN_SECONDS * 1000),
  };
  buzzInRounds.set(pin, round);
  return round;
}

function clearBuzzInRound(pin) {
  const round = buzzInRounds.get(pin);
  if (round) clearBuzzInJoinTimer(round);
  buzzInRounds.delete(pin);
}

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
    const rosterName = findStudentById(session?.studentList, player.id)?.fullName || "";
    const displayName =
      participant?.displayName ||
      player.name ||
      rosterName ||
      "Student";
    return {
      studentUserId: player.id,
      displayName,
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

function resolveFinishedExercise(session, { exerciseId, exerciseType } = {}) {
  const normalizedId = Number(exerciseId);
  if (
    Number.isFinite(normalizedId) &&
    session?.exercise?.id != null &&
    Number(session.exercise.id) === normalizedId
  ) {
    return session.exercise;
  }

  if (isVideoExercise({ type: exerciseType }) && Number.isFinite(normalizedId)) {
    return {
      id: normalizedId,
      type: exerciseType,
      title: session?.exercise?.title || "",
      subTitle: session?.exercise?.subTitle || "",
    };
  }

  return session?.exercise || null;
}

function persistVideoExerciseScores(session, exercise = session?.exercise) {
  if (
    !session?.teacherId ||
    !session?.classId ||
    !exercise?.id ||
    !isVideoExercise(exercise)
  ) {
    return null;
  }

  const scores = [...session.participants.values()].map((participant) => ({
    studentUserId: participant.userId,
    displayName: participant.displayName || "Student",
    score: VIDEO_EXERCISE_POINTS,
  }));

  return scoreStore.saveExerciseScores({
    teacherId: session.teacherId,
    classId: session.classId,
    courseId: session.courseId,
    exerciseId: exercise.id,
    exerciseTitle: exercise.title || exercise.subTitle || "",
    exerciseType: exercise.type || "video",
    roomId: session.roomId,
    scores,
  });
}

function getVideoExerciseLeaderboard(session, exercise = session?.exercise) {
  if (!session || !isVideoExercise(exercise)) return null;
  return [...session.participants.values()].map((participant) => ({
    id: participant.userId,
    name: participant.displayName || "Student",
    score: VIDEO_EXERCISE_POINTS,
  }));
}

function quizPayloadForRoomGame(pin, clientQuiz) {
  const session = sessionStore.getSession(pin);
  if (!session?.courseId || session?.exercise?.id == null || !session?.teacherId) {
    return clientQuiz;
  }

  const course = cmsStore.getCourseForTeacher(session.courseId, session.teacherId);
  if (!course) return clientQuiz;

  const exercise = cmsStore
    .flattenExercises(course)
    .find((entry) => entry.id === session.exercise.id);
  if (!exercise || !isLiveMcQuizExercise(exercise)) return clientQuiz;

  const payload = mcQuizPayloadFromExercise(exercise);
  return payload?.questions?.length ? payload : clientQuiz;
}

function createRoomGame(hostSocketId, roomId, quizPayload) {
  const pin = normalizeRoomId(roomId);
  if (!pin) return null;

  const resolvedQuiz = quizPayloadForRoomGame(pin, quizPayload);
  const normalized = normalizeClientQuiz(resolvedQuiz);
  if (!normalized.questions.length) return null;

  const existing = games.get(pin);
  if (existing) clearQuestionTimer(existing);

  const session = sessionStore.getSession(pin);
  const roomPlayers = new Map(
    [...(session?.participants?.values() || [])].map((participant) => [
      participant.userId,
      {
        id: participant.userId,
        name: participant.displayName,
        score: 0,
        correctAnswers: 0,
        socketId: null,
      },
    ])
  );

  const game = {
    pin,
    hostId: hostSocketId,
    quiz: normalized,
    status: "lobby",
    // Students join the quiz over a second socket, so those join events can arrive
    // after the first question starts. Seed the roster from the class waiting room;
    // otherwise the first student to join and answer is mistaken for the whole class.
    players: roomPlayers,
    currentQuestionIndex: -1,
    questionStartedAt: null,
    previewEndsAt: null,
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
  if (game.status === "preview") {
    socket.emit("question_preview", {
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.quiz.questions.length,
      text: question.text,
      previewSeconds: QUESTION_PREVIEW_SECONDS,
      previewEndsAt: game.previewEndsAt || Date.now() + QUESTION_PREVIEW_SECONDS * 1000,
      points: game.fastMode ? 500 : 300,
      image: question.image || null,
      fastMode: game.fastMode,
    });
    return;
  }

  const timeLimitSeconds = question.timeLimit || 15;

  socket.emit("question_start", {
    questionIndex: game.currentQuestionIndex,
    totalQuestions: game.quiz.questions.length,
    text: question.text,
    options: question.options,
    timeLimit: timeLimitSeconds,
    endsAt: game.questionStartedAt
      ? game.questionStartedAt + timeLimitSeconds * 1000
      : Date.now() + timeLimitSeconds * 1000,
    points: game.fastMode ? 500 : 300,
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
    previewEndsAt: null,
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

function getAccuracyLeaderboard(game) {
  return [...game.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      correctAnswers: p.correctAnswers || 0,
    }))
    .sort((a, b) => b.correctAnswers - a.correctAnswers || a.name.localeCompare(b.name));
}

function getSemesterLeaderboardForRoom(pin) {
  const session = sessionStore.getSession(pin);
  if (!session?.teacherId || !session?.classId) return [];

  return scoreStore
    .listSemesterTotalsForClass(session.teacherId, session.classId)
    .map((s) => ({
      id: s.studentUserId,
      name: s.displayName,
      score: s.totalScore,
    }));
}

function buildExerciseFinishedPayload(pin, { exerciseLeaderboard } = {}) {
  return {
    exerciseLeaderboard: exerciseLeaderboard || null,
    semesterLeaderboard: getSemesterLeaderboardForRoom(pin),
  };
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
        player.correctAnswers = (player.correctAnswers || 0) + 1;
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
    const exerciseLeaderboard = getLeaderboard(game);
    io.to(game.pin).emit("game_finished", {
      leaderboard: exerciseLeaderboard,
      accuracyLeaderboard: getAccuracyLeaderboard(game),
      ...buildExerciseFinishedPayload(game.pin, { exerciseLeaderboard }),
    });
    return;
  }

  game.currentQuestionIndex = nextIndex;
  game.status = game.fastMode ? "question" : "preview";
  game.answers.clear();
  game.questionStartedAt = null;
  game.previewEndsAt = null;

  const question = game.quiz.questions[nextIndex];
  const timeLimit = (question.timeLimit || 15) * 1000;

  const emitQuestionStart = () => {
    if (game.status !== "preview" && game.status !== "question") return;

    game.status = "question";
    game.questionStartedAt = Date.now();
    game.previewEndsAt = null;

    io.to(game.pin).emit("question_start", {
      questionIndex: nextIndex,
      totalQuestions: game.quiz.questions.length,
      text: question.text,
      options: question.options,
      timeLimit: question.timeLimit || 15,
      endsAt: game.questionStartedAt + timeLimit,
      points: game.fastMode ? 500 : 300,
      image: question.image || null,
      fastMode: game.fastMode,
    });

    clearQuestionTimer(game);
    game.questionTimer = setTimeout(() => endQuestion(game), timeLimit);
  };

  if (!game.fastMode) {
    game.previewEndsAt = Date.now() + QUESTION_PREVIEW_SECONDS * 1000;
    io.to(game.pin).emit("question_preview", {
      questionIndex: nextIndex,
      totalQuestions: game.quiz.questions.length,
      text: question.text,
      previewSeconds: QUESTION_PREVIEW_SECONDS,
      previewEndsAt: game.previewEndsAt,
      points: 300,
      image: question.image || null,
      fastMode: false,
    });

    clearQuestionTimer(game);
    game.questionTimer = setTimeout(emitQuestionStart, QUESTION_PREVIEW_SECONDS * 1000);
    return;
  }

  emitQuestionStart();
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
  clearBuzzInRound(roomId);
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

function resolveSessionParticipantName(session, { displayName, nickname, userId } = {}) {
  const fromClient = String(displayName || nickname || "")
    .trim()
    .slice(0, 40);
  if (fromClient) return fromClient;

  const student = findStudentById(session?.studentList, userId);
  return String(student?.fullName || "").trim().slice(0, 40);
}

function buildNotificationData(extra = {}) {
  return {
    ...extra,
    base_endpoint: getPublicBaseUrl(),
  };
}

function buildConfigResponse() {
  const settings = settingsStore.readSettings();
  const effectiveInworldKey = getInworldApiKey();
  const effectiveInworldLlmModel = getInworldLlmModel();
  return {
    publicBaseUrl: settings.publicBaseUrl || "",
    envDefault: ENV_PUBLIC_BASE_URL,
    effectivePublicBaseUrl: getPublicBaseUrl(),
    inworldApiKeySaved: !!settings.inworldApiKey,
    inworldEnvDefaultConfigured: !!ENV_INWORLD_API_KEY,
    inworldApiKeyConfigured: !!effectiveInworldKey,
    inworldApiKeyMasked: maskApiKey(effectiveInworldKey),
    inworldLlmModelSaved: settings.inworldLlmModel || "",
    inworldLlmModelEnvDefault: ENV_INWORLD_LLM_MODEL,
    effectiveInworldLlmModel,
    inworldSttModelSaved: settings.inworldSttModel || "",
    inworldSttModelEnvDefault: ENV_INWORLD_STT_MODEL,
    effectiveInworldSttModel: getInworldSttModel(),
    inworldSttLanguageSaved: settings.inworldSttLanguage || "",
    inworldSttLanguageEnvDefault: ENV_INWORLD_STT_LANGUAGE,
    effectiveInworldSttLanguage: getInworldSttLanguage(),
    qwenApiKeySaved: !!settings.qwenApiKey,
    qwenEnvDefaultConfigured: !!ENV_QWEN_API_KEY,
    qwenApiKeyConfigured: !!getQwenApiKey(),
    qwenApiKeyMasked: maskApiKey(getQwenApiKey()),
    qwenModelSaved: settings.qwenModel || "",
    qwenModelEnvDefault: ENV_QWEN_MODEL,
    effectiveQwenModel: getQwenModel(),
    openrouterApiKeySaved: !!settings.openrouterApiKey,
    openrouterEnvDefaultConfigured: !!ENV_OPENROUTER_API_KEY,
    openrouterApiKeyConfigured: !!getOpenRouterApiKey(),
    openrouterApiKeyMasked: maskApiKey(getOpenRouterApiKey()),
    openrouterBuzzinModelSaved: settings.openrouterBuzzinModel || "",
    openrouterBuzzinModelEnvDefault: ENV_OPENROUTER_BUZZIN_MODEL,
    effectiveOpenRouterBuzzinModel: getOpenRouterBuzzinModel(),
    notificationPreview: buildNotificationData({
      session_id: "123456",
      class_name: "Example class",
      teacher_name: "Example teacher",
    }),
    studentDatabase: scoreStore.getStats(),
  };
}

async function parseInworldResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { message: text || res.statusText };
  }
}

function inworldErrorMessage(data, status) {
  return data?.message || data?.error?.message || `Inworld API returned ${status}.`;
}

async function inworldTtsSynthesize(apiKey, text, voiceId = INWORLD_BUZZIN_TTS_VOICE_ID) {
  const key = String(apiKey || "").trim();
  const trimmed = String(text || "").trim();
  if (!key) {
    throw new Error("Inworld API key not configured.");
  }
  if (!trimmed) {
    throw new Error("No text to synthesize.");
  }

  const res = await fetch(`${INWORLD_API_BASE}/tts/v1/voice`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: trimmed,
      voiceId: String(voiceId || INWORLD_BUZZIN_TTS_VOICE_ID).trim() || INWORLD_BUZZIN_TTS_VOICE_ID,
      modelId: INWORLD_TTS_MODEL_ID,
      audioConfig: {
        audioEncoding: "MP3",
        sampleRateHertz: 24000,
      },
    }),
  });
  const data = await parseInworldResponse(res);

  if (!res.ok) {
    throw new Error(`TTS: ${inworldErrorMessage(data, res.status)}`);
  }

  const audioContent = String(data?.audioContent || "").trim();
  if (!audioContent) {
    throw new Error("TTS: No audio returned.");
  }

  return { audioContent, format: "mp3" };
}

async function testInworldTts(apiKey) {
  const started = Date.now();
  const sample = await inworldTtsSynthesize(apiKey, "Inworld TTS is working.", INWORLD_BUZZIN_TTS_VOICE_ID);
  return {
    ok: true,
    latencyMs: Date.now() - started,
    voiceId: INWORLD_BUZZIN_TTS_VOICE_ID,
    modelId: INWORLD_TTS_MODEL_ID,
    audioBytes: Buffer.from(sample.audioContent, "base64").length,
    format: sample.format,
  };
}

async function testInworldStt(apiKey) {
  const modelId = getInworldSttModel();
  const language = getInworldSttLanguage();
  const started = Date.now();
  const tts = await inworldTtsSynthesize(apiKey, "Buzz In speech to text test.");
  const transcript = await transcribeBuzzinAudioWithInworld(
    tts.audioContent,
    tts.format,
    apiKey
  );
  return {
    ok: true,
    modelId,
    language,
    latencyMs: Date.now() - started,
    transcript: transcript.slice(0, 200),
  };
}

async function inworldLlmComplete(apiKey, model, messages, maxTokens = 256) {
  const llmModel = String(model || "auto").trim() || "auto";
  const res = await fetch(`${INWORLD_API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: llmModel,
      messages,
      max_tokens: maxTokens,
    }),
  });
  const data = await parseInworldResponse(res);

  if (!res.ok) {
    throw new Error(`LLM (${llmModel}): ${inworldErrorMessage(data, res.status)}`);
  }

  return data?.choices?.[0]?.message?.content?.trim?.() || "";
}

async function testInworldLlm(apiKey, model) {
  const llmModel = String(model || "auto").trim() || "auto";
  const started = Date.now();
  const reply = await inworldLlmComplete(
    apiKey,
    llmModel,
    [{ role: "user", content: "Reply with exactly: OK" }],
    16
  );
  return {
    ok: true,
    model: llmModel,
    latencyMs: Date.now() - started,
    reply: reply.slice(0, 200),
    usage: null,
  };
}

async function testInworldApiKey(apiKey, llmModel) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("No Inworld API key to test. Enter a key or set INWORLD_API_KEY.");
  }

  const started = Date.now();
  const [tts, llm, stt] = await Promise.all([
    testInworldTts(key),
    testInworldLlm(key, llmModel),
    testInworldStt(key),
  ]);

  return {
    ok: true,
    latencyMs: Date.now() - started,
    tts,
    llm,
    stt,
  };
}

function qwenErrorMessage(data, status) {
  return (
    data?.error?.message ||
    data?.message ||
    data?.code ||
    `Qwen API returned ${status}.`
  );
}

async function qwenLlmComplete(apiKey, model, messages, maxTokens = 256) {
  const qwenModel = String(model || "qwen-plus").trim() || "qwen-plus";
  const res = await fetch(`${QWEN_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: qwenModel,
      messages,
      max_tokens: maxTokens,
    }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || res.statusText };
  }

  if (!res.ok) {
    throw new Error(`LLM (${qwenModel}): ${qwenErrorMessage(data, res.status)}`);
  }

  return data?.choices?.[0]?.message?.content?.trim?.() || "";
}

async function testQwenLlm(apiKey, model) {
  const qwenModel = String(model || "qwen-plus").trim() || "qwen-plus";
  const started = Date.now();
  const reply = await qwenLlmComplete(
    apiKey,
    qwenModel,
    [{ role: "user", content: "Reply with exactly: OK" }],
    16
  );
  return {
    ok: true,
    model: qwenModel,
    latencyMs: Date.now() - started,
    reply: reply.slice(0, 200),
    usage: null,
  };
}

async function testQwenApiKey(apiKey, model) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("No Qwen API key to test. Enter a key or set QWEN_API_KEY.");
  }

  const started = Date.now();
  const llm = await testQwenLlm(key, model);

  return {
    ok: true,
    latencyMs: Date.now() - started,
    llm,
  };
}

async function testOpenRouterBuzzinModel(apiKey, model) {
  const key = String(apiKey || getOpenRouterApiKey() || "").trim();
  if (!key) {
    throw new Error("OpenRouter is not configured. Add an API key in Config.");
  }

  const buzzinModel =
    String(model || getOpenRouterBuzzinModel() || TRANSCRIBE_DEFAULT_MODEL).trim() ||
    TRANSCRIBE_DEFAULT_MODEL;
  const started = Date.now();
  const res = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getPublicBaseUrl(),
      "X-Title": "Lango Buzz In",
    },
    body: JSON.stringify({
      model: buzzinModel,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_tokens: 16,
    }),
  });
  const data = await parseOpenRouterResponse(res);
  if (!res.ok) {
    throw new Error(`LLM (${buzzinModel}): ${openRouterErrorMessage(data, res.status)}`);
  }

  const reply = data?.choices?.[0]?.message?.content?.trim?.() || "";
  return {
    ok: true,
    model: buzzinModel,
    latencyMs: Date.now() - started,
    reply: reply.slice(0, 200),
  };
}

app.get("/api/config", (_req, res) => {
  return res.json(buildConfigResponse());
});

app.put("/api/config", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const {
    publicBaseUrl,
    inworldApiKey,
    inworldLlmModel,
    inworldSttModel,
    inworldSttLanguage,
    qwenApiKey,
    qwenModel,
    openrouterApiKey,
    openrouterBuzzinModel,
  } = req.body || {};
  const updates = {};

  if (publicBaseUrl !== undefined) {
    try {
      updates.publicBaseUrl =
        publicBaseUrl == null || publicBaseUrl === ""
          ? ""
          : normalizePublicBaseUrl(publicBaseUrl);
    } catch (err) {
      return res.status(400).json({ message: err.message || "Invalid URL." });
    }
  }

  if (inworldApiKey !== undefined) {
    updates.inworldApiKey = String(inworldApiKey || "").trim();
  }

  if (inworldLlmModel !== undefined) {
    updates.inworldLlmModel = String(inworldLlmModel || "").trim();
  }

  if (inworldSttModel !== undefined) {
    updates.inworldSttModel = String(inworldSttModel || "").trim();
  }

  if (inworldSttLanguage !== undefined) {
    updates.inworldSttLanguage = String(inworldSttLanguage || "").trim();
  }

  if (qwenApiKey !== undefined) {
    updates.qwenApiKey = String(qwenApiKey || "").trim();
  }

  if (qwenModel !== undefined) {
    updates.qwenModel = String(qwenModel || "").trim();
  }

  if (openrouterApiKey !== undefined) {
    updates.openrouterApiKey = String(openrouterApiKey || "").trim();
  }

  if (openrouterBuzzinModel !== undefined) {
    updates.openrouterBuzzinModel = String(openrouterBuzzinModel || "").trim();
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: "No settings to update." });
  }

  settingsStore.writeSettings(updates);
  return res.json({ ok: true, ...buildConfigResponse() });
});

app.post("/api/config/test-inworld", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const bodyKey = req.body?.inworldApiKey;
  const bodyModel = req.body?.inworldLlmModel;
  const keyToTest =
    bodyKey != null && String(bodyKey).trim()
      ? String(bodyKey).trim()
      : getInworldApiKey();
  const modelToTest =
    bodyModel != null && String(bodyModel).trim()
      ? String(bodyModel).trim()
      : getInworldLlmModel();

  try {
    const result = await testInworldApiKey(keyToTest, modelToTest);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message || "Inworld API test failed." });
  }
});

app.post("/api/config/test-qwen", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const bodyKey = req.body?.qwenApiKey;
  const bodyModel = req.body?.qwenModel;
  const keyToTest =
    bodyKey != null && String(bodyKey).trim()
      ? String(bodyKey).trim()
      : getQwenApiKey();
  const modelToTest =
    bodyModel != null && String(bodyModel).trim()
      ? String(bodyModel).trim()
      : getQwenModel();

  try {
    const result = await testQwenApiKey(keyToTest, modelToTest);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message || "Qwen API test failed." });
  }
});

app.post("/api/config/test-openrouter", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const bodyKey = req.body?.openrouterApiKey;
  const bodyModel = req.body?.openrouterBuzzinModel;
  const keyToTest =
    bodyKey != null && String(bodyKey).trim()
      ? String(bodyKey).trim()
      : getOpenRouterApiKey();
  const modelToTest =
    bodyModel != null && String(bodyModel).trim()
      ? String(bodyModel).trim()
      : getOpenRouterBuzzinModel();

  try {
    const result = await testOpenRouterBuzzinModel(keyToTest, modelToTest);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message || "OpenRouter API test failed." });
  }
});

app.post("/api/config/clear-student-database", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const cleared = scoreStore.clearAll();
  return res.json({
    ok: true,
    cleared,
    studentDatabase: scoreStore.getStats(),
  });
});

app.post("/api/transcribe/test", async (req, res) => {
  const model = String(req.body?.model || "").trim();

  try {
    const result = await testOpenRouterBuzzinModel(null, model || undefined);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message || "OpenRouter API test failed." });
  }
});

app.post("/api/transcribe/audio", (req, res) => {
  transcribeUpload.single("audio")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed." });
    }

    const model = String(req.body?.model || "").trim();
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "Choose an audio file first." });
    }

    try {
      const format = audioFormatFromFilename(file.originalname);
      const text = await transcribeOpenRouterAudio({
        model: model || undefined,
        audioBuffer: file.buffer,
        format,
        prompt: TRANSCRIBE_PROMPT,
      });
      return res.json({ ok: true, text });
    } catch (transcribeErr) {
      return res.status(400).json({
        message: transcribeErr.message || "Transcription failed.",
        details: transcribeErr.openRouterDetails || null,
      });
    }
  });
});

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
  if (!classItem?.id || !user?.id) {
    return res.status(400).json({
      message: "class and user with id are required.",
    });
  }

  const sessionId = generateRoomId();
  sessionStore.createSession({
    roomId: sessionId,
    teacherId: user.id,
    classId: classItem.id,
    courseId: course?.id || null,
    exercise,
    classItem,
    course,
    authToken: token,
  });

  const notifyBody = {
    class_id: classItem.id,
    title: course?.id ? courseDisplayName(course) : classItem.name || "Class session",
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
    return res.status(201).json({
      sessionId,
      roomId: sessionId,
      notification: notifyBody,
      notificationSent: false,
      notificationWarning: data?.message || "Waiting room created, but the notification failed.",
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

app.post("/api/session/end", async (req, res) => {
  const token = pickToken(req);
  if (!token) return res.status(401).json({ message: "Missing auth token." });

  const { roomId, class: classItem, user } = req.body || {};
  const pin = normalizeRoomId(roomId);
  if (!pin) {
    return res.status(400).json({ message: "roomId is required." });
  }

  const session = sessionStore.getSession(pin);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  if (user?.id && session.teacherId !== user.id) {
    return res.status(403).json({ message: "Not allowed to end this session." });
  }

  const classId = classItem?.id || session.classId;
  const className = session.className || classItem?.name || `Class ${classId}`;
  const notifyBody = {
    class_id: classId,
    title: className,
    body: "End",
    data: buildNotificationData({
      session_id: pin,
      body: "End",
      class_name: className,
      teacher_name: teacherDisplayName(user || { id: session.teacherId }),
    }),
  };

  const { ok, data } = await langoRequest("POST", "/whiteboard/sendNotification", {
    token: session.authToken || token,
    body: notifyBody,
  });

  const game = games.get(pin);
  if (game) {
    clearQuestionTimer(game);
    games.delete(pin);
  }
  clearBuzzInRound(pin);
  endSession(pin, "Class session ended");

  return res.json({
    ok: true,
    roomId: pin,
    notification: notifyBody,
    notificationSent: ok,
    notificationWarning: ok ? undefined : data?.message || "Session ended, but the notification failed.",
    apiResponse: data,
  });
});

app.get("/api/host/progress", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const classId = Number(req.query.classId);
  const courseId = Number(req.query.courseId);
  if (!Number.isFinite(classId) || !Number.isFinite(courseId)) {
    return res.status(400).json({ message: "classId and courseId query parameters are required." });
  }

  return res.json({
    progress: hostProgressStore.getProgress(auth.teacherId, classId, courseId),
  });
});

app.put("/api/host/progress", async (req, res) => {
  const auth = await requireCmsAuth(req, res);
  if (!auth) return;

  const classId = Number(req.body?.classId);
  const courseId = Number(req.body?.courseId);
  if (!Number.isFinite(classId) || !Number.isFinite(courseId)) {
    return res.status(400).json({ message: "classId and courseId are required." });
  }

  const patch = {};
  if (req.body?.completedExerciseIds != null) {
    patch.completedExerciseIds = req.body.completedExerciseIds;
  }
  if (req.body?.visitedSectionIds != null) {
    patch.visitedSectionIds = req.body.visitedSectionIds;
  }
  if (req.body?.lastSectionId !== undefined) {
    patch.lastSectionId = req.body.lastSectionId;
  }
  if (req.body?.lastExerciseId !== undefined) {
    patch.lastExerciseId = req.body.lastExerciseId;
  }

  const progress = hostProgressStore.upsertProgress(auth.teacherId, classId, courseId, patch);
  return res.json({ progress });
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

app.use("/uploads", express.static(paths.uploadsRoot));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.redirect("/host.html");
});

app.get("/api/network-urls", (_req, res) => {
  res.json({ port: PORT, addresses: getLocalIPv4(), publicBaseUrl: getPublicBaseUrl() });
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

    let playerId = String(userId || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64);
    if (!playerId) playerId = sessionStore.generateParticipantId();

    const name = resolveSessionParticipantName(session, { displayName, nickname, userId: playerId });
    if (!name) {
      callback?.({ ok: false, error: "Enter your name." });
      return;
    }

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

    if (!session.exercise?.id) {
      callback?.({ ok: false, error: "Select an exercise before starting the class." });
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

  socket.on("select_session_exercise", ({ roomId, exercise, course }, callback) => {
    const meta = socketMeta.get(socket.id);
    const pin = normalizeRoomId(roomId) || meta?.pin;
    if (!meta || meta.role !== "host" || !pin) {
      callback?.({ ok: false, error: "Only the host can select an exercise." });
      return;
    }

    const session = sessionStore.getSession(pin);
    if (!session) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (!sessionStore.updateExercise(session, exercise, course)) {
      callback?.({ ok: false, error: "Select a valid exercise." });
      return;
    }

    callback?.({
      ok: true,
      roomId: pin,
      status: session.status,
      exercise: session.exercise,
    });
  });

  socket.on("start_buzzin_round", ({ roomId }, callback) => {
    const meta = socketMeta.get(socket.id);
    const pin = normalizeRoomId(roomId) || meta?.pin;
    if (!meta || meta.role !== "host" || !pin) {
      callback?.({ ok: false, error: "Only the host can start a buzz-in round." });
      return;
    }

    const session = sessionStore.getSession(pin);
    if (!session) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    const topic = buzzinTopicFromExercise(session.exercise);
    const round = createBuzzInRound(pin, topic);
    const payload = buzzInPublicPayload(round);
    socket.join(pin);
    io.to(pin).emit("buzzin_round_started", payload);
    callback?.({ ok: true, ...payload });
  });

  socket.on("buzz_in", (_data, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || meta.role !== "session_player" || !meta.playerId || !meta.pin) {
      callback?.({ ok: false, error: "Join the class waiting room first." });
      return;
    }

    const round = buzzInRounds.get(meta.pin);
    if (!round || round.phase !== "join" || round.status !== "open") {
      callback?.({ ok: false, error: "Buzz in is closed." });
      return;
    }

    if (Date.now() >= round.joinEndsAt) {
      callback?.({ ok: false, error: "Buzz in time is up." });
      return;
    }

    if (round.buzzes.some((b) => b.playerId === meta.playerId)) {
      callback?.({ ok: false, error: "You already buzzed in." });
      return;
    }

    if (round.buzzes.length >= BUZZIN_WINNER_COUNT) {
      callback?.({ ok: false, error: "Someone already buzzed in." });
      return;
    }

    const session = sessionStore.getSession(meta.pin);
    const participant = session?.participants.get(meta.playerId);
    const displayName = participant?.displayName || "Student";
    const rank = round.buzzes.length + 1;

    round.buzzes.push({
      playerId: meta.playerId,
      displayName,
      rank,
      at: Date.now(),
    });

    if (round.buzzes.length >= BUZZIN_WINNER_COUNT) {
      closeBuzzInJoinWindow(meta.pin);
    } else {
      broadcastBuzzInUpdate(meta.pin);
    }

    callback?.({
      ok: true,
      rank,
      selected: rank <= BUZZIN_WINNER_COUNT,
      roundId: round.roundId,
    });
  });

  socket.on("transcribe_buzzin_audio", async ({ audioBase64, format }, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || meta.role !== "session_player" || !meta.playerId || !meta.pin) {
      callback?.({ ok: false, error: "Join the class waiting room first." });
      return;
    }

    const round = buzzInRounds.get(meta.pin);
    if (!round || round.phase !== "typing") {
      callback?.({ ok: false, error: "It is not your turn to answer yet." });
      return;
    }

    const current = buzzInCurrentTurn(round);
    if (!current || current.playerId !== meta.playerId) {
      callback?.({ ok: false, error: "It is not your turn to answer yet." });
      return;
    }

    try {
      const text = await transcribeBuzzinAudio(audioBase64, format);
      callback?.({ ok: true, text });
    } catch (err) {
      callback?.({ ok: false, error: err.message || "Transcription failed." });
    }
  });

  socket.on("submit_buzzin_response", async ({ text, audioBase64, format }, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || meta.role !== "session_player" || !meta.playerId || !meta.pin) {
      callback?.({ ok: false, error: "Join the class waiting room first." });
      return;
    }

    const round = buzzInRounds.get(meta.pin);
    if (!round || round.phase !== "typing") {
      callback?.({ ok: false, error: "It is not your turn to answer yet." });
      return;
    }

    const current = buzzInCurrentTurn(round);
    if (!current || current.playerId !== meta.playerId) {
      callback?.({ ok: false, error: "It is not your turn to answer yet." });
      return;
    }

    if (round.responses.some((r) => r.playerId === meta.playerId)) {
      callback?.({ ok: false, error: "You already submitted an answer." });
      return;
    }

    let trimmed = String(text || "").trim();
    if (!trimmed && audioBase64) {
      try {
        trimmed = await transcribeBuzzinAudio(audioBase64, format);
      } catch (err) {
        callback?.({ ok: false, error: err.message || "Transcription failed." });
        return;
      }
    }

    if (!trimmed) {
      callback?.({ ok: false, error: "Record your answer before submitting." });
      return;
    }
    if (trimmed.length > BUZZIN_RESPONSE_MAX_LEN) {
      callback?.({ ok: false, error: `Answer must be ${BUZZIN_RESPONSE_MAX_LEN} characters or fewer.` });
      return;
    }

    round.responses.push({
      playerId: meta.playerId,
      displayName: current.displayName,
      rank: current.rank,
      text: trimmed,
      at: Date.now(),
      analysis: null,
      analysisStatus: "pending",
      analysisAudio: null,
      analysisAudioFormat: null,
    });

    advanceBuzzInTurn(meta.pin);
    callback?.({ ok: true, ...buzzInPublicPayload(round) });

    void analyzeAndAttachBuzzinResponse(meta.pin, meta.playerId, {
      topic: round.topic,
      studentName: current.displayName,
      responseText: trimmed,
    });
  });

  socket.on("get_buzzin_state", ({ roomId }, callback) => {
    const meta = socketMeta.get(socket.id);
    const pin = normalizeRoomId(roomId) || meta?.pin;
    if (!pin) {
      callback?.({ ok: false, error: "Invalid room." });
      return;
    }

    const round = buzzInRounds.get(pin);
    if (!round) {
      callback?.({ ok: true, active: false });
      return;
    }

    callback?.({ ok: true, active: true, ...buzzInPublicPayload(round) });
  });

  socket.on("end_room_exercise", ({ roomId, exerciseId, exerciseType }, callback) => {
    const meta = socketMeta.get(socket.id);
    const pin = normalizeRoomId(roomId) || meta?.pin;
    if (!meta || meta.role !== "host" || !pin) {
      callback?.({ ok: false, error: "Only the host can end an exercise." });
      return;
    }

    const session = sessionStore.getSession(pin);
    if (!session) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    const finishedExercise = resolveFinishedExercise(session, { exerciseId, exerciseType });
    let exerciseLeaderboard = null;
    if (isVideoExercise(finishedExercise)) {
      const result = persistVideoExerciseScores(session, finishedExercise);
      exerciseLeaderboard = getVideoExerciseLeaderboard(session, finishedExercise);
      if (result?.saved > 0) {
        console.log(
          `[scores] Saved ${result.saved} video score(s) for class ${session.classId} exercise ${finishedExercise.id} (room ${pin})`
        );
      }
    }

    const payload = buildExerciseFinishedPayload(pin, { exerciseLeaderboard });
    if (session.status === "waiting") {
      callback?.({ ok: true, ...payload });
      return;
    }

    const game = games.get(pin);
    if (game) {
      clearQuestionTimer(game);
      games.delete(pin);
    }
    clearBuzzInRound(pin);
    sessionStore.waitSession(session);
    io.to(pin).emit("room_exercise_wrap_up", payload);
    broadcastSessionLobby(session);
    callback?.({ ok: true, ...payload });
  });

  socket.on("start_next_exercise", ({ roomId, exercise, course }, callback) => {
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

    if (!sessionStore.updateExercise(session, exercise, course)) {
      callback?.({ ok: false, error: "Could not update exercise." });
      return;
    }

    const activeGame = games.get(pin);
    if (activeGame) {
      clearQuestionTimer(activeGame);
      games.delete(pin);
    }
    clearBuzzInRound(pin);

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
    game.players.set(playerId, { id: playerId, name, score: 0, correctAnswers: 0 });
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

    setTimeout(() => startQuestion(game), game.fastMode ? 2000 : 0);
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
      correctAnswers: existing?.correctAnswers || 0,
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
    } else if (game.status === "preview" || game.status === "question") {
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
    const question = game.quiz.questions[game.currentQuestionIndex];
    const optionCount = question?.options?.length || 0;
    if (!Number.isInteger(idx) || idx < 0 || idx >= optionCount) return;

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

server.listen(PORT, "0.0.0.0", () => {
  const base = `http://localhost:${PORT}`;
  const networkBase = `http://${getLocalIPv4()[0] || "localhost"}:${PORT}`;
  console.log(`QuizLive running at ${base}`);
  console.log(`  Host: ${base}/host.html`);
  console.log(`  CMS:  ${base}/cms.html`);
  console.log(`  Join: ${base}/join.html`);
  console.log(`  Phone/tablet: ${networkBase}/join.html`);
});
