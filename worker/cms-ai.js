// CMS AI authoring, as server.js served it: exercise generation, revision,
// batch and plan-based course generation, the Ask Lango assistant, generated
// question images and path tiles, caption translation, and exercise JSON.
// The prompt and parsing code is shared with Node through lib/; the Worker
// supplies the model call (worker/ai.js) and keeps files in R2.
import exerciseGenerator from "../lib/exercise-generator.js";
import characters from "../lib/characters.js";
import cmsAssistant from "../lib/cms-assistant.js";
import coursePlan from "../lib/course-plan.js";
import exerciseImport from "../lib/exercise-import.js";
import imageRefs from "../lib/material-image-refs.js";
import pathTilePrompt from "../lib/path-tile-prompt.js";
import webvtt from "../lib/webvtt.js";
import { completeText } from "./ai.js";
import { deleteUpload, openUpload, randomPart, storeUpload, uploadUrl } from "./course-files.js";
import { updateSection } from "./course-media.js";
import { mediaContainer } from "./media-speech.js";
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
  // Worker only: fills a course's empty details once a section is generated.
  "/api/cms/course-details/suggest": suggestCourseDetails,
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
    // A reply to a question leaves the draft exactly as it was.
    if (result.revisionMode === "reply" && !asksForPictures(revision)) {
      return json({ ok: true, exercises: result.exercises, summary: result.summary, model: result.model, revisionMode: "reply" });
    }
    // New pictures take 10-40 seconds each, so a revision only draws them
    // when the teacher asks for pictures.
    const finalized = await finalizeExerciseImages(env, result.exercises, {
      imageAssets,
      teacherId: auth.teacherId,
      model,
      autoGenerateImages: body?.autoGenerateImages ?? asksForPictures(revision),
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

function asksForPictures(revision) {
  return /\b(pictures?|images?|photos?|illustrat\w*|drawings?)\b|圖|相片|插畫/i.test(revision);
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
    const image = await characterImage(env, (character) => characters.withCharacter(prompt, character));
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
  const buildPrompt = (character) =>
    pathTilePrompt.buildPathTileImagePrompt(sectionTitle || "Language lesson", {
      courseName: String(body?.courseName || "").trim(),
      sectionContent,
      character,
    });
  const courseId = body?.courseId != null ? Number(body.courseId) : null;
  const sectionId = body?.sectionId != null ? Number(body.sectionId) : null;
  if (courseId && sectionId && !(await ownsCourse(env, courseId, auth.teacherId))) {
    return json({ message: "Course not found." }, 404);
  }
  try {
    const image = decodeImage(await characterImage(env, buildPrompt));
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
// Course details the teacher left empty, written from the course's sections:
// a short description, the level, learning objectives and a cover picture.
// Only the fields listed in `need` are made; the page saves them.
async function suggestCourseDetails({ env, auth, body }) {
  const need = body?.need && typeof body.need === "object" ? body.need : {};
  const sections = (Array.isArray(body?.sections) ? body.sections : [])
    .map((section) => ({
      title: String(section?.title || "").trim().slice(0, 160),
      content: String(section?.content || "").trim().slice(0, 1200),
    }))
    .filter((section) => section.title || section.content)
    .slice(0, 12);
  if (!sections.length) return json({ message: "Add a section with exercises first." }, 400);
  const courseName = String(body?.courseName || "").trim().slice(0, 120);
  const outline = sections.map((section, index) => `Section ${index + 1}: ${section.title}\n${section.content}`).join("\n\n");
  const wantsText = need.name || need.description || need.level || need.objectives;

  const text = wantsText
    ? (async () => {
        const reply = await modelCall(env)(WORKER_KEY, chosenModel(body), [
          {
            role: "system",
            content:
              "You fill in a language course's details for its teacher. Return ONLY valid JSON: " +
              '{"name":"...","description":"...","level":"...","objectives":["..."]}. ' +
              "name: a short, catchy course title of 2 to 6 words, under 40 characters, with no quotes or trailing punctuation. " +
              "description: ONE short sentence, under 120 characters (under 60 for Chinese), saying what students practise. No lists, no second sentence. " +
              'level: a short school level or band such as "P3" or "Beginner", under 20 characters. ' +
              "objectives: 3 to 5 short learning objectives, each starting with a verb. " +
              "Write in the same language as the course content.",
          },
          { role: "user", content: `Course: ${courseName || "(untitled)"}\n\n${outline}` },
        ], 600);
        return exerciseGenerator.parseJsonFromLlm(reply) || {};
      })()
    : Promise.resolve({});
  const cover = need.banner
    ? characterImage(
        env,
        (character) => courseCoverPrompt(courseName || sections[0].title, sections.map((section) => section.title), character),
        { imageSize: COVER_IMAGE_SIZE }
      ).then((image) => saveCourseCover(env, image, auth.teacherId))
    : Promise.resolve(null);

  const [textResult, coverResult] = await Promise.allSettled([text, cover]);
  if (textResult.status === "rejected" && (coverResult.status === "rejected" || !need.banner)) {
    return failure("course_details_suggest", textResult.reason, 502);
  }
  const details = textResult.status === "fulfilled" ? textResult.value : {};
  const result = {};
  if (need.name && String(details.name || "").trim()) result.name = String(details.name).trim().replace(/^["'“”‘’]+|["'“”‘’。.]+$/g, "").slice(0, 60);
  if (need.description && String(details.description || "").trim()) result.description = String(details.description).trim().slice(0, 200);
  if (need.level && String(details.level || "").trim()) result.level = String(details.level).trim().slice(0, 40);
  if (need.objectives && Array.isArray(details.objectives)) {
    const objectives = details.objectives.map((line) => String(line || "").trim()).filter(Boolean).slice(0, 8);
    if (objectives.length) result.objectives = objectives;
  }
  if (coverResult.status === "fulfilled" && coverResult.value) result.banner = coverResult.value;
  if (coverResult.status === "rejected") console.error(JSON.stringify({ message: "course_cover_failed", error: String(coverResult.reason?.message || coverResult.reason) }));
  return json({ ok: true, details: result });
}

// 16:9, close to the shape covers are shown in (about 2:1, cropped to fit).
const COVER_IMAGE_SIZE = "1792x1024";

function courseCoverPrompt(name, titles, character) {
  const subject = `for a children's language course called "${name}" about ${titles.join(", ")}`;
  if (!character) {
    return `Wide colourful cover illustration ${subject}. Friendly cartoon style, no text or lettering.`;
  }
  return (
    `Wide landscape cover illustration ${subject}. Friendly polished 3D cartoon style, bright colours. ` +
    `Put the character on one side of the frame, clearly visible and about two thirds of the picture's height, ` +
    `with the course's scene filling the rest. ${characters.characterLine(character)} ` +
    `No other people or mascots. No text or lettering.`
  );
}

async function saveCourseCover(env, imageData, ownerId) {
  const image = decodeImage(imageData);
  const owner = String(ownerId || "upload").replace(/\W/g, "") || "upload";
  const url = uploadUrl("courses", `course-ai-${owner}-${Date.now()}-${randomPart(4)}${image.ext}`);
  await storeUpload(env, url, image.bytes, { contentType: image.type });
  return url;
}

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
    generateImage: async (_base, prompt) => ({
      image: await characterImage(env, (character) => characters.withCharacter(prompt, character)),
    }),
    saveGeneratedImage: (image) => saveQuestionImage(env, image, teacherId),
  });
  return { exercises: auto.exercises, autoImageStats: auto.stats };
}

async function routerImage(env, prompt) {
  return postImage(env, "/api/router/image", { prompt });
}

// Draws with one of the Lango characters: the router's inworld-image endpoint
// takes the character as a reference picture, which /api/router/image cannot.
// buildPrompt gets the chosen character, or null when there is none to send,
// and then the plain image router answers as before.
async function characterImage(env, buildPrompt, { imageSize = "1024x1024" } = {}) {
  const character = characters.pickCharacter();
  try {
    const referenceImage = await characterReference(env, character);
    if (referenceImage) {
      return await postImage(env, "/api/router/inworld-image", {
        prompt: buildPrompt(character),
        imageSize,
        n: 1,
        referenceImage,
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "character_image_failed", character: character.id, error: error instanceof Error ? error.message : String(error) }));
  }
  return routerImage(env, buildPrompt(null));
}

// A data URL of the character's picture from the static assets, or the name
// the router knows the character by.
async function characterReference(env, character) {
  if (character.reference) return character.reference;
  if (!env?.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(`https://assets.local${character.file}`));
  if (!response.ok) throw new Error(`character image ${character.file} returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

async function postImage(env, path, body) {
  const response = await fetch(`${cmsBase(env)}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
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
    const response = await mediaContainer(env).fetch(
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
