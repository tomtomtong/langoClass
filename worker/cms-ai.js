// CMS AI authoring, as server.js served it: exercise generation, revision,
// batch and plan-based course generation, the Ask Lango assistant, generated
// question images and path tiles, caption translation, and exercise JSON.
// The prompt and parsing code is shared with Node through lib/; the Worker
// supplies the model call (worker/ai.js) and keeps files in R2.
import exerciseGenerator from "../lib/exercise-generator.js";
import cmsAssistant from "../lib/cms-assistant.js";
import coursePlan from "../lib/course-plan.js";
import exerciseImport from "../lib/exercise-import.js";
import imageRefs from "../lib/material-image-refs.js";
import pathTilePrompt from "../lib/path-tile-prompt.js";
import webvtt from "../lib/webvtt.js";
import { completeText } from "./ai.js";
import { deleteUpload, openUpload, randomPart, storeUpload, uploadUrl } from "./course-files.js";
import { updateSection } from "./course-media.js";
import { json, readDoc, readJson, requireTeacher, sameId } from "./d1-store.js";

// Generations run several model calls; give each one well past the
// classroom's 40 second limit.
const GENERATE_TIMEOUT_MS = 180000;
const MAX_BATCH_SECTIONS = 20;
const IMAGE_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

const ROUTES = {
  "/api/cms/generate-exercises": generateExercises,
  "/api/cms/revise-exercises": reviseExercises,
  "/api/cms/assistant": assistant,
  "/api/cms/batch-generate-exercises": batchGenerate,
  "/api/cms/analyze-course-material": analyzeCourseMaterial,
  "/api/cms/generate-course-from-plan": generateCourseFromPlan,
  "/api/cms/question-image/generate": generateQuestionImage,
  "/api/cms/section-banner/generate": generateSectionBanner,
  "/api/cms/translate-video-captions": translateCaptions,
  "/api/cms/import-exercises-json": importExercisesJson,
  "/api/cms/export-exercises-json": exportExercisesJson,
};

export async function handleCmsAiApi(request, env, url) {
  if (request.method.toUpperCase() !== "POST") return null;
  const route = ROUTES[url.pathname.replace(/\/+$/, "")];
  if (!route) return null;
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  const body = await readJson(request);
  return route({ env, auth, body });
}

// The (apiKey, model, messages, maxTokens) call lib/ expects. lib/ only checks
// that a key is present; the Worker's secret or the keyless router decides
// what is actually used, so it gets this placeholder.
const WORKER_KEY = "worker";

function modelCall(env) {
  return (_apiKey, model, messages, maxTokens) =>
    completeText(env, messages, maxTokens, { title: "Lango Course Generator", model, timeoutMs: GENERATE_TIMEOUT_MS });
}

function chosenModel(body) {
  return String(body?.model || "").trim() || exerciseGenerator.DEFAULT_GENERATE_MODEL;
}

function failure(label, error, status = 500) {
  const message = error instanceof Error ? error.message : String(error || "");
  console.error(JSON.stringify({ message: `${label}_failed`, error: message }));
  return json({ message: message || "Request failed." }, status);
}

async function generateExercises({ env, auth, body }) {
  const material = String(body?.material || "").trim();
  if (!material) return json({ message: "Material text is required." }, 400);
  const imageAssets = Array.isArray(body?.imageAssets) ? body.imageAssets : [];
  const model = chosenModel(body);
  try {
    const result = await exerciseGenerator.generateExercisesFromMaterial(
      {
        material,
        langCode: String(body?.langCode || "en").trim(),
        difficulty: String(body?.difficulty || "medium").trim(),
        types: body?.types,
        countPerType: body?.countPerType,
        instructions: String(body?.instructions || "").trim(),
        imageAssets,
        model,
        apiKey: WORKER_KEY,
      },
      modelCall(env)
    );
    const { exercises, autoImageStats } = await finalizeExerciseImages(env, result.exercises, {
      imageAssets,
      teacherId: auth.teacherId,
      model,
      autoGenerateImages: body?.autoGenerateImages,
    });
    return json({
      ok: true,
      exercises,
      model: result.model,
      stats: result.stats,
      autoImageStats,
      imageAssetsUsed: countImages(exercises),
    });
  } catch (error) {
    return failure("generate_exercises", error);
  }
}

