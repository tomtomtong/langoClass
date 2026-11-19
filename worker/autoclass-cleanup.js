// Removes autoclass render folders (uploads/autoclass/<lessonId>/<renderId>/) nobody plays any more.
//
//   - The published render is never touched.
//   - A render that was published and then replaced (lesson.retired) is kept for GRACE_MS after it was
//     replaced: a class that started on it loads the video once but still fetches Tommy's lines from
//     its folder while it runs.
//   - A render that was never published (failed, saved only part way, or finished after a newer one)
//     is removed once its newest file is GRACE_MS old; nothing plays it, and by then its job has
//     long stopped (a job is held to 75 minutes).
//   - Only folders named like a render id are touched, so nothing else under the lesson is.
//
// Runs after each publish (autoclass-job.js), every hour from the cron trigger (index.js
// scheduled), and on POST /api/autoclass/lessons/:id/cleanup.
import { MEDIA_PREFIX, lessonDocName, readLesson, writeLesson } from "./autoclass-lessons.js";

export const GRACE_MS = 6 * 60 * 60 * 1000;
const RENDER_ID = /^[a-f0-9]{32}$/;
const DELETE_BATCH = 1000;

// → { deleted: [renderId], kept: [renderId], files }
export async function cleanLessonRenders(env, lessonId, { now = Date.now(), graceMs = GRACE_MS } = {}) {
  const lesson = await readLesson(env, lessonId);
  if (!lesson || !env.UPLOADS) return { deleted: [], kept: [], files: 0 };
  const published = lesson.published?.renderId || null;
  const retiredAt = new Map((lesson.retired || []).map((r) => [r.renderId, Date.parse(r.at) || 0]));

  const folders = await renderFolders(env.UPLOADS, lessonId);
  const deleted = [];
  const kept = [];
  let files = 0;
  for (const [renderId, folder] of folders) {
    const since = retiredAt.has(renderId) ? retiredAt.get(renderId) : folder.newest;
    if (renderId === published || now - since < graceMs) {
      kept.push(renderId);
      continue;
    }
    for (let i = 0; i < folder.keys.length; i += DELETE_BATCH) await env.UPLOADS.delete(folder.keys.slice(i, i + DELETE_BATCH));
    files += folder.keys.length;
    deleted.push(renderId);
  }

  // Forget retired renders whose folder is gone. Re-read first: a publish may have run meanwhile.
  if (lesson.retired?.length) {
    const fresh = await readLesson(env, lessonId);
    const left = (fresh?.retired || []).filter((r) => folders.has(r.renderId) && !deleted.includes(r.renderId));
    if (fresh && left.length !== (fresh.retired || []).length) {
      fresh.retired = left;
      await writeLesson(env, fresh);
    }
  }
  if (deleted.length) {
    console.log(JSON.stringify({ message: "autoclass_renders_cleaned", lessonId, deleted, files }));
  }
  return { deleted, kept, files };
}

// Every lesson's renders, for the cron trigger. One lesson failing does not stop the others.
export async function cleanAllRenders(env, options) {
  const { results = [] } = await env.DB.prepare("SELECT name FROM documents WHERE name LIKE ?")
    .bind(`${lessonDocName("")}%`)
    .all();
  const summary = { lessons: 0, deleted: 0, files: 0, failed: 0 };
  for (const { name } of results) {
    const lessonId = name.slice(lessonDocName("").length);
    try {
      const result = await cleanLessonRenders(env, lessonId, options);
      summary.lessons += 1;
      summary.deleted += result.deleted.length;
      summary.files += result.files;
    } catch (error) {
      summary.failed += 1;
      console.error(JSON.stringify({ message: "autoclass_clean_failed", lessonId, error: String(error?.message || error) }));
    }
  }
  return summary;
}

// Map renderId → { keys, newest (ms) } for every render folder of a lesson.
async function renderFolders(bucket, lessonId) {
  const prefix = `${MEDIA_PREFIX}/${lessonId}/`;
  const folders = new Map();
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects || []) {
      const [renderId, ...rest] = object.key.slice(prefix.length).split("/");
      if (!RENDER_ID.test(renderId) || !rest.length) continue;
      const folder = folders.get(renderId) || { keys: [], newest: 0 };
      folder.keys.push(object.key);
      // No upload time (should not happen in R2) counts as just now, so it is kept.
      const at = object.uploaded ? new Date(object.uploaded).getTime() : NaN;
      folder.newest = Math.max(folder.newest, Number.isFinite(at) ? at : Infinity);
      folders.set(renderId, folder);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return folders;
}
