// Autoclass lesson scripts in D1 (docs/autoclass-step2-plan.md): one `documents` row per lesson,
// apart from the course document, which links to it with a section item
// { type: "autoclass", items: [{ lessonId }] }.
//
//   { id, teacherId, script, createdAt, updatedAt,
//     render:    { jobId, scriptHash, startedAt }        the latest render job
//     published: { renderId, scriptHash, mediaUrl, at }  the render the autoclass page plays }
import { readDoc, writeDoc } from "./d1-store.js";

export const MEDIA_PREFIX = "uploads/autoclass";
// Every line Tommy has said for any lesson, by voiceKey (video-container/voice.mjs). Lesson ids
// cannot start with "_", so this never meets a lesson folder.
export const VOICE_CACHE_PREFIX = `${MEDIA_PREFIX}/_voice`;

export function lessonDocName(lessonId) {
  return `autoclass-lesson:${lessonId}`;
}

export function readLesson(env, lessonId) {
  return readDoc(env, lessonDocName(lessonId), null);
}

export function writeLesson(env, lesson) {
  return writeDoc(env, lessonDocName(lesson.id), lesson);
}

// Where one render's files live: R2 key prefix and the URL the page loads them from.
export function renderFolder(lessonId, renderId) {
  const key = `${MEDIA_PREFIX}/${lessonId}/${renderId}`;
  return { key, url: `/${key}` };
}

// Points the lesson at a finished render. Re-reads the row so a script saved during the render is
// kept; an older render finishing late never replaces a newer published one.
export async function publishRender(env, lessonId, published) {
  const lesson = await readLesson(env, lessonId);
  if (!lesson) return null;
  const current = lesson.published;
  if (current?.startedAt && published.startedAt && current.startedAt > published.startedAt) return lesson;
  lesson.published = published;
  await writeLesson(env, lesson);
  return lesson;
}

export async function scriptHash(script) {
  const bytes = new TextEncoder().encode(JSON.stringify(script));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