async function reviseExercises({ env, auth, body }) {
  const revision = String(body?.revision || "").trim();
  if (!revision) return json({ message: "Describe the change you want." }, 400);
  const material = String(body?.material || "").trim();
  if (!material) return json({ message: "Material text is required." }, 400);
  const exercises = Array.isArray(body?.exercises) ? body.exercises : [];
  if (!exercises.length) return json({ message: "Provide the current review draft." }, 400);
  const imageAssets = Array.isArray(body?.imageAssets) ? body.imageAssets : [];
  const model = chosenModel(body);
  try {
    const result = await exerciseGenerator.reviseExercisesFromDraft(
      {
        material,
        langCode: String(body?.langCode || "en").trim(),
        difficulty: String(body?.difficulty || "medium").trim(),
        instructions: String(body?.instructions || "").trim(),
        revision,
        exercises,
        history: Array.isArray(body?.history) ? body.history.slice(-8) : [],
        imageAssets,
        questionNumber: Number(body?.questionNumber) || undefined,
        model,
        apiKey: WORKER_KEY,
      },
      modelCall(env)
    );
    const finalized = await finalizeExerciseImages(env, result.exercises, {
      imageAssets,
      teacherId: auth.teacherId,
      model,
      autoGenerateImages: body?.autoGenerateImages,
    });
    return json({
      ok: true,
      exercises: finalized.exercises,
      summary: result.summary,
      model: result.model,
      revisionMode: result.revisionMode || null,
      stats: result.stats,
      autoImageStats: finalized.autoImageStats,
    });
  } catch (error) {
    return failure("revise_exercises", error);
  }
}

async function assistant({ env, body }) {
  const message = String(body?.message || "").trim();
  if (!message) return json({ message: "Enter a message for the assistant." }, 400);
  try {
    const result = await cmsAssistant.answerCmsAssistant(
      {
        message,
        history: Array.isArray(body?.history) ? body.history.slice(-8) : [],
        context: body?.context && typeof body.context === "object" ? body.context : {},
        model: chosenModel(body),
        apiKey: WORKER_KEY,
      },
      modelCall(env)
    );
    return json({ ok: true, reply: result.reply, model: result.model });
  } catch (error) {
    return failure("assistant", error);
  }
}

async function batchGenerate({ env, body }) {
  const jobs = Array.isArray(body?.sections) ? body.sections : [];
  if (!jobs.length) return json({ message: "Provide at least one section job in sections[]." }, 400);
  if (jobs.length > MAX_BATCH_SECTIONS) {
    return json({ message: `Batch generation supports up to ${MAX_BATCH_SECTIONS} sections at once.` }, 400);
  }
  const shared = {
    langCode: String(body?.langCode || "en").trim(),
    difficulty: String(body?.difficulty || "medium").trim(),
    types: body?.types,
    countPerType: body?.countPerType,
    instructions: String(body?.instructions || "").trim(),
    model: chosenModel(body),
    apiKey: WORKER_KEY,
  };
  const results = [];
  for (const job of jobs) {
    const entry = {
      key: String(job?.key ?? job?.sectionIndex ?? job?.sectionId ?? results.length),
      sectionId: job?.sectionId != null ? Number(job.sectionId) : null,
      sectionIndex: job?.sectionIndex != null ? Number(job.sectionIndex) : null,
      sectionTitle: String(job?.sectionTitle || "").trim(),
    };
    const material = String(job?.material || "").trim();
    if (!material) {
      results.push({ ...entry, ok: false, message: "Material text is required for this section." });
      continue;
    }
    try {
      const result = await exerciseGenerator.generateExercisesFromMaterial({ ...shared, material }, modelCall(env));
      results.push({ ...entry, ok: true, exercises: result.exercises, model: result.model, stats: result.stats });
    } catch (error) {
      results.push({ ...entry, ok: false, message: error instanceof Error ? error.message : "Exercise generation failed." });
    }
  }
  const succeeded = results.filter((entry) => entry.ok).length;
  return json({
    ok: succeeded > 0,
    results,
    stats: { requested: jobs.length, succeeded, failed: results.length - succeeded },
  });
}

async function analyzeCourseMaterial({ env, body }) {
  const material = String(body?.material || "").trim();
  if (!material) return json({ message: "Material text is required." }, 400);
  try {
    const plan = await coursePlan.analyzeCourseMaterial(
      {
        material,
        types: coursePlan.lockTypes(body?.types),
        difficulty: body?.difficulty,
        template: body?.template,
        langCode: String(body?.langCode || "en").trim(),
        instructions: String(body?.instructions || "").trim(),
        model: chosenModel(body),
        apiKey: WORKER_KEY,
      },
      modelCall(env)
    );
    return json({ ok: true, plan, usedLlm: plan.planner === "llm" });
  } catch (error) {
    return failure("analyze_course_material", error);
  }
}

