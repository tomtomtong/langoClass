// Video caption files in R2, as server.js served them: upload a .vtt, read it
// for the editor, save edits back, or make them from a video's sound with the
// media container's ffmpeg and speech recognition (media-speech.js).
import webvtt from "../lib/webvtt.js";
import { openUpload, randomPart, storeUpload, uploadUrl } from "./course-files.js";
import { json, readJson, requireTeacher } from "./d1-store.js";
import { MediaError, captionsFromMedia, openVideo, storeCaptions } from "./media-speech.js";
import { uploadKey } from "./uploads.js";

const CAPTION_BYTES = 2 * 1024 * 1024;

export async function handleCaptionsApi(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, "");
  const route =
    (method === "POST" && path === "/api/cms/upload-video-captions" && uploadCaption) ||
    (method === "GET" && path === "/api/cms/video-captions" && readCaption) ||
    (method === "PUT" && path === "/api/cms/video-captions" && saveCaption) ||
    (method === "POST" && path === "/api/cms/generate-video-captions" && generateCaptions);
  if (!route) return null;
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  return route(request, env, url);
}

async function uploadCaption(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "No caption file provided." }, 400);
  }
  const file = form.get("caption");
  if (!file || typeof file === "string") return json({ message: "No caption file provided." }, 400);
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (!(name.endsWith(".vtt") || ["text/vtt", "text/plain", "application/octet-stream", ""].includes(type))) {
    return json({ message: "Only WebVTT (.vtt) caption files are allowed." }, 400);
  }
  if (file.size > CAPTION_BYTES) return json({ message: "File too large" }, 400);
  const text = await file.text();
  if (!/^WEBVTT/i.test(text.trim())) {
    return json({ message: "File must be a WebVTT caption (.vtt) starting with WEBVTT." }, 400);
  }
  const captionUrl = uploadUrl("captions", `upload-${Date.now()}-${randomPart(6)}.vtt`);
  await storeUpload(env, captionUrl, text, { contentType: "text/vtt" });
  return json({
    ok: true,
    captionUrl,
    language: captionLanguage(form.get("language")),
    cueCount: webvtt.parseWebVtt(text).length,
  });
}

async function readCaption(_request, env, url) {
  const captionUrl = String(url.searchParams.get("captionUrl") || "").trim();
  if (!captionUrl) return json({ message: "Caption URL is required." }, 400);
  try {
    const stored = editableKey(captionUrl) ? await openUpload(env, captionUrl) : null;
    let text;
    if (stored) {
      text = await new Response(stored.body).text();
    } else if (/^https?:\/\//i.test(captionUrl)) {
      const response = await fetch(captionUrl);
      if (!response.ok) throw new Error(`Could not read source captions (${response.status}).`);
      text = await response.text();
    } else {
      throw new Error("Could not read source captions (404).");
    }
    return json({ ok: true, captionUrl, text, cueCount: webvtt.parseWebVtt(text).length, editable: Boolean(stored) });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Could not load captions." }, 500);
  }
}

async function saveCaption(request, env) {
  const body = await readJson(request);
  const captionUrl = String(body?.captionUrl || "").trim();
  const text = String(body?.text ?? "");
  if (!captionUrl) return json({ message: "Caption URL is required." }, 400);
  const key = editableKey(captionUrl);
  if (!key || !(await env.UPLOADS.head(key))) {
    return json({ message: "Only /uploads/captions/ files stored here can be edited." }, 400);
  }
  if (!/^WEBVTT/i.test(text.trim())) {
    return json({ message: "Content must be a WebVTT file starting with WEBVTT." }, 400);
  }
  await storeUpload(env, captionUrl, text, { contentType: "text/vtt" });
  return json({ ok: true, captionUrl, cueCount: webvtt.parseWebVtt(text).length });
}

async function generateCaptions(request, env) {
  const body = await readJson(request);
  const videoUrl = String(body?.videoUrl || "").trim();
  if (!videoUrl) return json({ message: "Video URL is required." }, 400);
  const language = captionLanguage(body?.language);
  try {
    const captions = await captionsFromMedia(env, await openVideo(env, videoUrl), language);
    const captionUrl = await storeCaptions(env, captions.vtt);
    return json({ ok: true, captionUrl, language, cueCount: captions.cueCount, wordCount: captions.wordCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caption generation failed.";
    console.error(JSON.stringify({ message: "generate_video_captions_failed", error: message }));
    return json({ message: message || "Caption generation failed." }, error instanceof MediaError ? error.status : 500);
  }
}

function editableKey(captionUrl) {
  const key = uploadKey(captionUrl);
  return key && key.startsWith("uploads/captions/") ? key : "";
}

// server.js normalizeBuzzinSttLanguage with English as the fallback.
function captionLanguage(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase()
    .split("-")[0];
  return /^[a-z]{2,3}$/.test(code) ? code : "en";
}
