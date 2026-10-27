// Course banner, section banner, section intro video, and question image
// uploads. The file goes to R2 and the course in D1 points at it, as server.js
// did with its disk and JSON store.
import { deleteUpload, extensionOf, randomPart, storeUpload, uploadUrl } from "./course-files.js";
import { json, readDoc, requireTeacher, sameId, writeDoc } from "./d1-store.js";

const IMAGE_BYTES = 2 * 1024 * 1024;
const VIDEO_BYTES = 250 * 1024 * 1024;
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"]);
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif)$/i;

export async function handleCourseMediaApi(request, env, url) {
  if (request.method.toUpperCase() !== "POST") return null;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const banner = pathname.match(/^\/api\/cms\/courses\/(-?\d+)\/banner$/);
  const sectionBanner = pathname.match(/^\/api\/cms\/courses\/(-?\d+)\/sections\/([^/]+)\/banner$/);
  const introVideo = pathname.match(/^\/api\/cms\/courses\/(-?\d+)\/sections\/([^/]+)\/intro-video$/);
  const courseQuestion = pathname.match(/^\/api\/cms\/courses\/(-?\d+)\/question-image$/);
  const question = pathname === "/api/cms/question-image";
  if (!banner && !sectionBanner && !introVideo && !courseQuestion && !question) return null;

  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  if (question) return questionImage(request, env, null);
  if (courseQuestion) {
    const courseId = Number(courseQuestion[1]);
    if (!(await findCourse(env, courseId, auth.teacherId))) return json({ message: "Course not found." }, 404);
    return questionImage(request, env, courseId);
  }
  if (banner) return courseBanner(request, env, auth, Number(banner[1]));
  if (sectionBanner) return sectionBannerUpload(request, env, auth, Number(sectionBanner[1]), Number(sectionBanner[2]));
  return introVideoUpload(request, env, auth, Number(introVideo[1]), Number(introVideo[2]));
}

async function courseBanner(request, env, auth, courseId) {
  if (!(await findCourse(env, courseId, auth.teacherId))) return json({ message: "Course not found." }, 404);
  const image = await readImage(request, "banner");
  if (image instanceof Response) return image;

  const url = uploadUrl("courses", `course-${courseId}-${Date.now()}${pickExt(image.name, IMAGE_EXTS, ".jpg")}`);
  await storeUpload(env, url, await image.arrayBuffer(), { contentType: image.type });

  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const course = ownCourse(store, courseId, auth.teacherId);
  if (!course) {
    await deleteUpload(env, url);
    return json({ message: "Course not found." }, 404);
  }
  const oldBanner = course.banner;
  course.banner = url;
  course.updatedAt = new Date().toISOString();
  await writeDoc(env, "teacher-courses", store);
  if (oldBanner && oldBanner !== url) await deleteUpload(env, oldBanner);
  return json({
    url,
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
}

// The CMS puts the returned URL into an exercise item and saves it with the
// sections, so nothing in D1 changes here. The file name follows server.js:
// the teacher id header, else the course id.
async function questionImage(request, env, courseId) {
  const image = await readImage(request, "image");
  if (image instanceof Response) return image;
  const owner = String(request.headers.get("x-teacher-id") || courseId || "upload").replace(/\W/g, "") || "upload";
  const url = uploadUrl("questions", `question-${owner}-${Date.now()}${pickExt(image.name, IMAGE_EXTS, ".jpg")}`);
  await storeUpload(env, url, await image.arrayBuffer(), { contentType: image.type });
  return json({ url });
}

// A section that is not saved yet still gets its file, as on Node: the CMS
// sends the URL with the next section save.
async function sectionBannerUpload(request, env, auth, courseId, sectionId) {
  if (!(await findCourse(env, courseId, auth.teacherId))) return json({ message: "Course not found." }, 404);
  const image = await readImage(request, "banner");
  if (image instanceof Response) return image;

  const url = uploadUrl(
    "sections",
    `section-${courseId}-${Number.isFinite(sectionId) ? sectionId : "new"}-${Date.now()}${pickExt(image.name, IMAGE_EXTS, ".jpg")}`
  );
  await storeUpload(env, url, await image.arrayBuffer(), { contentType: image.type });
  const updated = await updateSection(env, auth.teacherId, courseId, sectionId, "banner", url);
  if (updated?.old && updated.old !== url) await deleteUpload(env, updated.old);
  return json({
    url,
    section: updated?.section || { id: sectionId, banner: url },
    updatedAt: updated?.updatedAt || null,
  });
}

async function introVideoUpload(request, env, auth, courseId, sectionId) {
  const course = await findCourse(env, courseId, auth.teacherId);
  if (!course) return json({ message: "Course not found." }, 404);
  if (!(course.sections || []).some((section) => section.id === sectionId)) {
    return json({ message: "Section not found." }, 404);
  }

  let file;
  try {
    file = await streamFormFile(request, "video", VIDEO_BYTES);
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Upload failed." }, 400);
  }
  const ext = pickExt(file.filename, VIDEO_EXTS, "");
  if (!ext && !/^video\//i.test(file.contentType)) {
    await file.body.cancel();
    return json({ message: "Only MP4, MOV, WebM, MKV, M4V, or AVI videos are allowed." }, 400);
  }

  const url = uploadUrl("videos", `material-${Date.now()}-${randomPart()}${ext || ".mp4"}`);
  try {
    await storeUpload(env, url, file.body, { contentType: file.contentType || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save video.";
    const client = message.startsWith("Video is too large") || message === "No video file provided.";
    if (!client) {
      console.error(JSON.stringify({ message: "intro_video_store_failed", courseId, sectionId, error: message }));
    }
    return json({ message }, client ? 400 : 500);
  }

  const updated = await updateSection(env, auth.teacherId, courseId, sectionId, "introVideoUrl", url);
  if (!updated) {
    await deleteUpload(env, url);
    return json({ message: "Section not found." }, 404);
  }
  if (updated.old && updated.old !== url) await deleteUpload(env, updated.old);
  return json({ url, section: updated.section, updatedAt: updated.updatedAt });
}

function pickExt(name, allowed, fallback) {
  const ext = extensionOf(name);
  return allowed.has(ext) ? ext : fallback;
}

async function readImage(request, field) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > IMAGE_BYTES + 64 * 1024) {
    return json({ message: "Image file is too large (max 2 MB)." }, 400);
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "Upload failed." }, 400);
  }
  const file = form.get(field);
  if (!file || typeof file === "string") return json({ message: "No image file provided." }, 400);
  if (file.size > IMAGE_BYTES) return json({ message: "Image file is too large (max 2 MB)." }, 400);
  if (!IMAGE_TYPE.test(file.type || "")) {
    return json({ message: "Only JPEG, PNG, WebP, or GIF images are allowed." }, 400);
  }
  return file;
}