async function generateCourseFromPlan({ env, body }) {
  const format = {
    template: String(body?.template || "custom").trim() || "custom",
    types: coursePlan.lockTypes(body?.types),
    difficulty: coursePlan.lockDifficulty(body?.difficulty),
  };
  if (!Object.keys(format.types).length) {
    return json({ message: "Pick a format with at least one exercise type first." }, 400);
  }
  let locked;
  try {
    locked = coursePlan.validateCoursePlan(body?.plan, format);
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Invalid course plan." }, 400);
  }
  const llmTypes = { ...locked.appliedTypes };
  delete llmTypes.video;
  const videoCount = locked.appliedTypes.video || 0;
  if (!Object.keys(llmTypes).length && !videoCount) {
    return json({ message: "Pick a format with at least one exercise type first." }, 400);
  }

  const results = [];
  for (const job of coursePlan.jobsFromPlan(locked, format)) {
    const entry = {
      key: job.key,
      sectionTitle: job.sectionTitle,
      material: job.material,
      types: { ...locked.appliedTypes },
      difficulty: locked.appliedDifficulty,
      ok: false,
      exercises: [],
      stats: null,
      message: "",
    };
    if (!Object.keys(llmTypes).length) {
      entry.ok = true;
      results.push(entry);
      continue;
    }
    try {
      const result = await exerciseGenerator.generateExercisesFromMaterial(
        {
          material: job.material,
          langCode: String(body?.langCode || "en").trim(),
          difficulty: locked.appliedDifficulty,
          types: llmTypes,
          instructions: String(body?.instructions || "").trim(),
          model: chosenModel(body),
          apiKey: WORKER_KEY,
        },
        modelCall(env)
      );
      entry.ok = true;
      entry.exercises = result.exercises || [];
      entry.model = result.model;
      entry.stats = result.stats;
    } catch (error) {
      entry.message = error instanceof Error ? error.message : "Exercise generation failed.";
    }
    results.push(entry);
  }
  const succeeded = results.filter((entry) => entry.ok).length;
  return json({
    ok: succeeded > 0,
    plan: locked,
    results,
    videoCount,
    stats: { requested: results.length, succeeded, failed: results.length - succeeded },
  });
}

async function generateQuestionImage({ env, auth, body }) {
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) return json({ message: "prompt is required." }, 400);
  try {
    const image = await routerImage(env, prompt);
    return json({ url: await saveQuestionImage(env, image, auth.teacherId) });
  } catch (error) {
    return failure("question_image_generate", error, 502);
  }
}

async function generateSectionBanner({ env, auth, body }) {
  const sectionTitle = String(body?.sectionTitle || "").trim();
  const sectionContent = String(body?.sectionContent || body?.contentSummary || "").trim();
  if (!sectionTitle && !sectionContent) {
    return json({ message: "Add a section title or exercises before generating a path tile." }, 400);
  }
  const prompt = pathTilePrompt.buildPathTileImagePrompt(sectionTitle || "Language lesson", {
    courseName: String(body?.courseName || "").trim(),
    sectionContent,
  });
  const courseId = body?.courseId != null ? Number(body.courseId) : null;
  const sectionId = body?.sectionId != null ? Number(body.sectionId) : null;
  if (courseId && sectionId && !(await ownsCourse(env, courseId, auth.teacherId))) {
    return json({ message: "Course not found." }, 404);
  }
  try {
    const image = decodeImage(await routerImage(env, prompt));
    const tile = await pathTile(env, image.bytes);
    const owner = String(auth.teacherId || "upload").replace(/\W/g, "") || "upload";
    const coursePart = courseId != null ? `course-${courseId}-` : "";
    const sectionPart = sectionId != null ? `section-${sectionId}-` : "";
    const ext = tile ? ".png" : image.ext;
    const url = uploadUrl("sections", `section-ai-${coursePart}${sectionPart}${owner}-${Date.now()}${ext}`);
    await storeUpload(env, url, tile || image.bytes, { contentType: tile ? "image/png" : image.type });
    if (courseId && sectionId) {
      const updated = await updateSection(env, auth.teacherId, courseId, sectionId, "banner", url);
      if (updated?.old && updated.old !== url) await deleteUpload(env, updated.old);
      return json({
        url,
        section: updated?.section || { id: sectionId, banner: url },
        updatedAt: updated?.updatedAt || null,
      });
    }
    return json({ url });
  } catch (error) {
    return failure("section_banner_generate", error, 502);
  }
}

async function translateCaptions({ env, body }) {
  const captionUrl = String(body?.captionUrl || "").trim();
  if (!captionUrl) return json({ message: "Source caption URL is required." }, 400);
  const targetLanguage = captionLanguage(body?.targetLanguage);
  try {
    const source = await readCaptionText(env, captionUrl);
    const translated = await webvtt.translateWebVtt(source, targetLanguage, (messages, maxTokens) =>
      completeText(env, messages, maxTokens, { title: "Lango Captions", timeoutMs: GENERATE_TIMEOUT_MS })
    );
    const text = `${String(translated || "").trim()}\n`;
    const url = uploadUrl("captions", `captions-${Date.now()}-${randomPart(8)}.vtt`);
    await storeUpload(env, url, text, { contentType: "text/vtt" });
    return json({ ok: true, captionUrl: url, language: targetLanguage, cueCount: webvtt.parseWebVtt(text).length });
  } catch (error) {
    return failure("translate_video_captions", error);
  }
}

