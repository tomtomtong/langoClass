// Speech from video and long audio, as lib/video-captions.js did on Node: the
// media container's ffmpeg cuts the sound into 25-second MP3 pieces, each
// piece goes through speech recognition, and the words become WebVTT cues.
// The container also shrinks lesson videos (lib/material-video-compress.js).
import webvtt from "../lib/webvtt.js";
import { transcribe, transcribeTimed } from "./ai.js";
import { openUpload, randomPart, storeUpload, uploadUrl } from "./course-files.js";

// The container reads at most this much (container/server.js MAX_BYTES).
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_TARGET_BYTES = 12 * 1024 * 1024;
const CHUNK_SECONDS = 25;

export class MediaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// [{ base64, format: "mp3", durationMs }] in playing order; [] when the file
// has no sound. body may be bytes or a stream.
export async function audioChunks(env, body) {
  const response = await mediaFetch(env, "/audio/chunks", body, { "x-chunk-seconds": String(CHUNK_SECONDS) });
  if (!response.ok) throw new MediaError(await failure(response, "Could not read the sound in this file."), 500);
  return (await response.json()).chunks || [];
}

// { bytes, compressed } — the original bytes when nothing smaller came out.
export async function compressVideo(env, bytes, filename, maxBytes = VIDEO_TARGET_BYTES) {
  if (bytes.byteLength <= maxBytes) return { bytes, compressed: false };
  const response = await mediaFetch(env, "/video/compress", bytes, {
    "x-max-bytes": String(maxBytes),
    "x-filename": filename,
  });
  if (!response.ok) throw new MediaError(await failure(response, "Video compression failed."), 500);
  return { bytes: await response.arrayBuffer(), compressed: response.headers.get("x-compressed") === "1" };
}

// Plain transcript of every piece, joined in order.
export async function transcribeMedia(env, body, language) {
  const chunks = await audioChunks(env, body);
  if (!chunks.length) throw new MediaError("No audio track found in this file.");
  const parts = [];
  for (const chunk of chunks) {
    const text = await transcribe(env, { audioBase64: chunk.base64, format: chunk.format, language, allowEmpty: true });
    if (text) parts.push(text);
  }
  if (!parts.length) throw new MediaError("Speech recognition found no speech in this file.");
  return parts.join(" ");
}

// { vtt, cueCount, wordCount } from a video or audio file.
export async function captionsFromMedia(env, body, language) {
  const chunks = await audioChunks(env, body);
  if (!chunks.length) throw new MediaError("No audio track found in this video.");
  const words = [];
  let offsetMs = 0;
  for (const chunk of chunks) {
    const durationMs = Number(chunk.durationMs) || CHUNK_SECONDS * 1000;
    const heard = await transcribeTimed(env, { audioBase64: chunk.base64, format: chunk.format, language });
    const timed = webvtt.normalizeWordTimestamps(heard.words, offsetMs);
    words.push(...(timed.length ? timed : webvtt.syntheticWordsFromTranscript(heard.text, offsetMs, durationMs)));
    offsetMs += durationMs;
  }
  const cues = webvtt.groupWordsIntoCues(words).filter((cue) => cue.text);
  if (!cues.length) throw new MediaError("Speech recognition found no speech in this video.");
  return { vtt: webvtt.cuesToWebVtt(cues), cueCount: cues.length, wordCount: words.length };
}

// Saves a caption file under /uploads/captions/ and returns its URL.
export async function storeCaptions(env, vtt) {
  const captionUrl = uploadUrl("captions", `captions-${Date.now()}-${randomPart(8)}.vtt`);
  await storeUpload(env, captionUrl, vtt, { contentType: "text/vtt" });
  return captionUrl;
}

// The video behind a videoUrl: an /uploads/ file in R2, or a direct http(s)
// link. Returns a stream so the Worker does not hold the whole file.
export async function openVideo(env, videoUrl) {
  const url = String(videoUrl || "").trim();
  const uploadPath = url.startsWith("/uploads/") ? url : ownUploadPath(url);
  if (uploadPath) {
    const stored = await openUpload(env, uploadPath);
    if (!stored) throw new MediaError("Could not find this video in storage.", 404);
    if (stored.size > MEDIA_MAX_BYTES) throw new MediaError(tooLarge());
    return stored.body;
  }
  if (!/^https?:\/\//i.test(url)) throw new MediaError("Video URL must be an /uploads/ file or an http(s) link.");
  if (isYouTube(url)) {
    throw new MediaError("YouTube links cannot be read here. Upload the video file or use a direct .mp4 link.");
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new MediaError(`Could not download video (${response.status}).`);
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/html")) {
    throw new MediaError("URL did not return a video file (got a web page). Upload the video or use a direct .mp4 link.");
  }
  if (Number(response.headers.get("content-length") || 0) > MEDIA_MAX_BYTES) throw new MediaError(tooLarge());
  return response.body;
}

export function tooLarge() {
  return `Video is too large (max ${MEDIA_MAX_BYTES / (1024 * 1024)} MB).`;
}

// /uploads/... when a full link points at this site's own uploads.
function ownUploadPath(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const own = host === "class.lango.ai" || host === "localhost" || host === "127.0.0.1";
    return own && parsed.pathname.startsWith("/uploads/") ? parsed.pathname : "";
  } catch {
    return "";
  }
}

function isYouTube(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

// Material work is spread over a few container instances so one teacher's
// heavy file does not hold up everyone else's. Requests carry all their data,
// so any instance can serve any request.
export const MEDIA_INSTANCES = 3;

export function mediaContainer(env) {
  return env.MEDIA.getByName(`media-${Math.floor(Math.random() * MEDIA_INSTANCES)}`);
}

async function mediaFetch(env, pathname, body, headers = {}) {
  if (!env.MEDIA) throw new MediaError("The media container is not configured.", 500);
  return mediaContainer(env).fetch(
    new Request(`http://container${pathname}`, {
      method: "POST",
      body,
      headers: { "content-type": "application/octet-stream", ...headers },
      duplex: "half",
    })
  );
}

async function failure(response, fallback) {
  const text = (await response.text().catch(() => "")).trim();
  try {
    return JSON.parse(text).message || fallback;
  } catch {
    return text ? `${fallback} (${text.slice(0, 300)})` : fallback;
  }
}