async function findCourse(env, courseId, teacherId) {
  return ownCourse(await readDoc(env, "teacher-courses", { courses: [] }), courseId, teacherId);
}

function ownCourse(store, courseId, teacherId) {
  return (store.courses || []).find((item) => item.id === courseId && sameId(item.teacherId, teacherId)) || null;
}

async function updateSection(env, teacherId, courseId, sectionId, field, value) {
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  const course = ownCourse(store, courseId, teacherId);
  const section = (course?.sections || []).find((item) => item.id === sectionId);
  if (!section) return null;
  const old = section[field] || "";
  section[field] = String(value || "").trim().slice(0, 500);
  course.updatedAt = new Date().toISOString();
  await writeDoc(env, "teacher-courses", store);
  return { section: { ...section }, old, updatedAt: course.updatedAt };
}

// Streams the named file out of a multipart body without buffering it. The
// CMS sends that file as the only field, so everything after its headers up
// to the closing boundary is the file.
export async function streamFormFile(request, field, maxBytes, messages = {}) {
  const missing = messages.missing || "No video file provided.";
  const tooLarge = messages.tooLarge || `Video is too large (max ${maxBytes / (1024 * 1024)} MB).`;
  const boundary = (request.headers.get("content-type") || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundary || !request.body) throw new Error("Upload failed.");
  const encoder = new TextEncoder();
  const opening = encoder.encode(`--${boundary[1] || boundary[2]}`);
  const closing = encoder.encode(`\r\n--${boundary[1] || boundary[2]}`);
  const reader = request.body.getReader();

  let head = new Uint8Array(0);
  let split = -1;
  while (split < 0) {
    const { value, done } = await reader.read();
    if (done) throw new Error(missing);
    head = concat(head, value);
    split = indexOf(head, encoder.encode("\r\n\r\n"), 0);
    if (split < 0 && head.length > 16 * 1024) throw new Error("Upload failed.");
  }
  if (indexOf(head, opening, 0) !== 0) throw new Error("Upload failed.");
  const headers = new TextDecoder().decode(head.subarray(opening.length, split));
  const name = headers.match(/name="([^"]*)"/i)?.[1];
  if (name !== field || !/filename="/i.test(headers)) {
    await reader.cancel();
    throw new Error(missing);
  }
  const filename = headers.match(/filename="([^"]*)"/i)?.[1] || "";
  const contentType = headers.match(/content-type:\s*([^\r\n;]+)/i)?.[1]?.trim() || "";

  let pending = head.subarray(split + 4);
  let sent = 0;
  let finished = false;
  const body = new ReadableStream({
    async pull(controller) {
      for (;;) {
        const at = indexOf(pending, closing, 0);
        if (at >= 0) {
          if (!finished) {
            finished = true;
            sent += at;
            if (sent === 0) return controller.error(new Error(missing));
            if (at) controller.enqueue(pending.slice(0, at));
            await reader.cancel().catch(() => {});
          }
          return controller.close();
        }
        const keep = closing.length - 1;
        if (pending.length > keep) {
          const out = pending.slice(0, pending.length - keep);
          pending = pending.slice(pending.length - keep);
          sent += out.length;
          if (sent > maxBytes) {
            await reader.cancel().catch(() => {});
            return controller.error(new Error(tooLarge));
          }
          controller.enqueue(out);
          return;
        }
        const { value, done } = await reader.read();
        if (done) return controller.error(new Error("Upload ended before the file did."));
        pending = concat(pending, value);
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
  return { filename, contentType, body };
}

function concat(left, right) {
  const chunk = right instanceof Uint8Array ? right : new Uint8Array(right);
  if (!left.length) return chunk;
  const out = new Uint8Array(left.length + chunk.length);
  out.set(left, 0);
  out.set(chunk, left.length);
  return out;
}

function indexOf(haystack, needle, from) {
  const first = needle[0];
  const last = haystack.length - needle.length;
  for (let i = from; i <= last; i += 1) {
    if (haystack[i] !== first) continue;
    let match = true;
    for (let j = 1; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}