async function importExercisesJson({ body }) {
  try {
    return json({ ok: true, ...exerciseImport.parseImportPayload(body) });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Invalid exercises JSON." }, 400);
  }
}

async function exportExercisesJson({ body }) {
  try {
    const payload = exerciseImport.buildExportPayload({
      course: body?.course || null,
      section: body?.section || null,
      sectionIndex: body?.sectionIndex,
      exercises: body?.exercises,
      mode: String(body?.mode || "section").trim() === "batch" ? "batch" : "section",
      sections: body?.sections,
    });
    return json({ ok: true, payload });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Could not build export JSON." }, 400);
  }
}

// Matches questions to the teacher's material images, then fills the rest
// with generated pictures, as server.js finalizeExerciseImages did.
async function finalizeExerciseImages(env, exercises, { imageAssets, teacherId, model, autoGenerateImages = true }) {
  let resolved = Array.isArray(exercises) ? exercises : [];
  const assets = Array.isArray(imageAssets) ? imageAssets : [];
  if (assets.length) {
    resolved = await imageRefs.assignImagesWithLlm(resolved, assets, modelCall(env), WORKER_KEY, model);
  }
  resolved = imageRefs.resolveExerciseImageRefs(resolved, assets);
  if (autoGenerateImages === false) return { exercises: resolved, autoImageStats: null };
  const auto = await imageRefs.autoGenerateMissingQuestionImages(resolved, {
    llmComplete: modelCall(env),
    apiKey: WORKER_KEY,
    model,
    routerBaseUrl: cmsBase(env),
    generateImage: async (_base, prompt) => ({ image: await routerImage(env, prompt) }),
    saveGeneratedImage: (image) => saveQuestionImage(env, image, teacherId),
  });
  return { exercises: auto.exercises, autoImageStats: auto.stats };
}

async function routerImage(env, prompt) {
  const response = await fetch(`${cmsBase(env)}/api/router/image`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || response.statusText };
  }
  if (!response.ok) {
    const message =
      data?.message || (typeof data?.error === "string" ? data.error : null) || data?.error?.message || `Router image API returned ${response.status}.`;
    throw new Error(message);
  }
  const image = String(data?.image || "").trim();
  if (!image) throw new Error("Router image API did not return an image.");
  return image;
}

async function saveQuestionImage(env, imageData, ownerId) {
  const image = decodeImage(imageData);
  const owner = String(ownerId || "upload").replace(/\W/g, "") || "upload";
  const url = uploadUrl("questions", `question-ai-${owner}-${Date.now()}-${randomPart(4)}${image.ext}`);
  await storeUpload(env, url, image.bytes, { contentType: image.type });
  return url;
}

// Cuts the island out of its chroma-key background in the media container.
// Without the container the raw image is kept, as Node did when this failed.
async function pathTile(env, bytes) {
  if (!env.MEDIA) return null;
  try {
    const response = await env.MEDIA.getByName("media").fetch(
      new Request("http://container/image/path-tile", {
        method: "POST",
        body: bytes,
        headers: { "content-type": "application/octet-stream" },
      })
    );
    if (!response.ok) throw new Error(`media container returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.error(JSON.stringify({ message: "path_tile_failed", error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

function decodeImage(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  const type = (match ? match[1] : "image/png").toLowerCase();
  const data = match ? match[3] : raw;
  const binary = atob(data.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!bytes.length) throw new Error("Invalid image data from Router API.");
  return { bytes, type: IMAGE_TYPES[type] ? type : "image/png", ext: IMAGE_TYPES[type] || ".png" };
}

async function readCaptionText(env, captionUrl) {
  const local = await openUpload(env, captionUrl);
  if (local) return new Response(local.body).text();
  if (!/^https?:\/\//i.test(captionUrl)) throw new Error("Could not read source captions (404).");
  const response = await fetch(captionUrl);
  if (!response.ok) throw new Error(`Could not read source captions (${response.status}).`);
  return response.text();
}

// server.js normalizeBuzzinSttLanguage: a short language code, Chinese by default.
function captionLanguage(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(code) ? code : "zh";
}

async function ownsCourse(env, courseId, teacherId) {
  const store = await readDoc(env, "teacher-courses", { courses: [] });
  return (store.courses || []).some((course) => course.id === courseId && sameId(course.teacherId, teacherId));
}

function countImages(exercises) {
  return (exercises || []).reduce((count, exercise) => count + (exercise.items || []).filter((item) => item?.image).length, 0);
}

function cmsBase(env) {
  return String(env?.CMS_API_BASE || "https://newcms.lango.ai").replace(/\/$/, "");
}
