const STORAGE_KEY = "lango_host_prefs";
const CMS_THEME_KEY = "lango_cms_theme";
const CMS_TEXT_SIZE_DEFAULT = "lg";
const CMS_EMPTY_COVER = "/assets/cms/cover-empty.svg";

const CMS_TOUR_KEY = "lango_cms_tour_v1";

const AI_WIZARD_STEPS = [
  { label: "Choose format" },
  { label: "Add material" },
  { label: "Review plan" },
  { label: "Review exercises" },
  { label: "Publish" },
];

const CMS_FALLBACK_SPEAK_LANGUAGES = [{ code: "en", label: "English" }];

const state = {
  token: null,
  user: null,
  loginUsername: "",
  courses: [],
  communityCourses: [],
  communityLanguages: [],
  communityQuery: "",
  communityLang: "all",
  communitySort: "featured",
  communityPreviewId: null,
  classes: [],
  editingCourse: null,
  sections: [],
  editingSectionIndex: null,
  expandedExerciseIndex: null,
  aiMaterialText: "",
  aiMaterialAssets: [],
  aiSelectedFiles: [],
  aiDraftExercises: [],
  aiWizardStep: 1,
  aiWizardMaxStep: 1,
  aiWizardActive: false,
  aiWizardBusy: false,
  aiTemplate: "vocab",
  aiCourseMode: false,
  aiCoursePlan: null,
  aiCourseResults: [],
  aiGenSummary: null,
  exercisesSaveUnlocked: false,
  globalAgentOpen: false,
  globalAgentBusy: false,
  globalAgentContextKey: "",
  globalAgentHistory: [],
  globalAgentUndo: [],
  globalAgentSelection: "",
  globalAgentSelectionQuestion: null,
  globalAgentPendingSelection: "",
  globalAgentPendingQuestionNumber: null,
  batchDraftResults: [],
  batchPreparedMaterials: {},
  dashboardClassId: null,
  dashboardCourses: [],
  cmsDirty: false,
  cmsAutosaving: false,
  cmsTourStep: 0,
  cmsAppVariant: "",
  cmsSpeakLanguages: CMS_FALLBACK_SPEAK_LANGUAGES.slice(),
  cmsDefaultSpeakLangCode: "en",
  cmsTtsProvider: "inworld",
};

function formatCmsErrorMessage(message) {
  const msg = String(message || "");
  if (!msg) return "";
  if (/openrouter/i.test(msg) && /not configured|api key|missing/i.test(msg)) {
    return `${escapeHtml(msg)} <a href="/config.html#openrouter">Open OpenRouter settings</a>`;
  }
  if (/inworld/i.test(msg) && /not configured|api key|missing/i.test(msg)) {
    return `${escapeHtml(msg)} <a href="/config.html#inworld">Open Inworld settings</a>`;
  }
  if (/video generator|VIDEO_GENERATOR/i.test(msg) && /not configured|missing|url/i.test(msg)) {
    return `${escapeHtml(msg)} <a href="/config.html#video">Open Video API settings</a>`;
  }
  return escapeHtml(msg);
}

function setCmsError(el, message) {
  if (!el) return;
  if (!message) {
    el.textContent = "";
    return;
  }
  el.innerHTML = formatCmsErrorMessage(message);
}

function markCmsDirty() {
  if (!state.editingCourse) return;
  state.cmsDirty = true;
  updateCmsAutosaveStatus();
}

function clearCmsDirty() {
  state.cmsDirty = false;
  updateCmsAutosaveStatus();
}

function updateCmsAutosaveStatus() {
  const el = $("#cms-autosave-status");
  if (!el) return;
  if (!state.editingCourse || !$("#screen-cms-edit")?.classList.contains("active")) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.classList.remove("is-dirty", "is-saving", "is-saved");
  if (state.cmsAutosaving) {
    el.textContent = "Saving…";
    el.classList.add("is-saving");
  } else if (state.cmsDirty) {
    el.textContent = "Unsaved changes";
    el.classList.add("is-dirty");
  } else {
    el.textContent = "All changes saved";
    el.classList.add("is-saved");
  }
}

function syncExercisesSaveButton() {
  const btn = $("#btn-save-exercises");
  if (!btn) return;
  btn.hidden = !state.exercisesSaveUnlocked;
}

function aiTypeBadge(type) {
  const label = exerciseTypeShortLabel(type || "mcquiz");
  return `<span class="cms-ai-type-badge cms-ai-type-badge--${escapeHtml(type || "mcquiz")}">${escapeHtml(label)}</span>`;
}

function showAiEntryChooser() {
  state.aiWizardActive = false;
  const chooser = $("#cms-ai-entry-chooser");
  const wizard = $("#cms-ai-wizard");
  if (chooser) chooser.hidden = false;
  if (wizard) wizard.hidden = true;
}

function openAiGeneratePath(mode) {
  state.aiWizardActive = true;
  state.aiCourseMode = mode === "course";
  state.aiGenSummary = null;
  const chooser = $("#cms-ai-entry-chooser");
  const wizard = $("#cms-ai-wizard");
  if (chooser) chooser.hidden = true;
  if (wizard) wizard.hidden = false;
  syncAiCourseModeUi();
  setAiWizardStep(1);
  syncAiWizardCopy();
  syncAiSpeakLangSelect();
  syncAiMaterialState();
}

function syncAiCourseModeUi() {
  updateAiWizardSummary();
}

function setAiWizardBusy(busy, message) {
  state.aiWizardBusy = busy;
  const back = $("#btn-cms-ai-back");
  const next = $("#btn-cms-ai-next");
  const changePath = $("#btn-cms-ai-change-path");
  if (back) back.disabled = busy;
  if (next) {
    next.disabled = busy;
    next.classList.toggle("is-loading", busy);
    if (busy) next.setAttribute("aria-busy", "true");
    else next.removeAttribute("aria-busy");
  }
  if (changePath) changePath.disabled = busy;
  document.querySelectorAll(".cms-ai-step").forEach((btn) => {
    const n = Number(btn.dataset.step);
    btn.disabled = busy ? n !== state.aiWizardStep : n > state.aiWizardMaxStep;
  });
  if (busy && message) {
    const status = $("#cms-ai-generate-status");
    if (status) status.textContent = message;
  }
  syncAiReviewAgentBusy();
}

let aiGenProgressTicker = null;

function stopAiGenProgressTicker() {
  if (aiGenProgressTicker) {
    clearInterval(aiGenProgressTicker);
    aiGenProgressTicker = null;
  }
}

function setAiGenProgress(percent, label) {
  const wrap = $("#cms-ai-gen-progress");
  const bar = $("#cms-ai-gen-progress-bar");
  const track = wrap?.querySelector("[role=progressbar]");
  const labelEl = $("#cms-ai-gen-progress-label");
  const statusEl = $("#cms-ai-generate-status");
  if (!wrap || !bar) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  wrap.hidden = false;
  bar.style.width = `${value}%`;
  track?.setAttribute("aria-valuenow", String(value));
  track?.setAttribute("aria-valuetext", `${value}%`);
  wrap.classList.toggle("is-complete", value >= 100);
  if (label) {
    if (labelEl) labelEl.textContent = label;
    if (statusEl) statusEl.textContent = label;
  }
}

function resetAiGenProgress() {
  stopAiGenProgressTicker();
  const wrap = $("#cms-ai-gen-progress");
  const bar = $("#cms-ai-gen-progress-bar");
  const labelEl = $("#cms-ai-gen-progress-label");
  const track = wrap?.querySelector("[role=progressbar]");
  if (bar) bar.style.width = "0%";
  track?.setAttribute("aria-valuenow", "0");
  track?.setAttribute("aria-valuetext", "0%");
  if (labelEl) labelEl.textContent = "";
  if (wrap) {
    wrap.hidden = true;
    wrap.classList.remove("is-complete");
  }
}

function startAiGenProgressTicker(from, to, durationMs = 60000) {
  stopAiGenProgressTicker();
  const start = Date.now();
  aiGenProgressTicker = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / durationMs);
    const value = Math.round(from + (to - from) * t);
    const bar = $("#cms-ai-gen-progress-bar");
    const track = $("#cms-ai-gen-progress")?.querySelector("[role=progressbar]");
    if (bar) bar.style.width = `${value}%`;
    track?.setAttribute("aria-valuenow", String(value));
    track?.setAttribute("aria-valuetext", `${value}%`);
    if (t >= 1) stopAiGenProgressTicker();
  }, 120);
}

function updateAiWizardSummary() {
  const el = $("#cms-ai-wizard-summary");
  if (!el) return;
  const settings = getAiGenerationSettings();
  const section = state.sections[state.editingSectionIndex];
  const parts = [
    aiFormatLabel(settings.types, settings.difficulty, settings.speakLangCode),
    state.aiCourseMode ? "Full course" : section?.title?.trim() || "This section",
  ];
  const file = getAiSelectedFiles()[0];
  const fileCount = getAiSelectedFiles().length;
  if (fileCount > 1) parts.push(`${fileCount} files`);
  else if (file) parts.push(file.name);
  else if (state.aiMaterialText) parts.push(`${state.aiMaterialText.length.toLocaleString()} chars`);
  if (getAiInstructions()) parts.push("Focused");
  if (state.aiWizardStep === 3 && state.aiDraftExercises?.length && !state.aiCourseMode) {
    parts.push(
      `Est. ${formatSectionDuration(estimateSectionDurationSeconds(state.aiDraftExercises))}`
    );
  }
  el.textContent = parts.filter(Boolean).join(" · ");
}

function syncAiMaterialState() {
  const el = $("#cms-ai-material-state");
  if (!el) return;
  const files = getAiSelectedFiles();
  const file = files[0];
  const pasted = $("#cms-ai-paste")?.value.trim();
  const videoUrl = $("#cms-ai-video-url")?.value.trim();
  const prepared = !!(state.aiMaterialText || $("#cms-ai-material-preview")?.value.trim());
  const hasSource = !!(files.length || pasted || videoUrl);

  if (!hasSource && !prepared) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  const chips = [];
  if (files.length === 1) {
    const name = file.name.length > 22 ? `${file.name.slice(0, 19)}…` : file.name;
    chips.push(`<span class="cms-ai-status-chip is-done">${escapeHtml(name)}</span>`);
  } else if (files.length > 1) {
    chips.push(`<span class="cms-ai-status-chip is-done">${files.length} files</span>`);
  } else if (pasted) {
    chips.push('<span class="cms-ai-status-chip is-done">Text</span>');
  } else if (videoUrl) {
    chips.push('<span class="cms-ai-status-chip is-done">URL</span>');
  }
  if (prepared) {
    chips.push(
      `<span class="cms-ai-status-chip is-done">${(state.aiMaterialText || "").length.toLocaleString()} chars</span>`
    );
  } else if (hasSource) {
    chips.push('<span class="cms-ai-status-chip">Ready to generate</span>');
  }

  el.hidden = false;
  el.innerHTML = chips.join("");
}

function aiFileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function getAiSelectedFiles() {
  return state.aiSelectedFiles || [];
}

function hasAiUploadFiles() {
  return getAiSelectedFiles().length > 0;
}

function addAiSelectedFiles(fileList) {
  const incoming = Array.from(fileList || []).filter((file) => file instanceof File);
  if (!incoming.length) return 0;
  const seen = new Set(getAiSelectedFiles().map(aiFileKey));
  const added = [];
  for (const file of incoming) {
    const key = aiFileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(file);
  }
  if (added.length) state.aiSelectedFiles = [...getAiSelectedFiles(), ...added];
  return added.length;
}

function removeAiSelectedFile(index) {
  const files = getAiSelectedFiles();
  if (index < 0 || index >= files.length) return;
  state.aiSelectedFiles = files.filter((_, i) => i !== index);
}

function clearAiSelectedFiles() {
  state.aiSelectedFiles = [];
}

function formatAiFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAiFileList() {
  const list = $("#cms-ai-file-list");
  if (!list) return;
  const files = getAiSelectedFiles();
  if (!files.length) {
    list.hidden = true;
    list.innerHTML = "";
    return;
  }
  list.hidden = false;
  list.innerHTML = files
    .map((file, index) => {
      const name = file.name.length > 36 ? `${file.name.slice(0, 33)}…` : file.name;
      return `
        <li class="cms-ai-file-item">
          <span class="cms-ai-file-item-name">${escapeHtml(name)}</span>
          <span class="cms-ai-file-item-meta">${formatAiFileSize(file.size)}</span>
          <button type="button" class="cms-ai-file-item-remove" data-ai-file-index="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>
        </li>`;
    })
    .join("");
}

function showAiGenSummary(text) {
  state.aiGenSummary = text || null;
  const el = $("#cms-ai-gen-summary");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function buildAiGenSummaryFromExercises(exercises, extra = "") {
  const count = (exercises || []).length;
  const included = (exercises || []).filter((exercise) => exercise.included !== false).length;
  return `${included} exercise(s) ready${extra ? ` · ${extra}` : ""}${count !== included ? ` (${count} total)` : ""}`;
}

function buildAiGenSummaryFromCourseResults(results, stats = {}) {
  const exerciseCount = (results || []).reduce((total, entry) => total + (entry.exercises?.length || 0), 0);
  const sections = (results || []).filter((entry) => entry.ok).length;
  const failed = Number(stats.failed) || 0;
  return `${exerciseCount} exercises · ${sections} section(s)${failed ? ` · ${failed} failed` : ""}`;
}

function renderAiPreviewNav(groups) {
  const toolbar = $("#cms-ai-preview-toolbar");
  const nav = $("#cms-ai-preview-nav");
  if (!toolbar || !nav) return;
  if (!groups || groups.length <= 1) {
    toolbar.hidden = groups.length <= 0;
    nav.innerHTML = "";
    return;
  }
  toolbar.hidden = false;
  nav.innerHTML = groups
    .map(
      (group, index) =>
        `<a class="cms-ai-preview-nav-link" href="#cms-ai-preview-group-${index}">${escapeHtml(group.title || `Section ${index + 1}`)}</a>`
    )
    .join("");
}

function setAiPreviewGroupsCollapsed(collapsed) {
  document.querySelectorAll(".cms-ai-preview-group-body").forEach((body) => {
    body.hidden = collapsed;
  });
  document.querySelectorAll(".cms-ai-preview-group-toggle").forEach((btn) => {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
}

function renderAiPreviewGrouped(groups) {
  const container = $("#cms-ai-preview");
  if (!container) return;
  if (!groups?.length) {
    container.innerHTML = `<div class="cms-empty"><p class="cms-empty-title">No exercises yet</p><p class="cms-empty-copy">Go back and generate from your material.</p></div>`;
    renderAiPreviewNav([]);
    return;
  }

  let questionOffset = 0;
  const numberingPlan = [];
  container.innerHTML = groups
    .map((group, groupIndex) => {
      const { html, questionCount } = renderAiReviewGroupContent(group.items || [], questionOffset);
      (group.items || []).forEach(({ exercise, index }) => {
        const itemCount = exercise?.type === "video" ? 0 : (exercise.items || []).length;
        numberingPlan.push({
          exerciseIndex: index,
          type: exercise?.type,
          title: exercise?.title,
          itemCount,
          labelStart: itemCount ? questionOffset + 1 : null,
          labelEnd: itemCount ? questionOffset + itemCount : null,
        });
      });
      questionOffset += questionCount;
      const count = group.items?.length || 0;
      const groupExercises = (group.items || []).map(({ exercise }) => exercise).filter(Boolean);
      const durationLabel = formatSectionDuration(estimateSectionDurationSeconds(groupExercises));
      return `
        <section class="cms-ai-course-preview-group" id="cms-ai-preview-group-${groupIndex}" data-course-group="${groupIndex}" data-course-key="${escapeHtml(group.key || String(groupIndex))}">
          <button type="button" class="cms-ai-preview-group-toggle" aria-expanded="true" data-group-index="${groupIndex}">
            <span class="cms-ai-preview-group-title">${escapeHtml(group.title || `Section ${groupIndex + 1}`)}</span>
            <span class="cms-ai-preview-group-meta">
              <span class="cms-ai-preview-group-count">${count} exercise${count === 1 ? "" : "s"}</span>
              <span class="cms-ai-preview-group-duration">Est. ${durationLabel}</span>
            </span>
          </button>
          <div class="cms-ai-preview-group-body" data-group-index="${groupIndex}">
            ${html}
          </div>
        </section>`;
    })
    .join("");
  wireAiVideoPreviews();
  wireAiQuestionLists();
  renderAiPreviewNav(groups);
  if (state.aiWizardStep === 3) {
    scheduleAiPreviewScrollToStart("render-preview");
  }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.loginUsername) state.loginUsername = data.loginUsername;
    if (data.token && data.user) {
      state.token = data.token;
      state.user = data.user;
    }
    if (data.dashboardClassId != null) {
      const id = Number(data.dashboardClassId);
      state.dashboardClassId = Number.isFinite(id) && id > 0 ? id : null;
    }
  } catch {
    /* ignore */
  }
}

function savePrefs() {
  const loginUsername =
    $("#cms-login-username")?.value.trim().toLowerCase() || state.loginUsername || "";
  if (loginUsername) state.loginUsername = loginUsername;

  const existing = localStorage.getItem(STORAGE_KEY);
  let data = {};
  try {
    data = existing ? JSON.parse(existing) : {};
  } catch {
    data = {};
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...data,
      loginUsername: state.loginUsername,
      token: state.token,
      user: state.user,
      dashboardClassId: state.dashboardClassId,
    })
  );
}

function systemCmsTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function applyCmsTheme() {
  document.documentElement.dataset.cmsTheme = "light";
  try {
    localStorage.setItem(CMS_THEME_KEY, "light");
  } catch {
    /* ignore */
  }
  window.LangoGsap?.playCmsTabGlider?.();
}

function initCmsTheme() {
  applyCmsTheme();
}

function initCmsTextSize() {
  document.documentElement.dataset.cmsTextSize = CMS_TEXT_SIZE_DEFAULT;
}

function teacherDisplayName() {
  if (!state.user) return "";
  const u = state.user;
  if (u.firstName || u.lastName) {
    return [u.firstName, u.lastName].filter(Boolean).join(" ");
  }
  return u.username || u.email || `User #${u.id}`;
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  headers["X-Teacher-Id"] = String(state.user?.id || "");
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || res.statusText };
  }

  if (!res.ok) {
    const htmlMessage = String(data?.message || text || "");
    if (/Cannot POST \/api\/cms\/revise-exercises/i.test(htmlMessage)) {
      throw new Error("Review assistant is unavailable. Restart the CMS server and try again.");
    }
    throw new Error(data?.message || `Request failed (${res.status})`);
  }
  return data;
}

function slugifyFilename(name) {
  return (
    String(name || "course")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "course"
  );
}

async function downloadCourseExport(path, fallbackFilename) {
  const headers = { Accept: "application/zip" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  headers["X-Teacher-Id"] = String(state.user?.id || "");

  const res = await fetch(path, { headers });
  if (!res.ok) {
    const text = await res.text();
    let message = `Export failed (${res.status})`;
    try {
      const data = text ? JSON.parse(text) : null;
      if (data?.message) message = data.message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const filename = match?.[1] || fallbackFilename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportAllCourses() {
  const btn = $("#btn-export-all-courses");
  const status = $("#cms-list-status");
  const error = $("#cms-list-error");
  error.textContent = "";
  btn.disabled = true;
  status.textContent = "Preparing export…";

  try {
    await downloadCourseExport("/api/cms/courses/export-all", `langoclass-courses-${Date.now()}.zip`);
    status.textContent = "Export downloaded.";
  } catch (err) {
    status.textContent = "";
    error.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function triggerImportAllCourses() {
  $("#import-all-file").click();
}

const IMPORT_CHUNK_BYTES = 512 * 1024;

function cmsImportHeaders() {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  headers["X-Teacher-Id"] = String(state.user?.id || "");
  return headers;
}

function parseImportResponseError(res, text, data) {
  const raw = String(data?.message || text || "");
  if (res.status === 413 || /413|Request Entity Too Large/i.test(raw)) {
    return new Error(
      "Upload rejected by the server (file too large). Reload the page and retry — imports now upload in small chunks."
    );
  }
  if (/^\s*<html[\s>]/i.test(raw)) {
    return new Error(`Import failed (${res.status}). The server returned an error page instead of JSON.`);
  }
  return new Error(data?.message || `Import failed (${res.status})`);
}

async function readImportResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || res.statusText };
  }
  if (!res.ok) {
    throw parseImportResponseError(res, text, data);
  }
  return data;
}

async function importAllCoursesChunked(file, status) {
  const totalBytes = file.size;
  const totalChunks = Math.ceil(totalBytes / IMPORT_CHUNK_BYTES);

  const initData = await readImportResponse(
    await fetch("/api/cms/courses/import-all/init", {
      method: "POST",
      headers: { ...cmsImportHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ totalBytes, totalChunks, fileName: file.name }),
    })
  );

  const uploadId = initData.uploadId;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * IMPORT_CHUNK_BYTES;
    const end = Math.min(start + IMPORT_CHUNK_BYTES, totalBytes);
    const formData = new FormData();
    formData.append("uploadId", uploadId);
    formData.append("chunkIndex", String(i));
    formData.append("chunk", file.slice(start, end), `chunk-${i}`);

    status.textContent = `Uploading backup… ${i + 1}/${totalChunks}`;

    await readImportResponse(
      await fetch("/api/cms/courses/import-all/chunk", {
        method: "POST",
        headers: cmsImportHeaders(),
        body: formData,
      })
    );
  }

  status.textContent = "Importing courses…";

  return readImportResponse(
    await fetch("/api/cms/courses/import-all/complete", {
      method: "POST",
      headers: { ...cmsImportHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    })
  );
}

async function importAllCourses(file) {
  const btn = $("#btn-import-all-courses");
  const status = $("#cms-list-status");
  const error = $("#cms-list-error");
  error.textContent = "";
  $("#import-all-file").value = "";

  if (
    !confirm(
      "Import will replace ALL of your courses, exercises, uploaded media, scores, and student progress for those courses.\n\nContinue?"
    )
  ) {
    return;
  }

  btn.disabled = true;
  status.textContent = "Preparing import…";

  try {
    const data = await importAllCoursesChunked(file, status);
    const count = data?.imported || 0;
    const replaced = data?.replaced || 0;
    if (replaced > 0) {
      status.textContent = `Replaced ${replaced} course${replaced === 1 ? "" : "s"} with ${count} imported course${count === 1 ? "" : "s"}.`;
    } else {
      status.textContent = `Imported ${count} course${count === 1 ? "" : "s"}.`;
    }
    await enterCourseList();
  } catch (err) {
    status.textContent = "";
    error.textContent = err.message;
  } finally {
    btn.disabled = false;
    $("#import-all-file").value = "";
  }
}

async function exportCurrentCourse() {
  if (!state.editingCourse) return;

  const btn = $("#btn-export-course");
  const status = $("#cms-details-status");
  const error = $("#cms-details-error");
  error.textContent = "";
  btn.disabled = true;
  status.textContent = "Preparing export…";

  try {
    const course = state.editingCourse;
    const fallback = `course-${course.id}-${slugifyFilename(course.name)}.zip`;
    await downloadCourseExport(`/api/cms/courses/${course.id}/export`, fallback);
    status.textContent = "Export downloaded.";
  } catch (err) {
    status.textContent = "";
    error.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function cmsMotion() {
  return window.LangoGsap?.ready ? window.LangoGsap : null;
}

let cmsToastHideTimer = null;

function showCmsToast(message, { variant = "success", durationMs = 4200 } = {}) {
  const toast = $("#cms-toast");
  const messageEl = $("#cms-toast-message");
  if (!toast || !messageEl || !message) return;

  if (cmsToastHideTimer) {
    clearTimeout(cmsToastHideTimer);
    cmsToastHideTimer = null;
  }

  messageEl.textContent = message;
  toast.classList.remove("cms-toast--success", "cms-toast--error");
  toast.classList.add(`cms-toast--${variant}`);
  toast.classList.remove("is-visible");
  toast.hidden = false;

  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  cmsToastHideTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
    cmsToastHideTimer = setTimeout(() => {
      toast.hidden = true;
      cmsToastHideTimer = null;
    }, 240);
  }, durationMs);
}

function getActiveCmsScreenId() {
  const active = document.querySelector(".cms-app .screen.active");
  if (!active) return "login";
  return active.id.replace("screen-cms-", "");
}

function getActiveCmsTabId() {
  const tab = document.querySelector(".cms-tab.active");
  return tab?.dataset?.tab || "details";
}

function getGlobalAgentMode() {
  if (state.aiWizardActive && state.aiWizardStep === 3 && hasAiPreviewReady()) return "ai-review";
  if (isExercisesSubpageOpen() && getOpenExerciseCard()) return "exercise-edit";
  return "general";
}

function getGlobalAgentContextKey() {
  const mode = getGlobalAgentMode();
  if (mode === "ai-review") return "ai-review";
  if (mode === "exercise-edit") {
    const card = getOpenExerciseCard();
    const index = card ? Number(card.dataset.exerciseIndex) : state.expandedExerciseIndex;
    return `exercise-edit:${Number.isFinite(index) ? index : "x"}`;
  }
  const screen = getActiveCmsScreenId();
  const tab = getActiveCmsTabId();
  const courseId = state.editingCourse?.id || "none";
  return `general:${screen}:${screen === "edit" ? tab : ""}:${courseId}`;
}

function getGlobalAgentPageHeading() {
  const active = document.querySelector(".cms-app .screen.active");
  if (!active) return null;
  if (active.id === "screen-cms-edit" && isExercisesSubpageOpen()) {
    return $("#cms-exercises-section-title")?.textContent?.trim() || "Section exercises";
  }
  const h1 = active.querySelector("h1");
  return h1?.textContent?.trim() || null;
}

function getGlobalAgentContext() {
  const mode = getGlobalAgentMode();
  const screen = getActiveCmsScreenId();
  const tab = getActiveCmsTabId();
  const section =
    state.editingSectionIndex != null ? state.sections[state.editingSectionIndex] : null;
  const card = getOpenExerciseCard();
  const exercise =
    card && state.editingSectionIndex != null
      ? state.sections[state.editingSectionIndex]?.exercises?.[Number(card.dataset.exerciseIndex)] ||
        collectExerciseFromCard(card)
      : null;
  const exercises = section?.exercises || [];
  return {
    mode,
    screen,
    tab,
    pageHeading: getGlobalAgentPageHeading(),
    subview: isExercisesSubpageOpen()
      ? "exercises"
      : getActiveTabId() === "sections"
        ? "sections"
        : "details",
    wizardStep: state.aiWizardActive ? state.aiWizardStep : null,
    selection: String(state.globalAgentSelection || "").trim() || null,
    course: state.editingCourse
      ? {
          id: state.editingCourse.id,
          name: state.editingCourse.name || "",
          langCode: state.editingCourse.langCode || "en",
          description: state.editingCourse.description || "",
          sectionCount: state.sections.length,
        }
      : null,
    section: section
      ? {
          title: section.title || "",
          exerciseCount: exercises.length,
          estimatedLabel: exercises.length
            ? formatSectionDuration(estimateSectionDurationSeconds(exercises))
            : null,
        }
      : null,
    exercise: exercise
      ? {
          type: exercise.type || "",
          title: exercise.title || "",
          itemCount: (exercise.items || []).length,
        }
      : null,
    sections: state.sections.map((entry, index) => ({
      title: entry.title || `Section ${index + 1}`,
      exerciseCount: (entry.exercises || []).length,
    })),
  };
}

function clearGlobalAgentSelectionState() {
  state.globalAgentSelection = "";
  state.globalAgentSelectionQuestion = null;
  state.globalAgentPendingSelection = "";
  state.globalAgentPendingQuestionNumber = null;
  hideGlobalSelectionAddButton();
}

function resetGlobalAgentSession({ clearHistory = true } = {}) {
  if (clearHistory) state.globalAgentHistory = [];
  state.globalAgentUndo = [];
  clearGlobalAgentSelectionState();
  const input = $("#cms-global-agent-input");
  if (input) input.value = "";
  renderGlobalAgent();
}

function ensureGlobalAgentContextSession() {
  const key = getGlobalAgentContextKey();
  if (state.globalAgentContextKey === key) return;
  const historyLength = (state.globalAgentHistory || []).length;
  state.globalAgentContextKey = key;
  state.globalAgentUndo = [];
  clearGlobalAgentSelectionState();
  syncGlobalAgentSelectionUi();
  renderGlobalAgent();
  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
    body: JSON.stringify({
      sessionId: "365eeb",
      runId: "history-persist",
      hypothesisId: "H1-context",
      location: "cms.js:ensureGlobalAgentContextSession",
      message: "Context changed; chat history preserved",
      data: { key, historyLength, preserved: (state.globalAgentHistory || []).length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function syncGlobalAgentUi() {
  ensureGlobalAgentContextSession();
  const mode = getGlobalAgentMode();
  const titleEl = $("#cms-global-agent-title");
  const leadEl = $("#cms-global-agent-lead");
  const modeEl = $("#cms-global-agent-mode");
  const input = $("#cms-global-agent-input");
  const meta = {
    general: {
      kicker: "CMS assistant",
      title: "Lango assistant",
      lead: "Ask about courses, sections, hosting, imports, or what to do next on this page.",
      placeholder: "Ask Lango anything about the CMS…",
    },
    "exercise-edit": {
      kicker: "Exercise edit",
      title: "Exercise assistant",
      lead: "Highlight a question or option on the left, then ask for edits here.",
      placeholder: "Revise this exercise…",
    },
    "ai-review": {
      kicker: "AI review",
      title: "Review assistant",
      lead: "Highlight generated questions on the left, then ask for edits here.",
      placeholder: "Revise generated exercises…",
    },
  }[mode];
  if (modeEl) modeEl.textContent = meta.kicker;
  if (titleEl) titleEl.textContent = meta.title;
  if (leadEl) leadEl.textContent = meta.lead;
  if (input && document.activeElement !== input) input.placeholder = meta.placeholder;
  syncGlobalAgentSelectionUi();
  renderGlobalAgent();
}

function syncGlobalAgentSelectionUi() {
  const wrap = $("#cms-global-agent-selection");
  const textEl = $("#cms-global-agent-selection-text");
  const selection = String(state.globalAgentSelection || "").trim();
  if (wrap) wrap.hidden = !selection;
  if (textEl) textEl.textContent = selection;
}

function buildGlobalAgentRequest(rawRequest) {
  const message = String(rawRequest || "").trim();
  const selection = String(state.globalAgentSelection || "").trim();
  if (!selection) return message;
  const quoted = selection.length > 280 ? `${selection.slice(0, 280)}…` : selection;
  if (!message) return `Revise the selected text:\n"${quoted}"`;
  return `Regarding this selected text:\n"${quoted}"\n\n${message}`;
}

function setGlobalAgentSelection(text, questionNumber) {
  const next = String(text || "").trim();
  if (!next) return;
  state.globalAgentSelection = next;
  const parsedNumber = Number(questionNumber);
  state.globalAgentSelectionQuestion =
    Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
  syncGlobalAgentSelectionUi();
  openGlobalAgent();
  $("#cms-global-agent-input")?.focus();
}

function clearGlobalAgentSelection() {
  state.globalAgentSelection = "";
  state.globalAgentSelectionQuestion = null;
  syncGlobalAgentSelectionUi();
  hideGlobalSelectionAddButton();
}

function hideGlobalSelectionAddButton() {
  const btn = $("#cms-global-selection-add");
  if (btn) {
    btn.hidden = true;
    btn.style.top = "";
    btn.style.left = "";
  }
  state.globalAgentPendingSelection = "";
  state.globalAgentPendingQuestionNumber = null;
}

function positionGlobalSelectionAddButtonAtPoint(clientX, clientY) {
  const btn = $("#cms-global-selection-add");
  if (!btn) return;
  btn.style.top = `${Math.max(8, clientY + 8)}px`;
  btn.style.left = `${Math.max(8, clientX - 48)}px`;
  btn.hidden = false;
}

function positionGlobalSelectionAddButton(selection) {
  const btn = $("#cms-global-selection-add");
  if (!btn || !selection?.rangeCount) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hideGlobalSelectionAddButton();
    return;
  }
  btn.style.top = `${Math.max(8, rect.bottom + 6)}px`;
  btn.style.left = `${Math.max(8, rect.left + rect.width / 2 - 48)}px`;
  btn.hidden = false;
}

function isGlobalAgentSelectableField(field) {
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return false;
  return field.matches(
    ".cms-ai-item-input, .cms-ai-item-textarea, .cms-ai-item-question, .cms-ai-opt-text, .cms-q-text, .cms-opt-text, .cms-buzzin-topic, .cms-buzzin-correct-answer, .cms-exercise-title, [data-field='subTitle'], #course-name, #course-description, .cms-section-title"
  );
}

function getGlobalSelectionQuestionNumberFromNode(node) {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const aiBlock = element?.closest?.(".cms-ai-item-block");
  if (aiBlock) {
    const number = Number(aiBlock.dataset?.questionNumber);
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  const block = element?.closest?.(".cms-question-block, .cms-buzzin-topic-block");
  const qIdx = Number(block?.dataset?.q);
  return Number.isFinite(qIdx) && qIdx >= 0 ? qIdx + 1 : null;
}

function getGlobalAgentRevisionMaterial(card) {
  const aiMaterial = getAiMaterialText();
  if (aiMaterial) return aiMaterial;
  const section = state.sections[state.editingSectionIndex];
  const exercise = card ? collectExerciseFromCard(card) : null;
  const parts = [
    section?.title ? `Section: ${section.title}` : "",
    state.editingCourse?.name ? `Course: ${state.editingCourse.name}` : "",
    state.editingCourse?.description ? `Course description: ${state.editingCourse.description}` : "",
    exercise ? `Current exercise JSON:\n${JSON.stringify(exercise, null, 2)}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

function syncGlobalAgentDockVisibility() {
  const dock = $("#cms-global-agent-dock");
  if (!dock) return;
  const loggedIn = !!(state.token && state.user);
  const onLogin = getActiveCmsScreenId() === "login";
  dock.hidden = !loggedIn || onLogin;
}

function getAiReviewScrollMetrics() {
  const preview = $("#cms-ai-preview");
  const blocks = preview ? [...preview.querySelectorAll(".cms-ai-item-block")] : [];
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const firstRect = first?.getBoundingClientRect?.();
  const lastRect = last?.getBoundingClientRect?.();
  return {
    scrollY: window.scrollY,
    viewportHeight,
    blockCount: blocks.length,
    firstQuestionNumber: first?.dataset?.questionNumber || null,
    lastQuestionNumber: last?.dataset?.questionNumber || null,
    firstTop: firstRect?.top ?? null,
    lastTop: lastRect?.top ?? null,
    firstVisible: firstRect ? firstRect.top >= 0 && firstRect.top < viewportHeight : null,
    lastVisible: lastRect ? lastRect.top >= 0 && lastRect.top < viewportHeight : null,
  };
}

const CMS_REVIEW_AGENT_GAP_PX = 16;

function clearAiReviewWizardInlineLayout(wizard) {
  if (!wizard) return;
  wizard.style.maxWidth = "";
  wizard.style.width = "";
  wizard.style.marginLeft = "";
  wizard.style.marginRight = "";
}

function measureAiReviewWizardWidth(wizard, agentPanel) {
  const agentRect = agentPanel?.getBoundingClientRect?.();
  const anchorRect = wizard?.parentElement?.getBoundingClientRect?.();
  if (!agentRect || !anchorRect) return null;
  return Math.max(320, Math.floor(agentRect.left - anchorRect.left - CMS_REVIEW_AGENT_GAP_PX));
}

function applyAiReviewWizardLayout() {
  const onReview = Boolean(state.aiWizardActive && state.aiWizardStep === 3);
  const agentOpen = onReview && Boolean(state.globalAgentOpen);
  const wizard = $("#cms-ai-wizard");
  const agentPanel = $("#cms-global-agent");

  document.body.classList.toggle("cms-ai-review-active", onReview);
  document.body.classList.toggle("cms-review-agent-open", agentOpen);
  wizard?.classList.toggle("is-review-agent-open", agentOpen);

  if (!wizard) return;

  if (agentOpen) {
    wizard.style.marginLeft = "0";
    wizard.style.marginRight = "0";
    wizard.style.width = "100%";
    const targetWidth = measureAiReviewWizardWidth(wizard, agentPanel);
    if (targetWidth != null) wizard.style.maxWidth = `${targetWidth}px`;
  } else {
    clearAiReviewWizardInlineLayout(wizard);
  }

  const wizardRect = wizard.getBoundingClientRect?.();
  const agentRect = agentPanel?.getBoundingClientRect?.();
  const wizardStyle = getComputedStyle(wizard);
  const gapPx = wizardRect && agentRect ? agentRect.left - wizardRect.right : null;
  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
    body: JSON.stringify({
      sessionId: "365eeb",
      location: "cms.js:applyAiReviewWizardLayout",
      message: "review layout applied",
      data: {
        onReview,
        agentOpen,
        targetWidth: agentOpen ? measureAiReviewWizardWidth(wizard, agentPanel) : null,
        wizardWidth: wizard.offsetWidth,
        wizardLeft: wizardRect?.left ?? null,
        wizardRight: wizardRect?.right ?? null,
        wizardMarginRight: wizardStyle.marginRight,
        agentPanelLeft: agentRect?.left ?? null,
        gapPx,
        overlap: wizardRect && agentRect ? wizardRect.right > agentRect.left + 8 : null,
        ...getAiReviewScrollMetrics(),
      },
      timestamp: Date.now(),
      hypothesisId: "H8",
      runId: "review-layout-v4",
    }),
  }).catch(() => {});
  // #endregion
}

function syncAiReviewAgentLayout() {
  applyAiReviewWizardLayout();
  if (state.aiWizardActive && state.aiWizardStep === 3 && state.globalAgentOpen) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyAiReviewWizardLayout();
      });
    });
  }
}

function scrollAiPreviewToStart({ smooth = false, reason = "" } = {}) {
  if (state.aiWizardStep !== 3) return;
  const preview = $("#cms-ai-preview");
  if (!preview) return;
  const before = getAiReviewScrollMetrics();
  const anchor =
    preview.querySelector(".cms-ai-item-block") ||
    preview.querySelector(".cms-ai-course-preview-group") ||
    $(".cms-ai-review-main");
  if (!anchor) return;
  const topbar = document.querySelector(".cms-topbar");
  const stickyOffset = (topbar?.offsetHeight || 0) + 16;
  const targetY = anchor.getBoundingClientRect().top + window.scrollY - stickyOffset;
  window.scrollTo({ top: Math.max(0, targetY), behavior: smooth ? "smooth" : "auto" });
  requestAnimationFrame(() => {
    const after = getAiReviewScrollMetrics();
    // #region agent log
    fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
      body: JSON.stringify({
        sessionId: "365eeb",
        location: "cms.js:scrollAiPreviewToStart",
        message: "scroll preview to start",
        data: {
          reason,
          before,
          after,
          stickyOffset,
          targetY: Math.max(0, targetY),
          hasTarget: Boolean(anchor),
        },
        timestamp: Date.now(),
        hypothesisId: "H4",
        runId: "review-layout-v2",
      }),
    }).catch(() => {});
    // #endregion
  });
}

function scheduleAiPreviewScrollToStart(reason) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollAiPreviewToStart({ reason });
    });
  });
}

function openGlobalAgent() {
  const dock = $("#cms-global-agent-dock");
  const panel = $("#cms-global-agent");
  const toggle = $("#btn-cms-global-agent-toggle");
  if (!dock || !panel) return;
  syncGlobalAgentUi();
  dock.hidden = false;
  dock.classList.add("is-open");
  panel.hidden = false;
  panel.removeAttribute("aria-hidden");
  toggle?.setAttribute("aria-expanded", "true");
  state.globalAgentOpen = true;
  renderGlobalAgent();
  syncAiReviewAgentLayout();
}

function closeGlobalAgent() {
  const dock = $("#cms-global-agent-dock");
  const panel = $("#cms-global-agent");
  const toggle = $("#btn-cms-global-agent-toggle");
  if (!dock || !panel) return;
  dock.classList.remove("is-open");
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  toggle?.setAttribute("aria-expanded", "false");
  state.globalAgentOpen = false;
  hideGlobalSelectionAddButton();
  syncGlobalAgentDockVisibility();
  syncAiReviewAgentLayout();
}

function renderGlobalAgent() {
  const log = $("#cms-global-agent-log");
  const undo = $("#btn-cms-global-agent-undo");
  const history = state.globalAgentHistory || [];
  const busy = Boolean(state.globalAgentBusy || state.aiWizardBusy);
  const mode = getGlobalAgentMode();
  if (log) {
    const turns = history
      .map(
        (turn) => `
        <div class="cms-ai-agent-turn cms-ai-agent-turn--${turn.role === "assistant" ? "assistant" : "user"}">
          <div class="cms-ai-agent-avatar" aria-hidden="true">${turn.role === "assistant" ? "AI" : "You"}</div>
          <div class="cms-ai-agent-bubble">
            <p>${escapeHtml(turn.content || "")}</p>
          </div>
        </div>`
      )
      .join("");
    const welcomeCopy =
      mode === "exercise-edit"
        ? "Hi — highlight any question or answer on the left and click <strong>Add to chat</strong>, or type a revision here."
        : mode === "ai-review"
          ? "Hi — highlight any question text on the left and click <strong>Add to chat</strong>, or type a revision here."
          : "Hi — I can help with courses, sections, AI generation, publishing, and hosting. What do you need?";
    const welcome =
      turns ||
      `<div class="cms-ai-agent-turn cms-ai-agent-turn--assistant cms-ai-agent-turn--welcome">
        <div class="cms-ai-agent-avatar" aria-hidden="true">AI</div>
        <div class="cms-ai-agent-bubble"><p>${welcomeCopy}</p></div>
      </div>`;
    const typing = busy
      ? `<div class="cms-ai-agent-turn cms-ai-agent-turn--assistant cms-ai-agent-turn--typing" aria-live="polite">
          <div class="cms-ai-agent-avatar" aria-hidden="true">AI</div>
          <div class="cms-ai-agent-bubble"><span class="cms-ai-agent-typing">Thinking…</span></div>
        </div>`
      : "";
    log.innerHTML = welcome + typing;
    log.scrollTop = log.scrollHeight;
  }
  if (undo) undo.hidden = !(state.globalAgentUndo || []).length || mode === "general";
}

function syncGlobalAgentBusy() {
  const busy = Boolean(state.globalAgentBusy || state.aiWizardBusy);
  const panel = $("#cms-global-agent");
  const apply = $("#btn-cms-global-agent-apply");
  const input = $("#cms-global-agent-input");
  const undo = $("#btn-cms-global-agent-undo");
  panel?.classList.toggle("is-busy", busy);
  if (apply) {
    apply.disabled = busy;
    apply.classList.toggle("is-loading", busy);
    apply.setAttribute("aria-busy", busy ? "true" : "false");
  }
  if (input) input.disabled = busy;
  if (undo) undo.disabled = busy || !(state.globalAgentUndo || []).length;
  renderGlobalAgent();
}

async function applyGlobalRevisionMessage(rawRequest, { draftExercises, onApplied }) {
  const errorEl =
    getGlobalAgentMode() === "exercise-edit" ? $("#cms-exercises-error") : $("#cms-ai-error");
  const statusEl = $("#cms-ai-generate-status");
  const revision = buildGlobalAgentRequest(rawRequest);
  if (!revision) {
    if (errorEl) errorEl.textContent = "Describe the change you want.";
    return false;
  }
  if (state.globalAgentBusy || state.aiWizardBusy) return false;

  const material =
    getGlobalAgentMode() === "exercise-edit"
      ? getGlobalAgentRevisionMaterial(getOpenExerciseCard())
      : getAiMaterialText();
  if (!material) {
    if (errorEl) errorEl.textContent = "Source material or exercise content is required to revise.";
    return false;
  }

  const settings = getAiGenerationSettings();
  const snapshot = cloneAiDraft(draftExercises);
  if (errorEl) setCmsError(errorEl, "");
  state.globalAgentBusy = true;
  syncGlobalAgentBusy();
  try {
    const data = await api("/api/cms/revise-exercises", {
      method: "POST",
      body: {
        material,
        langCode: settings.langCode || state.editingCourse?.langCode || "en",
        difficulty: settings.difficulty,
        instructions: getAiInstructions() || undefined,
        revision,
        exercises: draftExercises,
        history: (state.globalAgentHistory || []).slice(-8),
        imageAssets: state.aiMaterialAssets?.length ? state.aiMaterialAssets : undefined,
        questionNumber: state.globalAgentSelectionQuestion || undefined,
      },
    });
    let next = data.exercises || [];
    if (!next.length) throw new Error("The assistant returned no questions.");
    const convertIntent = parseAiConvertIntent(revision, state.globalAgentSelectionQuestion);
    if (convertIntent && data.revisionMode !== "convert-in-place") {
      next = applyInPlaceQuestionReplacement(draftExercises, next, convertIntent);
    }
    state.globalAgentUndo = [...(state.globalAgentUndo || []), snapshot].slice(-8);
    onApplied(next, data, convertIntent);
    state.globalAgentHistory = [
      ...(state.globalAgentHistory || []),
      {
        role: "user",
        content:
          String(rawRequest || "").trim() ||
          (state.globalAgentSelection ? "Revise selected text" : revision),
      },
      { role: "assistant", content: data.summary || "Updated the exercises." },
    ].slice(-8);
    const input = $("#cms-global-agent-input");
    if (input) input.value = "";
    clearGlobalAgentSelection();
    renderGlobalAgent();
    return true;
  } catch (err) {
    if (errorEl) setCmsError(errorEl, err.message);
    if (statusEl && getGlobalAgentMode() === "ai-review") statusEl.textContent = "";
    return false;
  } finally {
    state.globalAgentBusy = false;
    syncGlobalAgentBusy();
  }
}

async function applyGlobalAgentMessage(rawRequest) {
  openGlobalAgent();
  const mode = getGlobalAgentMode();
  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
    body: JSON.stringify({
      sessionId: "365eeb",
      runId: "phase3-verify",
      hypothesisId: "P3-mode",
      location: "cms.js:applyGlobalAgentMessage",
      message: "Global agent message routed",
      data: { mode, screen: getActiveCmsScreenId(), hasMessage: !!String(rawRequest || "").trim() },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (mode === "ai-review") {
    collectAiDraftFromDom();
    const draft = state.aiDraftExercises || [];
    if (!draft.some((exercise) => (exercise.items || []).length && exercise.type !== "video")) {
      $("#cms-ai-error").textContent = "Generate questions first, then ask the assistant to edit them.";
      return false;
    }
    return applyGlobalRevisionMessage(rawRequest, {
      draftExercises: draft,
      onApplied: (next, data, convertIntent) => {
        state.aiDraftExercises = next;
        renderAiPreview(state.aiDraftExercises);
        showAiGenSummary(
          convertIntent
            ? `Moved the new question to position ${convertIntent.questionNumber}.`
            : data.summary || buildAiGenSummaryFromExercises(next)
        );
        $("#cms-ai-generate-status").textContent =
          convertIntent
            ? `Question ${convertIntent.questionNumber} updated in place.`
            : data.summary || "Questions updated.";
      },
    });
  }
  if (mode === "exercise-edit") {
    const card = getOpenExerciseCard();
    if (!card) return false;
    syncExercisesFromDomIfRendered();
    const sectionIndex = state.editingSectionIndex;
    const exerciseIndex = Number(card.dataset.exerciseIndex);
    const section = state.sections[sectionIndex];
    const exercise = section?.exercises?.[exerciseIndex] || collectExerciseFromCard(card);
    return applyGlobalRevisionMessage(rawRequest, {
      draftExercises: [exercise],
      onApplied: (next, data) => {
        const nextExercise = next[0];
        if (section?.exercises?.[exerciseIndex]) {
          section.exercises[exerciseIndex] = {
            ...section.exercises[exerciseIndex],
            ...nextExercise,
            id: section.exercises[exerciseIndex].id,
            order: section.exercises[exerciseIndex].order,
          };
        }
        card.querySelector('[data-field="title"]').value = nextExercise.title || exercise.title || "";
        card.querySelector('[data-field="subTitle"]').value =
          nextExercise.subTitle || exerciseSubTitleForType(nextExercise.type || exercise.type);
        const typeSelect = card.querySelector(".cms-exercise-type-select");
        if (typeSelect && nextExercise.type) typeSelect.value = nextExercise.type;
        renderExerciseBody(card, section.exercises[exerciseIndex] || nextExercise);
        $("#cms-exercises-status").textContent = data.summary || "Exercise updated.";
        updateExercisesViewDurationEstimate();
        markCmsDirty();
      },
    });
  }

  const message = String(rawRequest || "").trim();
  if (!message) {
    const err =
      getActiveCmsScreenId() === "dashboard"
        ? $("#cms-dashboard-error")
        : getActiveCmsScreenId() === "list"
          ? $("#cms-list-error")
          : getActiveTabId() === "sections"
            ? $("#cms-sections-error")
            : $("#cms-details-error");
    if (err) err.textContent = "Enter a message for the assistant.";
    return false;
  }

  state.globalAgentBusy = true;
  syncGlobalAgentBusy();
  try {
    const data = await api("/api/cms/assistant", {
      method: "POST",
      body: {
        message,
        history: (state.globalAgentHistory || []).slice(-8),
        context: getGlobalAgentContext(),
      },
    });
    state.globalAgentHistory = [
      ...(state.globalAgentHistory || []),
      { role: "user", content: message },
      { role: "assistant", content: data.reply || "Done." },
    ].slice(-8);
    const input = $("#cms-global-agent-input");
    if (input) input.value = "";
    clearGlobalAgentSelection();
    renderGlobalAgent();
    return true;
  } catch (err) {
    const errEl =
      getActiveCmsScreenId() === "dashboard"
        ? $("#cms-dashboard-error")
        : getActiveCmsScreenId() === "list"
          ? $("#cms-list-error")
          : getActiveTabId() === "sections"
            ? $("#cms-sections-error")
            : $("#cms-details-error");
    if (errEl) errEl.textContent = err.message;
    return false;
  } finally {
    state.globalAgentBusy = false;
    syncGlobalAgentBusy();
  }
}

function undoGlobalAgentRevision() {
  const mode = getGlobalAgentMode();
  const snapshot = (state.globalAgentUndo || []).pop();
  if (!snapshot) return;
  if (mode === "ai-review") {
    state.aiDraftExercises = snapshot;
    if ((state.globalAgentHistory || []).length >= 2) {
      state.globalAgentHistory = state.globalAgentHistory.slice(0, -2);
    }
    renderAiPreview(state.aiDraftExercises);
    showAiGenSummary(buildAiGenSummaryFromExercises(snapshot));
    renderGlobalAgent();
    return;
  }
  if (mode === "exercise-edit") {
    const card = getOpenExerciseCard();
    if (!card) return;
    const sectionIndex = state.editingSectionIndex;
    const exerciseIndex = Number(card.dataset.exerciseIndex);
    const section = state.sections[sectionIndex];
    if (section?.exercises?.[exerciseIndex]) {
      section.exercises[exerciseIndex] = {
        ...section.exercises[exerciseIndex],
        ...snapshot,
        id: section.exercises[exerciseIndex].id,
        order: section.exercises[exerciseIndex].order,
      };
    }
    card.querySelector('[data-field="title"]').value = snapshot.title || "";
    card.querySelector('[data-field="subTitle"]').value = snapshot.subTitle || "";
    const typeSelect = card.querySelector(".cms-exercise-type-select");
    if (typeSelect && snapshot.type) typeSelect.value = snapshot.type;
    renderExerciseBody(card, snapshot);
    if ((state.globalAgentHistory || []).length >= 2) {
      state.globalAgentHistory = state.globalAgentHistory.slice(0, -2);
    }
    renderGlobalAgent();
    updateExercisesViewDurationEstimate();
    markCmsDirty();
  }
}

function initGlobalAgentSelection() {
  document.addEventListener("mouseup", (event) => {
    if (!state.globalAgentOpen || getGlobalAgentMode() === "general") return;
    const targetRoot =
      getGlobalAgentMode() === "ai-review"
        ? $(".cms-ai-review-main")
        : $("#cms-exercise-edit-main");
    if (!targetRoot || !targetRoot.contains(event.target)) return;
    const clientX = event.clientX;
    const clientY = event.clientY;
    requestAnimationFrame(() => {
      const field = event.target.closest(
        "textarea, input.cms-ai-item-question, input.cms-ai-opt-text, input.cms-q-text, input.cms-opt-text, input.cms-buzzin-topic, input.cms-buzzin-correct-answer, .cms-exercise-title, [data-field='subTitle']"
      );
      if (field && targetRoot.contains(field) && isGlobalAgentSelectableField(field)) {
        const fieldText = getReviewFieldSelectionText(field);
        if (fieldText.length >= 2) {
          state.globalAgentPendingSelection = fieldText;
          state.globalAgentPendingQuestionNumber = getGlobalSelectionQuestionNumberFromNode(field);
          positionGlobalSelectionAddButtonAtPoint(clientX, clientY);
          return;
        }
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
        hideGlobalSelectionAddButton();
        return;
      }
      if (!targetRoot.contains(selection.anchorNode) || !targetRoot.contains(selection.focusNode)) {
        hideGlobalSelectionAddButton();
        return;
      }
      const text = selection.toString().trim();
      if (text.length < 2) {
        hideGlobalSelectionAddButton();
        return;
      }
      state.globalAgentPendingSelection = text;
      state.globalAgentPendingQuestionNumber =
        getGlobalSelectionQuestionNumberFromNode(selection.anchorNode) ||
        getGlobalSelectionQuestionNumberFromNode(selection.focusNode) ||
        parseQuestionNumberFromSelectionLabel(text);
      positionGlobalSelectionAddButton(selection);
    });
  });

  document.addEventListener("selectionchange", () => {
    if (!state.globalAgentOpen || getGlobalAgentMode() === "general") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) hideGlobalSelectionAddButton();
  });

  $("#cms-global-selection-add")?.addEventListener("click", () => {
    if (state.globalAgentPendingSelection) {
      setGlobalAgentSelection(
        state.globalAgentPendingSelection,
        state.globalAgentPendingQuestionNumber
      );
    }
    hideGlobalSelectionAddButton();
    window.getSelection()?.removeAllRanges();
  });

  $("#btn-cms-global-agent-clear-selection")?.addEventListener("click", clearGlobalAgentSelection);
  $("#btn-cms-global-agent-toggle")?.addEventListener("click", () => {
    if (state.globalAgentOpen) closeGlobalAgent();
    else openGlobalAgent();
  });
  $("#btn-cms-global-agent-close")?.addEventListener("click", closeGlobalAgent);
  $("#cms-global-agent-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    applyGlobalAgentMessage($("#cms-global-agent-input")?.value);
  });
  $("#cms-global-agent-input")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    applyGlobalAgentMessage($("#cms-global-agent-input")?.value);
  });
  $("#btn-cms-global-agent-undo")?.addEventListener("click", () => {
    if (state.globalAgentBusy || state.aiWizardBusy) return;
    undoGlobalAgentRevision();
  });
  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
    body: JSON.stringify({
      sessionId: "365eeb",
      runId: "phase3-verify",
      hypothesisId: "P3-init",
      location: "cms.js:initGlobalAgentSelection",
      message: "Global agent initialized",
      data: { dock: !!$("#cms-global-agent-dock"), panel: !!$("#cms-global-agent") },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function showCmsScreen(id) {
  document.querySelectorAll(".cms-app .screen").forEach((s) => s.classList.remove("active"));
  const screen = document.querySelector(`#screen-cms-${id}`);
  if (!screen) return;
  screen.classList.add("active");
  cmsMotion()?.playCmsScreenEnter?.(screen);
  syncGlobalAgentDockVisibility();
  if (state.globalAgentOpen) syncGlobalAgentUi();
}

function updateAuthUi() {
  const loggedIn = !!(state.token && state.user);
  $("#cms-teacher-label").hidden = !loggedIn;
  $("#btn-cms-logout").hidden = !loggedIn;
  if (loggedIn) {
    const name = teacherDisplayName();
    const label = $("#cms-teacher-label");
    label.textContent = name;
    label.title = `Logged in as ${name}`;
  }
  syncGlobalAgentDockVisibility();
}

async function handleLogin() {
  const username = $("#cms-login-username").value.trim().toLowerCase();
  const password = $("#cms-login-password").value;
  $("#cms-login-error").textContent = "";

  if (!username || !password) {
    $("#cms-login-error").textContent = "Enter username and password.";
    return;
  }

  const btn = $("#btn-cms-login");
  btn.disabled = true;
  try {
    const data = await api("/api/lango/login", {
      method: "POST",
      body: { username, password },
    });
    if (!data.user?.token) throw new Error("Login succeeded but no token returned.");

    state.user = data.user;
    state.token = data.user.token;
    state.loginUsername = username;
    savePrefs();
    updateAuthUi();
    await enterHome();
  } catch (err) {
    $("#cms-login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function handleLogout() {
  state.token = null;
  state.user = null;
  state.editingCourse = null;
  state.sections = [];
  savePrefs();
  updateAuthUi();
  resetGlobalAgentSession({ clearHistory: true });
  closeGlobalAgent();
  closeCommunityPreview();
  applyTeacherLoginDefaults(
    $("#cms-login-username"),
    $("#cms-login-password"),
    state.loginUsername
  );
  showCmsScreen("login");
}

function assignedClassesLabel(course) {
  const ids = course.classIds || [];
  if (!ids.length) return "All classes";
  if (ids.length === 1) {
    const match = state.classes.find((c) => c.id === ids[0]);
    return match?.name || `Class ${ids[0]}`;
  }
  return `${ids.length} classes`;
}

function courseBannerUrl(course) {
  return (course?.banner || "").trim();
}

function updateBannerPreview(url) {
  const preview = $("#course-banner-preview");
  const img = $("#course-banner-img");
  const removeBtn = $("#btn-remove-banner");
  const bannerUrl = (url || "").trim();
  if (!preview || !img) return;

  img.src = bannerUrl || CMS_EMPTY_COVER;
  preview.hidden = false;
  if (removeBtn) removeBtn.hidden = !bannerUrl;
}

function uploadAuthHeaders() {
  const headers = { Accept: "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  headers["X-Teacher-Id"] = String(state.user?.id || "");
  return headers;
}

function parseUploadResponse(text, status) {
  if (!text) return { message: `Upload failed (${status})` };
  try {
    return JSON.parse(text);
  } catch {
    const pre = text.match(/<pre>([^<]+)<\/pre>/i)?.[1]?.trim();
    if (pre?.includes("Cannot POST")) {
      return { message: "Image upload is unavailable. Restart the server and try again." };
    }
    if (pre) return { message: pre };
    return { message: `Upload failed (${status})` };
  }
}

async function uploadBannerFile(file) {
  if (!state.editingCourse) throw new Error("No course selected.");
  if (!file) throw new Error("No file selected.");

  const formData = new FormData();
  formData.append("banner", file);

  const res = await fetch(`/api/cms/courses/${state.editingCourse.id}/banner`, {
    method: "POST",
    headers: uploadAuthHeaders(),
    body: formData,
  });

  const data = parseUploadResponse(await res.text(), res.status);
  if (!res.ok) {
    throw new Error(data?.message || `Upload failed (${res.status})`);
  }

  return data;
}

async function loadClasses() {
  const data = await api("/api/lango/classList");
  state.classes = extractClassList(data);
  return state.classes;
}

function getSelectedClassIds() {
  return [...document.querySelectorAll("#course-class-list input[type=checkbox]:checked")].map((el) =>
    Number(el.value)
  );
}

function renderAssignedClasses() {
  const container = $("#course-class-list");
  const statusEl = $("#cms-classes-status");
  if (!container) return;

  const assigned = new Set(state.editingCourse?.classIds || []);

  if (!state.classes.length) {
    container.innerHTML = "";
    statusEl.textContent = "No classes found for this teacher.";
    return;
  }

  statusEl.textContent = assigned.size
    ? `${assigned.size} class${assigned.size === 1 ? "" : "es"} selected`
    : "Available for all classes";

  const sections = groupClassesByLevel(state.classes);
  container.innerHTML = sections
    .map((section) => {
      const heading = section.label
        ? `<h3 class="cms-class-section-title">${escapeHtml(section.label)}</h3>`
        : "";
      const rows = section.items
        .map((classItem) => {
          const checked = assigned.has(classItem.id) ? " checked" : "";
          const title = classItem.name || `Class ${classItem.id}`;
          return `<label class="cms-class-option">
            <input type="checkbox" value="${classItem.id}"${checked} />
            <span>${escapeHtml(title)}</span>
          </label>`;
        })
        .join("");
      return `<section class="cms-class-section">${heading}<div class="cms-class-grid">${rows}</div></section>`;
    })
    .join("");
}


function formatDashboardRelativeTime(iso) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}

function renderDashboardClassPicker() {
  const select = $("#cms-dashboard-class");
  if (!select) return;

  if (!state.classes.length) {
    select.innerHTML = '<option value="">No classes found</option>';
    select.disabled = true;
    return;
  }

  select.disabled = false;
  const options = ['<option value="">Select a class</option>'];
  for (const section of groupClassesByLevel(state.classes)) {
    if (section.label) {
      options.push(`<optgroup label="${escapeHtml(section.label)}">`);
    }
    for (const classItem of section.items) {
      const selected = state.dashboardClassId === classItem.id ? " selected" : "";
      const label = classItem.name || `Class ${classItem.id}`;
      options.push(`<option value="${classItem.id}"${selected}>${escapeHtml(label)}</option>`);
    }
    if (section.label) options.push("</optgroup>");
  }
  select.innerHTML = options.join("");
  if (state.dashboardClassId) select.value = String(state.dashboardClassId);
}

function renderDashboardSummary(courses) {
  const summary = $("#cms-dashboard-summary");
  if (!summary) return;

  const started = courses.filter((course) => course.started);
  const completed = courses.filter(
    (course) => course.totalExercises > 0 && course.completedCount >= course.totalExercises
  );
  const inProgress = started.filter(
    (course) => !(course.totalExercises > 0 && course.completedCount >= course.totalExercises)
  );

  if (!state.dashboardClassId || !courses.length) {
    summary.hidden = true;
    summary.innerHTML = "";
    return;
  }

  summary.hidden = false;
  summary.innerHTML = `
    <article class="cms-dashboard-stat">
      <span class="cms-dashboard-stat-value">${courses.length}</span>
      <span class="cms-dashboard-stat-label">Courses</span>
    </article>
    <article class="cms-dashboard-stat">
      <span class="cms-dashboard-stat-value">${inProgress.length}</span>
      <span class="cms-dashboard-stat-label">In progress</span>
    </article>
    <article class="cms-dashboard-stat">
      <span class="cms-dashboard-stat-value">${completed.length}</span>
      <span class="cms-dashboard-stat-label">Completed</span>
    </article>`;
}

function renderDashboardCourseList(courses) {
  const container = $("#cms-dashboard-list");
  const statusEl = $("#cms-dashboard-status");
  if (!container) return;

  if (!state.dashboardClassId) {
    container.innerHTML = `
      <div class="cms-empty cms-dashboard-empty">
        <p class="cms-empty-title">Choose a class</p>
        <p class="cms-empty-copy">Pick a class above to see course journey progress for that group.</p>
      </div>`;
    if (statusEl) statusEl.textContent = "";
    return;
  }

  if (!courses.length) {
    container.innerHTML = `
      <div class="cms-empty cms-dashboard-empty">
        <p class="cms-empty-title">No courses for this class</p>
        <p class="cms-empty-copy">Assign courses to this class in My courses, or create a new course.</p>
        <button type="button" class="btn secondary" id="btn-dashboard-go-courses">Go to My courses</button>
      </div>`;
    $("#btn-dashboard-go-courses")?.addEventListener("click", () => enterCourseList());
    if (statusEl) statusEl.textContent = "";
    return;
  }

  container.innerHTML = courses
    .map((course) => {
      const banner = (course.banner || "").trim();
      const thumb = banner
        ? `<img class="cms-dashboard-card-thumb" src="${escapeHtml(banner)}" alt="" />`
        : `<span class="cms-dashboard-card-thumb cms-dashboard-card-thumb--empty" aria-hidden="true"></span>`;
      const complete =
        course.totalExercises > 0 && course.completedCount >= course.totalExercises;
      const statusClass = complete
        ? " cms-dashboard-card--complete"
        : course.started
          ? " cms-dashboard-card--started"
          : "";
      const current =
        course.lastSectionTitle || course.lastExerciseTitle
          ? `${escapeHtml(course.lastSectionTitle || "Section")} · ${escapeHtml(course.lastExerciseTitle || "Exercise")}`
          : course.started
            ? "Started"
            : "Not started";
      const updated = course.updatedAt ? formatDashboardRelativeTime(course.updatedAt) : "No activity yet";
      const progressLabel =
        course.totalExercises > 0
          ? `${course.completedCount} / ${course.totalExercises} exercises`
          : "No exercises yet";

      return `<article class="cms-dashboard-card${statusClass}" data-id="${course.courseId}">
        <div class="cms-dashboard-card-media">${thumb}</div>
        <div class="cms-dashboard-card-body">
          <div class="cms-dashboard-card-head">
            <h2 class="cms-dashboard-card-title">${escapeHtml(course.name)}</h2>
            <span class="cms-dashboard-card-updated">${escapeHtml(updated)}</span>
          </div>
          <div class="cms-dashboard-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${course.percent}" aria-label="${escapeHtml(course.name)} progress">
            <span class="cms-dashboard-progress-bar" style="--progress: ${course.percent}%"></span>
          </div>
          <p class="cms-dashboard-card-meta">${escapeHtml(progressLabel)} · ${course.percent}%</p>
          <p class="cms-dashboard-card-current">Current: ${current}</p>
          <button type="button" class="btn secondary small cms-dashboard-edit" data-id="${course.courseId}">Edit course</button>
        </div>
      </article>`;
    })
    .join("");

  container.querySelectorAll(".cms-dashboard-edit").forEach((btn) => {
    btn.addEventListener("click", () => openCourseEditor(Number(btn.dataset.id)));
  });

  const activeCount = courses.filter((course) => course.started).length;
  if (statusEl) {
    statusEl.textContent = activeCount
      ? `${activeCount} course${activeCount === 1 ? "" : "s"} with activity`
      : "No progress recorded yet for this class";
  }
}

async function loadDashboardProgress() {
  $("#cms-dashboard-error").textContent = "";
  if (!state.dashboardClassId) {
    state.dashboardCourses = [];
    renderDashboardSummary([]);
    renderDashboardCourseList([]);
    return;
  }

  const data = await api(`/api/cms/dashboard/progress?classId=${state.dashboardClassId}`);
  state.dashboardCourses = data.courses || [];
  renderDashboardSummary(state.dashboardCourses);
  renderDashboardCourseList(state.dashboardCourses);
}

async function enterHome() {
  showCmsScreen("home");
  syncCmsNavScreen("home");
  const greeting = $("#cms-home-greeting");
  if (greeting) {
    const name = teacherDisplayName();
    greeting.textContent = name ? `Hi ${name}. Pick a task below.` : "Pick a task below.";
  }
}

async function handleHomeAction(action) {
  if (!state.token || !state.user) return;
  switch (action) {
    case "new-course":
      await createNewCourse();
      break;
    case "courses":
      await enterCourseList();
      break;
    case "community":
      await enterCommunity();
      break;
    case "progress":
      await enterDashboard();
      break;
    default:
      break;
  }
}

async function enterDashboard() {
  showCmsScreen("dashboard");
  syncCmsNavScreen("dashboard");
  $("#cms-dashboard-error").textContent = "";
  $("#cms-dashboard-status").textContent = "";
  $("#cms-dashboard-list").innerHTML = `
    <div class="cms-list-loading" aria-hidden="true">
      <div class="cms-skeleton-card"></div>
      <div class="cms-skeleton-card"></div>
      <div class="cms-skeleton-card"></div>
    </div>`;
  $("#cms-dashboard-summary").hidden = true;

  try {
    await loadClasses();
    renderDashboardClassPicker();
    await loadDashboardProgress();
  } catch (err) {
    $("#cms-dashboard-list").innerHTML = "";
    $("#cms-dashboard-error").textContent = err.message;
  }
}

function syncCmsNavScreen(screenId) {
  document.querySelectorAll(".cms-link-nav").forEach((link) => {
    const active = link.dataset.screen === screenId;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}


const LEGACY_COMMUNITY_LANG_LABELS = {
  yue: "Cantonese",
  es: "Spanish",
};

function communityLangLabel(code) {
  const key = String(code || "en").trim();
  const lower = key.toLowerCase();
  const match = state.cmsSpeakLanguages.find((entry) => entry.code.toLowerCase() === lower);
  if (match) return match.label;
  if (LEGACY_COMMUNITY_LANG_LABELS[lower]) return LEGACY_COMMUNITY_LANG_LABELS[lower];
  return key.toUpperCase();
}

function isHkElderlyCmsContext() {
  return (
    state.cmsAppVariant === "hk-elderly" ||
    state.cmsTtsProvider === "openrouter"
  );
}

/** HK elderly Grok TTS supports Cantonese; ensure it appears even if the server is stale. */
function patchElderlySpeakLanguages(languages) {
  const list = Array.isArray(languages) ? languages.slice() : [];
  if (!isHkElderlyCmsContext()) return list;
  if (list.some((entry) => String(entry.code).toLowerCase() === "yue")) return list;
  const enIdx = list.findIndex((entry) => String(entry.code).toLowerCase() === "en");
  list.splice(enIdx >= 0 ? enIdx + 1 : 0, 0, { code: "yue", label: "Cantonese" });
  return list;
}

function normalizeCmsSpeakLangCode(code) {
  const raw = String(code || state.cmsDefaultSpeakLangCode || "en")
    .trim()
    .toLowerCase();
  const match = state.cmsSpeakLanguages.find((entry) => entry.code.toLowerCase() === raw);
  if (match) return match.code;
  if (raw === "yue" && isHkElderlyCmsContext()) return "yue";
  if (raw === "es") {
    const es = state.cmsSpeakLanguages.find((entry) => /^es-/i.test(entry.code));
    if (es) return es.code;
  }
  return state.cmsDefaultSpeakLangCode || "en";
}

function renderCmsSpeakLangSelect() {
  const el = $("#cms-ai-speak-lang");
  if (!el) return;
  el.innerHTML = state.cmsSpeakLanguages
    .map(
      (entry) =>
        `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.label)}</option>`
    )
    .join("");
  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d0607f" },
    body: JSON.stringify({
      sessionId: "d0607f",
      runId: "pre-fix",
      hypothesisId: "H4",
      location: "cms.js:renderCmsSpeakLangSelect",
      message: "Speak language select rendered",
      data: {
        optionCount: el.options.length,
        labels: Array.from(el.options).map((o) => o.textContent),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  syncAiSpeakLangSelect();
}

async function loadCmsAppContext() {
  try {
    const res = await fetch("/api/cms/app-context");
    if (!res.ok) throw new Error("Could not load CMS app context.");
    const data = await res.json();
    state.cmsAppVariant = String(data.appVariant || "");
    state.cmsTtsProvider = String(data.ttsProvider || "inworld");
    state.cmsSpeakLanguages = patchElderlySpeakLanguages(
      Array.isArray(data.speakLanguages) && data.speakLanguages.length
        ? data.speakLanguages
        : CMS_FALLBACK_SPEAK_LANGUAGES.slice()
    );
    state.cmsDefaultSpeakLangCode = String(
      data.defaultSpeakLangCode || (isHkElderlyCmsContext() ? "yue" : "en")
    );
    // #region agent log
    fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d0607f" },
      body: JSON.stringify({
        sessionId: "d0607f",
        runId: "pre-fix",
        hypothesisId: "H2-H4",
        location: "cms.js:loadCmsAppContext:ok",
        message: "CMS app context loaded",
        data: {
          fetchUrl: "/api/cms/app-context",
          status: res.status,
          appVariant: state.cmsAppVariant,
          speakLanguageCount: state.cmsSpeakLanguages.length,
          ttsProvider: state.cmsTtsProvider,
          sampleCodes: state.cmsSpeakLanguages.slice(0, 3).map((e) => e.code),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (err) {
    // #region agent log
    fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d0607f" },
      body: JSON.stringify({
        sessionId: "d0607f",
        runId: "pre-fix",
        hypothesisId: "H3",
        location: "cms.js:loadCmsAppContext:catch",
        message: "CMS app context fetch failed",
        data: { error: String(err?.message || err) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    state.cmsSpeakLanguages = CMS_FALLBACK_SPEAK_LANGUAGES.slice();
    state.cmsDefaultSpeakLangCode = "en";
    state.cmsTtsProvider = "inworld";
  }
  renderCmsSpeakLangSelect();
  updateCmsSpeakLangHint();
}

function updateCmsSpeakLangHint() {
  const hint = document.querySelector(".cms-ai-speak-lang-hint");
  if (!hint) return;
  if (state.cmsTtsProvider === "openrouter") {
    hint.textContent =
      "Questions, answers, and AI speech during gameplay use this language (Grok Voice TTS).";
  } else {
    hint.textContent =
      "Questions, answers, and AI speech during gameplay use this language (Inworld TTS).";
  }
}

function getAiSpeakLangCode() {
  return normalizeCmsSpeakLangCode(
    $("#cms-ai-speak-lang")?.value || state.editingCourse?.langCode
  );
}

function syncAiSpeakLangSelect() {
  const el = $("#cms-ai-speak-lang");
  if (!el) return;
  const preferred = normalizeCmsSpeakLangCode(state.editingCourse?.langCode);
  el.value = preferred;
}

function communityCopiedInLibrary(listingId) {
  return (state.courses || []).some(
    (course) => Number(course.sourceCommunityId) === Number(listingId)
  );
}

function formatCommunityDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function courseCopiedFromCommunity(course) {
  return course?.sourceCommunityId != null && Number(course.sourceCommunityId) > 0;
}

function syncCommunityShareUi() {
  const shareBtn = $("#btn-community-share");
  const unshareBtn = $("#btn-community-unshare");
  const featured = $("#cms-community-featured");
  const featuredLabel = featured?.closest("label");
  const status = $("#cms-community-share-status");
  const listingId = state.editingCourse?.communityListingId;
  const published = listingId != null;
  const fromCommunity = courseCopiedFromCommunity(state.editingCourse);
  if (shareBtn) {
    shareBtn.hidden = fromCommunity;
    shareBtn.disabled = fromCommunity;
    if (!fromCommunity) {
      shareBtn.textContent = published ? "Update Community listing" : "Share to Community";
    }
  }
  if (unshareBtn) unshareBtn.hidden = !published || fromCommunity;
  if (featured) featured.checked = Boolean(state.editingCourse?.communityFeatured);
  if (featuredLabel) featuredLabel.hidden = fromCommunity;
  if (status) {
    status.textContent = fromCommunity
      ? "This course was added from Community and cannot be shared again. Edit it for your classes, or create a new course to publish."
      : published
        ? `This course is shared in Community. Updating replaces the public snapshot. Shared ${formatCommunityDate(state.editingCourse.communityPublishedAt) || "recently"}.`
        : "Share a snapshot of this course so other teachers can add it to My courses.";
  }
}

async function enterCommunity() {
  showCmsScreen("community");
  syncCmsNavScreen("community");
  $("#cms-community-error").textContent = "";
  $("#cms-community-status").textContent = "";
  const search = $("#cms-community-search");
  const lang = $("#cms-community-lang");
  const sort = $("#cms-community-sort");
  if (search && document.activeElement !== search) search.value = state.communityQuery || "";
  if (lang) lang.value = state.communityLang || "all";
  if (sort) sort.value = state.communitySort || "featured";
  $("#cms-community-list").innerHTML = `
    <div class="cms-list-loading" aria-hidden="true">
      <div class="cms-skeleton-card"></div>
      <div class="cms-skeleton-card"></div>
      <div class="cms-skeleton-card"></div>
    </div>`;
  await loadCommunityCourses();
}

async function loadCommunityCourses() {
  try {
    const params = new URLSearchParams();
    if (state.communityQuery) params.set("q", state.communityQuery);
    if (state.communityLang && state.communityLang !== "all") params.set("langCode", state.communityLang);
    if (state.communitySort) params.set("sort", state.communitySort);
    const data = await api(`/api/cms/community/courses?${params.toString()}`);
    state.communityCourses = data.courses || [];
    state.communityLanguages = data.languages || [];
    renderCommunityLangOptions();
    renderCommunityList();
    $("#cms-community-error").textContent = "";
    $("#cms-community-status").textContent = state.communityCourses.length
      ? `${state.communityCourses.length} public course${state.communityCourses.length === 1 ? "" : "s"}`
      : "";
  } catch (err) {
    $("#cms-community-list").innerHTML = "";
    $("#cms-community-status").textContent = "";
    $("#cms-community-error").textContent = err.message;
  }
}

function renderCommunityLangOptions() {
  const select = $("#cms-community-lang");
  if (!select) return;
  const current = state.communityLang || "all";
  const codes = ["all", ...state.communityLanguages.filter((code) => code && code !== "all")];
  select.innerHTML = codes
    .map((code) => {
      const label = code === "all" ? "All languages" : communityLangLabel(code);
      return `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  select.value = codes.includes(current) ? current : "all";
}

function renderCommunityList() {
  const container = $("#cms-community-list");
  if (!container) return;
  if (!state.communityCourses.length) {
    container.innerHTML = `
      <div class="cms-empty">
        <p class="cms-empty-title">No public courses yet</p>
        <p class="cms-empty-copy">Open a course in My courses and click Share to Community to publish a snapshot other teachers can add.</p>
      </div>`;
    cmsMotion()?.playCmsListReveal?.(container);
    return;
  }

  container.innerHTML = state.communityCourses
    .map((course) => {
      const banner = courseBannerUrl(course);
      const thumb = banner
        ? `<img class="cms-course-card-thumb" src="${escapeHtml(banner)}" alt="" />`
        : `<span class="cms-course-card-thumb cms-course-card-thumb--empty" aria-hidden="true"></span>`;
      const copied = course.alreadyCopied || communityCopiedInLibrary(course.id);
      const featured = course.featured ? `<span class="cms-community-badge">Featured</span>` : "";
      const owner = course.isOwner ? `<span class="cms-community-badge cms-community-badge--owner">Yours</span>` : "";
      return `<article class="cms-community-card${course.featured ? " is-featured" : ""}" data-id="${course.id}">
        <div class="cms-community-card-media">${thumb}</div>
        <div class="cms-community-card-body">
          <h3 class="cms-community-card-title">${escapeHtml(course.name)}</h3>
          <p class="cms-community-card-meta">${escapeHtml(course.authorName || "Teacher")} · ${escapeHtml(communityLangLabel(course.langCode))} · ${course.exerciseCount || 0} exercise${course.exerciseCount === 1 ? "" : "s"} · Added ${course.copyCount || 0}×</p>
          ${course.description ? `<p class="cms-community-card-desc">${escapeHtml(course.description)}</p>` : ""}
          <div class="cms-community-card-flags">${featured}${owner}</div>
          <div class="cms-community-card-actions">
            <button type="button" class="btn secondary small cms-community-preview-btn">Preview</button>
            <button type="button" class="btn primary small cms-community-add-btn"${copied ? " disabled" : ""}>${copied ? "In My courses" : "Add to My courses"}</button>
            ${
              course.isOwner
                ? `<button type="button" class="btn secondary small cms-community-unshare-btn">Unshare</button>`
                : `<button type="button" class="btn secondary small cms-community-report-btn">Report</button>`
            }
          </div>
        </div>
      </article>`;
    })
    .join("");
  cmsMotion()?.playCmsListReveal?.(container);
}

function closeCommunityPreview() {
  const overlay = $("#cms-community-preview");
  if (overlay) overlay.hidden = true;
  state.communityPreviewId = null;
}

async function openCommunityPreview(listingId) {
  const overlay = $("#cms-community-preview");
  if (!overlay) return;
  $("#cms-community-preview-error").textContent = "";
  overlay.hidden = false;
  state.communityPreviewId = listingId;
  $("#cms-community-preview-title").textContent = "Loading…";
  $("#cms-community-preview-copy").textContent = "";
  $("#cms-community-preview-meta").textContent = "";
  $("#cms-community-preview-sections").innerHTML = "";
  try {
    const data = await api(`/api/cms/community/courses/${listingId}`);
    const course = data.course || {};
    state.communityPreviewId = course.id;
    $("#cms-community-preview-kicker").textContent = course.featured
      ? "Featured community course"
      : "Community course";
    $("#cms-community-preview-title").textContent = course.name || "Untitled course";
    $("#cms-community-preview-meta").textContent = [
      course.authorName || "Teacher",
      communityLangLabel(course.langCode),
      `${course.sectionCount || 0} section${course.sectionCount === 1 ? "" : "s"}`,
      `${course.exerciseCount || 0} exercise${course.exerciseCount === 1 ? "" : "s"}`,
      course.publishedAt ? `Shared ${formatCommunityDate(course.publishedAt)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    $("#cms-community-preview-copy").textContent = course.description || "No description.";
    $("#cms-community-preview-sections").innerHTML = (course.sections || [])
      .map(
        (section) =>
          `<li><strong>${escapeHtml(section.title || "Section")}</strong> — ${section.exerciseCount || 0} exercise${section.exerciseCount === 1 ? "" : "s"}${
            section.types?.length ? ` (${escapeHtml(section.types.join(", "))})` : ""
          }</li>`
      )
      .join("");
    const copied = course.alreadyCopied || communityCopiedInLibrary(course.id);
    const addBtn = $("#btn-community-preview-add");
    const addLabel = addBtn?.querySelector("span");
    if (addBtn) addBtn.disabled = copied;
    if (addLabel) addLabel.textContent = copied ? "In My courses" : "Add to My courses";
    const reportBtn = $("#btn-community-preview-report");
    if (reportBtn) reportBtn.hidden = Boolean(course.isOwner);
  } catch (err) {
    $("#cms-community-preview-error").textContent = err.message;
  }
}

async function addCommunityCourse(listingId, { fromPreview = false } = {}) {
  const errorEl = fromPreview ? $("#cms-community-preview-error") : $("#cms-community-error");
  if (errorEl) errorEl.textContent = "";
  try {
    const data = await api(`/api/cms/community/courses/${listingId}/copy`, { method: "POST", body: {} });
    if (data.alreadyCopied) {
      showCmsToast("This course is already in My courses.");
    } else {
      showCmsToast(`Added “${data.course?.name || "course"}” to My courses.`);
    }
    closeCommunityPreview();
    if (data.course?.id && !data.alreadyCopied) {
      await openCourseEditor(data.course.id);
    } else {
      await loadCommunityCourses();
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message;
  }
}

async function reportCommunityCourse(listingId) {
  const reason = window.prompt("Why are you reporting this community course? (optional)") || "";
  try {
    const data = await api(`/api/cms/community/courses/${listingId}/report`, {
      method: "POST",
      body: { reason },
    });
    showCmsToast(data.hidden ? "Reported. This listing is now hidden." : "Reported. Thanks for the review.");
    closeCommunityPreview();
    await loadCommunityCourses();
  } catch (err) {
    $("#cms-community-error").textContent = err.message;
  }
}

async function shareEditingCourseToCommunity() {
  if (!state.editingCourse) return;
  if (courseCopiedFromCommunity(state.editingCourse)) {
    $("#cms-details-error").textContent = "Courses copied from Community cannot be shared again.";
    return;
  }
  $("#cms-details-error").textContent = "";
  try {
    const data = await api(`/api/cms/courses/${state.editingCourse.id}/community/publish`, {
      method: "POST",
      body: {
        authorName: teacherDisplayName(),
        featured: Boolean($("#cms-community-featured")?.checked),
      },
    });
    state.editingCourse = { ...state.editingCourse, ...data.course };
    syncCommunityShareUi();
    showCmsToast("Shared to Community.");
    $("#cms-details-status").textContent = "Shared to Community.";
  } catch (err) {
    $("#cms-details-error").textContent = err.message;
  }
}

async function unshareEditingCourseFromCommunity() {
  if (!state.editingCourse?.communityListingId) return;
  if (!window.confirm("Unshare this course from Community? Other teachers will no longer see the public listing.")) {
    return;
  }
  $("#cms-details-error").textContent = "";
  try {
    const data = await api(`/api/cms/courses/${state.editingCourse.id}/community/unpublish`, {
      method: "POST",
      body: {},
    });
    state.editingCourse = { ...state.editingCourse, ...data.course };
    syncCommunityShareUi();
    showCmsToast("Removed from Community.");
  } catch (err) {
    $("#cms-details-error").textContent = err.message;
  }
}

async function unshareCommunityListing(listingId) {
  if (!window.confirm("Unshare this course from Community?")) return;
  try {
    await api(`/api/cms/community/courses/${listingId}/unpublish`, { method: "POST", body: {} });
    if (Number(state.editingCourse?.communityListingId) === Number(listingId)) {
      state.editingCourse.communityListingId = null;
      state.editingCourse.communityPublishedAt = null;
      syncCommunityShareUi();
    }
    showCmsToast("Removed from Community.");
    await loadCommunityCourses();
  } catch (err) {
    $("#cms-community-error").textContent = err.message;
  }
}

async function enterCourseList() {
  showCmsScreen("list");
  syncCmsNavScreen("list");
  $("#cms-list-error").textContent = "";
  $("#cms-list-status").textContent = "";
  $("#cms-course-list").innerHTML = `
    <div class="cms-list-loading" aria-hidden="true">
      <div class="cms-skeleton-card"></div>
      <div class="cms-skeleton-card"></div>
      <div class="cms-skeleton-card"></div>
    </div>`;

  try {
    await loadClasses();
    const data = await api("/api/cms/courses");
    state.courses = data.courses || [];
    renderCourseList();
    $("#cms-list-status").textContent = state.courses.length
      ? `${state.courses.length} course${state.courses.length === 1 ? "" : "s"}`
      : "";
  } catch (err) {
    $("#cms-course-list").innerHTML = "";
    $("#cms-list-status").textContent = "";
    $("#cms-list-error").textContent = err.message;
  }
}

function renderCourseList() {
  const container = $("#cms-course-list");
  if (!state.courses.length) {
    container.innerHTML = `
      <div class="cms-empty">
        <p class="cms-empty-title">No courses yet</p>
        <p class="cms-empty-copy">Create your first course, then add sections and exercises for class.</p>
        <button type="button" class="btn primary cms-cta" id="btn-empty-new-course">
          <span>New course</span>
          <span class="cms-btn-glyph" aria-hidden="true">+</span>
        </button>
      </div>`;
    $("#btn-empty-new-course")?.addEventListener("click", createNewCourse);
    cmsMotion()?.playCmsListReveal?.(container);
    return;
  }

  container.innerHTML = state.courses
    .map((course, index) => {
      const banner = courseBannerUrl(course);
      const featured = index === 0 ? " cms-course-card--featured" : "";
      const thumb = banner
        ? `<img class="cms-course-card-thumb" src="${escapeHtml(banner)}" alt="" />`
        : `<span class="cms-course-card-thumb cms-course-card-thumb--empty" aria-hidden="true"></span>`;
      return `<button type="button" class="cms-course-card${featured}" data-id="${course.id}">
        <span class="cms-course-card-inner">
          <span class="cms-course-card-media">${thumb}</span>
          <span class="cms-course-card-body">
            <span class="cms-course-card-title">${escapeHtml(course.name)}</span>
            <span class="cms-course-card-meta">${course.exerciseCount || 0} exercise${course.exerciseCount === 1 ? "" : "s"} · ${escapeHtml(assignedClassesLabel(course))}${course.communityListingId ? " · Shared" : ""}${course.sourceCommunityId ? " · From Community" : ""}</span>
            ${course.description ? `<span class="cms-course-card-desc">${escapeHtml(course.description)}</span>` : ""}
          </span>
        </span>
      </button>`;
    })
    .join("");

  container.querySelectorAll(".cms-course-card").forEach((btn) => {
    btn.addEventListener("click", () => openCourseEditor(Number(btn.dataset.id)));
  });
  cmsMotion()?.playCmsListReveal?.(container);
}

async function openCourseEditor(courseId) {
  $("#cms-details-error").textContent = "";
  $("#cms-sections-error").textContent = "";
  $("#cms-exercises-error").textContent = "";
  $("#cms-details-status").textContent = "";
  $("#cms-sections-status").textContent = "";
  $("#cms-exercises-status").textContent = "";

  try {
    await loadClasses();
    const data = await api(`/api/cms/courses/${courseId}`);
    state.editingCourse = data.course;
    state.editingSectionIndex = null;
    state.sections = sortSectionsByOrder(
      (data.sections || []).map((section) => ({
        ...section,
        exercises: (section.exercises || []).map((exercise) => ({ ...exercise })),
      }))
    );
    populateDetailsForm();
    renderAssignedClasses();
    closeSectionExercises({ reRender: false });
    renderSectionEditors();
    resetBatchAiPanel();
    $("#cms-edit-title").textContent = state.editingCourse.name || "Edit course";
    showCmsScreen("edit");
    switchTab("details");
    clearCmsDirty();
    updateCmsAutosaveStatus();
    maybeStartCmsTour();
  } catch (err) {
    $("#cms-list-error").textContent = err.message;
  }
}

async function createNewCourse() {
  try {
    const data = await api("/api/cms/courses", {
      method: "POST",
      body: { name: "New course", description: "", banner: "" },
    });
    await enterCourseList();
    await openCourseEditor(data.course.id);
  } catch (err) {
    $("#cms-list-error").textContent = err.message;
  }
}

function populateDetailsForm() {
  const c = state.editingCourse;
  if (!c) return;
  $("#course-name").value = c.name || "";
  $("#course-description").value = c.description || "";
  $("#course-banner").value = c.banner || "";
  $("#cms-banner-status").textContent = "";
  updateBannerPreview(c.banner || "");
  if ($("#course-banner-file")) $("#course-banner-file").value = "";
  syncCommunityShareUi();
}

function getActiveTabId() {
  return document.querySelector(".cms-tab.active")?.dataset.tab || "details";
}

function sortSectionsByOrder(sections) {
  return [...(sections || [])]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((section, index) => ({ ...section, order: index + 1 }));
}

function findSectionFromCard(sectionCard) {
  const idRaw = sectionCard.dataset.sectionId;
  if (idRaw != null) {
    const byId = state.sections.find((section) => String(section.id) === idRaw);
    if (byId) return byId;
  }
  const idx = Number(sectionCard.dataset.sectionIndex);
  return Number.isFinite(idx) ? state.sections[idx] : null;
}

function syncSectionsMetadataFromDom() {
  const container = $("#cms-section-list");
  if (!container?.children.length) return;

  const updated = [];
  container.querySelectorAll(".cms-section-card").forEach((sectionCard) => {
    const section = findSectionFromCard(sectionCard);
    if (!section) return;

    const idRaw = sectionCard.dataset.sectionId;
    updated.push({
      ...section,
      id: idRaw != null ? Number(idRaw) : section.id,
      title: sectionCard.querySelector(".cms-section-title")?.value.trim() || section.title || "Untitled",
      banner: sectionCard.querySelector(".cms-section-banner-value")?.value.trim() || "",
      order: Number(sectionCard.querySelector(".cms-section-order")?.value) || section.order || 1,
      exercises: section.exercises || [],
    });
  });

  state.sections = sortSectionsByOrder(updated);
}

function applySectionOrderFromDom() {
  syncSectionsMetadataFromDom();
  renderSectionEditors();
}

function exerciseSubTitleForType(type) {
  if (type === "video") return "Video";
  if (type === "buzzin") return "Buzz in Question";
  if (type === "fastmcquiz") return "Fast MC Quiz";
  return "MC Quiz";
}

function exerciseTypeShortLabel(type) {
  if (type === "video") return "Video";
  if (type === "buzzin") return "Buzz in Question";
  if (type === "fastmcquiz") return "Fast MC Quiz";
  return "MC Quiz";
}

function ensureSingleCorrectOption(options) {
  if (!Array.isArray(options) || !options.length) return [];
  const firstCorrectIdx = options.findIndex((o) => o.isCorrect);
  const correctIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
  return options.map((o, i) => ({ ...o, isCorrect: i === correctIdx }));
}

function collectExerciseFromCard(card) {
  const typeSelect = card.querySelector(".cms-exercise-type-select");
  const type = typeSelect?.value || card.dataset.type || "mcquiz";
  card.dataset.type = type;
  const body = card.querySelector(".cms-exercise-body");
  const items = body?._collectItems ? body._collectItems() : [];
  const exerciseIdRaw = card.dataset.exerciseId;
  const order = Number(card.querySelector(".cms-exercise-order")?.value) || 1;

  return {
    id: exerciseIdRaw != null ? Number(exerciseIdRaw) : undefined,
    type,
    title: card.querySelector('[data-field="title"]')?.value.trim() || "Untitled",
    subTitle: card.querySelector('[data-field="subTitle"]')?.value.trim() || "",
    order,
    items,
  };
}

function syncExercisesFromDom() {
  const sectionIndex = state.editingSectionIndex;
  if (sectionIndex == null) return;

  const container = $("#cms-exercise-list");
  if (!container) return;

  const section = state.sections[sectionIndex];
  if (!section) return;

  const exercises = [];
  container.querySelectorAll(".cms-exercise-card").forEach((card) => {
    exercises.push(collectExerciseFromCard(card));
  });

  section.exercises = exercises
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((exercise, exerciseIndex) => ({
      ...exercise,
      order: exerciseIndex + 1,
    }));
  updateExercisesViewDurationEstimate();
}

function syncExercisesFromDomIfRendered() {
  const container = $("#cms-exercise-list");
  if (!container?.querySelector(".cms-exercise-card")) return false;
  syncExercisesFromDom();
  return true;
}

function syncSectionsFromDom() {
  if (state.editingSectionIndex != null) {
    syncExercisesFromDomIfRendered();
  } else {
    syncSectionsMetadataFromDom();
  }
}

function syncAllFromDom() {
  if (getActiveTabId() === "sections") syncSectionsFromDom();
}

function isExercisesSubpageOpen() {
  return state.editingSectionIndex != null;
}

const AI_TEMPLATES = {
  vocab: { types: { mcquiz: 5, fastmcquiz: 3 }, difficulty: "easy" },
  reading: { types: { mcquiz: 4, buzzin: 2 }, difficulty: "medium" },
  speaking: { types: { buzzin: 4 }, difficulty: "medium" },
  mixed: { types: { mcquiz: 3, fastmcquiz: 2, buzzin: 2 }, difficulty: "medium" },
  video: { types: { video: 1 }, difficulty: "medium" },
};

const AI_CUSTOM_TYPE_KEYS = ["mcquiz", "fastmcquiz", "buzzin", "video"];

function syncCustomTypeCountInputs(prefix = "cms-ai") {
  for (const key of AI_CUSTOM_TYPE_KEYS) {
    const checked = !!$(`#${prefix}-type-${key}`)?.checked;
    const countEl = $(`#${prefix}-count-${key}`);
    const row = countEl?.closest(".cms-ai-type-row");
    if (countEl) countEl.disabled = !checked;
    if (row) row.classList.toggle("is-disabled", !checked);
  }
}

function aiWantsVideo(prefix = "cms-ai") {
  if (prefix === "cms-ai" && state.aiTemplate === "video") return true;
  return getAiTypeCounts(prefix).video > 0;
}

function aiLlmTypeCounts(prefix = "cms-ai") {
  const types = { ...getAiTypeCounts(prefix) };
  delete types.video;
  return types;
}

function isAiVideoOnly(prefix = "cms-ai") {
  return aiWantsVideo(prefix) && !Object.keys(aiLlmTypeCounts(prefix)).length;
}

function syncAiWizardCopy() {
  const materialIntro = document.querySelector('[data-step-panel="2"] .cms-ai-intro');
  if (materialIntro) materialIntro.hidden = true;

  const planIntro = $("#cms-ai-plan-intro");
  if (planIntro) planIntro.hidden = true;

  const publishIntro = $("#cms-ai-publish-intro");
  if (publishIntro) publishIntro.hidden = true;

  const publishLabel = $("#cms-ai-publish-label");
  if (publishLabel) {
    publishLabel.textContent = state.aiCourseMode ? "Publish course" : "Publish";
  }
  syncAiCourseModeUi();
}

function resetAiGeneratePanel() {
  state.aiMaterialText = "";
  state.aiMaterialAssets = [];
  state.aiDraftExercises = [];
  state.aiWizardStep = 1;
  state.aiWizardMaxStep = 1;
  state.aiWizardBusy = false;
  state.aiWizardActive = false;
  state.aiTemplate = "vocab";
  state.aiCourseMode = false;
  state.aiCoursePlan = null;
  state.aiCourseResults = [];
  state.aiGenSummary = null;
  resetAiReviewAgent();
  const preview = $("#cms-ai-material-preview");
  if (preview) {
    preview.value = "";
    preview.hidden = true;
  }
  if ($("#cms-ai-paste")) $("#cms-ai-paste").value = "";
  if ($("#cms-ai-instructions")) $("#cms-ai-instructions").value = "";
  if ($("#cms-ai-video-url")) $("#cms-ai-video-url").value = "";
  $("#cms-ai-extract-status") && ($("#cms-ai-extract-status").textContent = "");
  $("#cms-ai-generate-status") && ($("#cms-ai-generate-status").textContent = "");
  resetAiGenProgress();
  $("#cms-ai-error") && ($("#cms-ai-error").textContent = "");
  $("#cms-ai-preview") && ($("#cms-ai-preview").innerHTML = "");
  $("#cms-ai-plan-list") && ($("#cms-ai-plan-list").innerHTML = "");
  $("#cms-ai-plan-meta") && ($("#cms-ai-plan-meta").innerHTML = "");
  const videoLog = $("#cms-ai-video-log");
  if (videoLog) {
    videoLog.textContent = "";
    videoLog.hidden = true;
  }
  const fileInput = $("#cms-ai-file");
  if (fileInput) fileInput.value = "";
  clearAiSelectedFiles();
  renderAiFileList();
  syncAiFileNameLabel();
  applyAiTemplate("vocab");
  syncAiSpeakLangSelect();
  showAiGenSummary(null);
  openAiGeneratePath("section");
  syncAiMaterialState();
  renderMaterialAssetLibrary();
}

function mergeAiMaterialAssets(incoming) {
  const list = Array.isArray(incoming) ? incoming : [];
  if (!list.length) return;
  const byId = new Map((state.aiMaterialAssets || []).map((asset) => [asset.id, asset]));
  for (const asset of list) {
    if (asset?.id && asset?.url) byId.set(asset.id, asset);
  }
  state.aiMaterialAssets = Array.from(byId.values());
  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
    body: JSON.stringify({
      sessionId: "365eeb",
      location: "cms.js:mergeAiMaterialAssets",
      message: "material assets merged",
      data: {
        incomingCount: list.length,
        totalCount: state.aiMaterialAssets.length,
        labels: state.aiMaterialAssets.map((asset) => asset.label),
      },
      timestamp: Date.now(),
      hypothesisId: "IMG-CROP",
      runId: "image-vision-crop",
    }),
  }).catch(() => {});
  // #endregion
}

function renderMaterialAssetLibrary() {
  const materialEl = $("#cms-ai-material-assets");
  const reviewEl = $("#cms-ai-review-assets");
  const assets = state.aiMaterialAssets || [];
  const markup =
    assets.length === 0
      ? ""
      : `
    <div class="cms-ai-asset-library">
      <div class="cms-ai-asset-library-head">
        <h4 class="cms-ai-asset-library-title">Material images (${assets.length})</h4>
        <p class="hint cms-ai-asset-library-lead">Extracted from your uploads. Worksheet photos are auto-cropped into separate figures. Click a thumbnail to preview. Images attach to questions only when the AI is at least 70% confident of a match — otherwise leave blank and pick manually.</p>
      </div>
      <div class="cms-ai-asset-grid" role="list">
        ${assets
          .map(
            (asset) => `
          <button type="button" class="cms-ai-asset-thumb" role="listitem" data-asset-id="${escapeHtml(asset.id)}" data-asset-url="${escapeHtml(asset.url)}" data-asset-label="${escapeHtml(asset.label || asset.id)}" title="${escapeHtml(asset.label || asset.id)}">
            <img src="${escapeHtml(asset.url)}" alt="" loading="lazy" />
            <span class="cms-ai-asset-thumb-label">${escapeHtml(asset.label || asset.id)}</span>
          </button>`
          )
          .join("")}
      </div>
    </div>`;

  if (materialEl) {
    materialEl.innerHTML = markup;
    materialEl.hidden = !assets.length;
  }
  if (reviewEl) {
    reviewEl.innerHTML = markup;
    reviewEl.hidden = !assets.length;
  }
}

function attachMaterialAssetToQuestionBlock(block, url) {
  if (!block || !url) return;
  const valueInput = block.querySelector(".cms-ai-q-image-value");
  if (valueInput) valueInput.value = url;
  updateQuestionImagePreview(block, url, "cms-ai-q");
  const statusEl = block.querySelector(".cms-ai-q-image-status");
  if (statusEl) statusEl.textContent = "Image attached from material library.";
}

function openMaterialAssetPreview({ url, label, attachTarget = null } = {}) {
  const overlay = $("#cms-asset-preview");
  const img = $("#cms-asset-preview-img");
  const title = $("#cms-asset-preview-title");
  const attachBtn = $("#btn-cms-asset-preview-attach");
  if (!overlay || !img || !title) return;

  img.src = url || "";
  img.alt = label || "Material image preview";
  title.textContent = label || "Material image";
  overlay.hidden = false;
  document.body.classList.add("cms-asset-preview-open");
  state.materialAssetPreviewTarget = attachTarget || null;
  if (attachBtn) attachBtn.hidden = !attachTarget;
  $("#btn-cms-asset-preview-close")?.focus();
}

function openQuestionImagePreview(block, prefix = "cms-q") {
  if (!block) return;
  const url =
    block.querySelector(`.${prefix}-image-value`)?.value.trim() ||
    block.querySelector(`.${prefix}-image-img`)?.getAttribute("src")?.trim() ||
    "";
  if (!url) return;
  const title =
    block.querySelector('[data-field="title"]')?.value.trim() ||
    block.querySelector(".cms-q-text")?.value.trim() ||
    block.querySelector('[data-field="topic"]')?.value.trim() ||
    "";
  openMaterialAssetPreview({
    url,
    label: title ? `Question image · ${title}` : "Question image",
  });
}

function closeMaterialAssetPreview() {
  const overlay = $("#cms-asset-preview");
  const img = $("#cms-asset-preview-img");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove("cms-asset-preview-open");
  state.materialAssetPreviewTarget = null;
  if (img) {
    img.removeAttribute("src");
    img.alt = "";
  }
}

function attachMaterialAssetFromPreview() {
  const target = state.materialAssetPreviewTarget;
  const url = $("#cms-asset-preview-img")?.getAttribute("src") || "";
  if (!target || !url) return;
  attachMaterialAssetToQuestionBlock(target, url);
  target.classList.remove("is-asset-pick-target");
  closeMaterialAssetPreview();
}

const IMAGE_REF_MIN_CONFIDENCE = 0.7;

function tokenizeMatchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function labelMatchConfidence(questionText, label) {
  const labelWords = tokenizeMatchText(label);
  if (!labelWords.length) return 0;
  const textWords = new Set(tokenizeMatchText(questionText));
  const overlap = labelWords.filter((word) => textWords.has(word)).length;
  return overlap / labelWords.length;
}

function questionTextFromItem(item) {
  return String(item?.title || item?.topic || item?.question || "").trim();
}

function inferCatalogRefFromValue(value, byId) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (byId.has(text)) return text;
  const fromUrl = text.match(/\/uploads\/material\/(mat-[A-Za-z0-9-]+)/i);
  if (fromUrl && byId.has(fromUrl[1])) return fromUrl[1];
  return null;
}

function parseImageRefConfidence(item) {
  const raw =
    item?.imageRefConfidence ??
    item?.imageConfidence ??
    item?.imageMatchConfidence ??
    item?.confidence;
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const pct = trimmed.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (pct) {
      const value = Number(pct[1]);
      if (Number.isFinite(value)) return Math.max(0, Math.min(1, value / 100));
    }
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function hasPendingImageMeta(item) {
  return Boolean(String(item?.imageRef || "").trim()) || parseImageRefConfidence(item) != null;
}

function resolveItemImageMatchClient(item, assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (!list.length) return { image: null, method: "no-assets" };

  const byId = new Map(list.filter((asset) => asset?.id).map((asset) => [asset.id, asset]));
  const byUrl = new Map(list.filter((asset) => asset?.url).map((asset) => [asset.url, asset]));
  const catalogUrls = new Set(list.map((asset) => asset.url));
  const current = String(item?.image || item?.imageUrl || "").trim();
  let ref = String(item?.imageRef || "").trim();
  if (!ref) ref = inferCatalogRefFromValue(current, byId) || "";
  const aiConfidence = parseImageRefConfidence(item);
  const questionText = questionTextFromItem(item);
  const pendingMeta = hasPendingImageMeta(item);

  if (ref && byId.has(ref) && aiConfidence != null && aiConfidence >= IMAGE_REF_MIN_CONFIDENCE) {
    return { image: byId.get(ref).url, method: "ai-ref" };
  }

  if (pendingMeta && aiConfidence != null && aiConfidence < IMAGE_REF_MIN_CONFIDENCE) {
    return { image: null, method: "skipped-low-confidence" };
  }

  if (ref && byId.has(ref) && aiConfidence == null) {
    return { image: byId.get(ref).url, method: "ai-ref-implicit" };
  }

  if (current && catalogUrls.has(current) && aiConfidence != null && aiConfidence >= IMAGE_REF_MIN_CONFIDENCE) {
    return { image: current, method: "ai-catalog-url" };
  }

  if (current && catalogUrls.has(current)) {
    const asset = byUrl.get(current);
    if (asset && questionText) {
      const score = labelMatchConfidence(questionText, asset.label || asset.description || "");
      if (score >= IMAGE_REF_MIN_CONFIDENCE) {
        return { image: current, method: "url-label-match" };
      }
    }
  }

  if (questionText) {
    let best = null;
    for (const asset of list) {
      const score = labelMatchConfidence(questionText, asset.label || asset.description || "");
      if (!best || score > best.score) best = { asset, score };
    }
    if (best && best.score >= IMAGE_REF_MIN_CONFIDENCE) {
      return { image: best.asset.url, method: "label-match" };
    }
  }

  if (current && catalogUrls.has(current) && !pendingMeta) {
    return { image: current, method: "kept-ai-catalog-url" };
  }

  if (current && catalogUrls.has(current) && pendingMeta) {
    return { image: null, method: "cleared-catalog-url" };
  }

  return { image: current || null, method: current ? "kept-non-catalog" : "blank" };
}

function stripImageRefMeta(item) {
  const next = { ...item };
  delete next.imageRef;
  delete next.imageRefConfidence;
  delete next.imageConfidence;
  delete next.imageMatchConfidence;
  return next;
}

function autoApplyMaterialImagesToExercises(exercises, assets) {
  const list = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.url);
  if (!list.length) return exercises;
  let attached = 0;
  let cleared = 0;
  let labelMatched = 0;

  const nextExercises = (Array.isArray(exercises) ? exercises : []).map((exercise) => {
    if (exercise?.type === "video") return exercise;
    return {
      ...exercise,
      items: (exercise.items || []).map((item) => {
        const match = resolveItemImageMatchClient(item, list);
        if (
          match.method === "ai-ref" ||
          match.method === "ai-ref-implicit" ||
          match.method === "ai-catalog-url" ||
          match.method === "url-label-match" ||
          match.method === "kept-ai-catalog-url"
        ) {
          attached += 1;
        }
        if (match.method === "label-match") {
          attached += 1;
          labelMatched += 1;
        }
        if (match.method === "cleared-catalog-url") cleared += 1;
        return { ...stripImageRefMeta(item), image: match.image };
      }),
    };
  });

  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
    body: JSON.stringify({
      sessionId: "365eeb",
      location: "cms.js:autoApplyMaterialImagesToExercises",
      message: "confident-only image apply",
      data: { attached, labelMatched, cleared, minConfidence: IMAGE_REF_MIN_CONFIDENCE },
      timestamp: Date.now(),
      hypothesisId: "IMG-MATCH",
      runId: "image-match-v2",
    }),
  }).catch(() => {});
  // #endregion

  return nextExercises;
}

function autoApplyMaterialImagesToDraft() {
  if (!state.aiMaterialAssets?.length || !state.aiDraftExercises?.length) {
    // #region agent log
    fetch('http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'365eeb'},body:JSON.stringify({sessionId:'365eeb',location:'cms.js:autoApplyMaterialImagesToDraft',message:'auto-apply skipped',data:{assetCount:state.aiMaterialAssets?.length||0,exerciseCount:state.aiDraftExercises?.length||0},timestamp:Date.now(),hypothesisId:'A',runId:'pre-fix'})}).catch(()=>{});
    // #endregion
    return 0;
  }
  const before = state.aiDraftExercises.reduce(
    (count, exercise) => count + (exercise.items || []).filter((item) => item?.image).length,
    0
  );
  state.aiDraftExercises = autoApplyMaterialImagesToExercises(
    state.aiDraftExercises,
    state.aiMaterialAssets
  );
  const after = state.aiDraftExercises.reduce(
    (count, exercise) => count + (exercise.items || []).filter((item) => item?.image).length,
    0
  );
  const sampleImages = state.aiDraftExercises.flatMap((ex) => (ex.items || []).map((item) => item?.image).filter(Boolean)).slice(0, 3);
  // #region agent log
  fetch('http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'365eeb'},body:JSON.stringify({sessionId:'365eeb',location:'cms.js:autoApplyMaterialImagesToDraft',message:'auto-apply complete',data:{assetCount:state.aiMaterialAssets.length,before,after,assigned:after-before,sampleImages},timestamp:Date.now(),hypothesisId:'B',runId:'pre-fix'})}).catch(()=>{});
  // #endregion
  return after - before;
}

function applyAiTemplate(templateId) {
  const id = AI_TEMPLATES[templateId] ? templateId : templateId === "custom" ? "custom" : "vocab";
  state.aiTemplate = id;
  document.querySelectorAll(".cms-ai-template").forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.template === id);
  });
  const custom = $("#cms-ai-custom-settings");
  if (custom) custom.hidden = id !== "custom";

  const preset = AI_TEMPLATES[id];
  if (!preset) {
    syncCustomTypeCountInputs();
    syncAiWizardCopy();
    return;
  }
  for (const key of AI_CUSTOM_TYPE_KEYS) {
    const typeEl = $(`#cms-ai-type-${key}`);
    const countEl = $(`#cms-ai-count-${key}`);
    if (typeEl) typeEl.checked = (preset.types[key] || 0) > 0;
    if (countEl) countEl.value = String(preset.types[key] || (key === "video" ? 1 : 3));
  }
  if ($("#cms-ai-difficulty")) $("#cms-ai-difficulty").value = preset.difficulty;
  syncCustomTypeCountInputs();
  syncAiWizardCopy();
}

function hasAiPreviewReady() {
  return (state.aiDraftExercises || []).some((exercise) => (exercise.items || []).length > 0);
}

function cloneAiDraft(exercises) {
  try {
    return JSON.parse(JSON.stringify(exercises || []));
  } catch {
    return [];
  }
}

const AI_CONVERT_VERB_PATTERN =
  "(?:make|convert|change|turn|replace|swap|rewrite|switch)";
const AI_TARGET_TYPE_PATTERN =
  "(fast\\s*mc(?:\\s*quiz)?|fastmcquiz|mc\\s*quiz|mcquiz|buzz\\s*in(?:\\s+question)?|buzzin)";
const AI_TARGET_CONNECTOR_PATTERN = "(?:to|into|with|as|for)";

function resolveAiQuestionTargetType(typeRaw) {
  const normalized = String(typeRaw || "").toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("fast")) return "fastmcquiz";
  if (normalized.includes("buzz")) return "buzzin";
  return "mcquiz";
}

function parseAiConvertIntent(revision, contextQuestionNumber) {
  const text = String(revision || "").trim();
  const contextNumber =
    Number.isFinite(Number(contextQuestionNumber)) && Number(contextQuestionNumber) > 0
      ? Number(contextQuestionNumber)
      : null;

  const direct = text.match(
    new RegExp(
      `${AI_CONVERT_VERB_PATTERN}\\s+(?:the\\s+)?(?:q(?:uestion)?\\s*)?(\\d+)\\s+${AI_TARGET_CONNECTOR_PATTERN}\\s*(?:a\\s+|an\\s+)?(${AI_TARGET_TYPE_PATTERN})`,
      "i"
    )
  );
  if (direct) {
    return {
      questionNumber: Math.max(1, Number.parseInt(direct[1], 10) || 1),
      targetType: resolveAiQuestionTargetType(direct[2]),
    };
  }

  const referent = text.match(
    new RegExp(
      `${AI_CONVERT_VERB_PATTERN}\\s+(?:this|it)\\s+${AI_TARGET_CONNECTOR_PATTERN}\\s*(?:a\\s+|an\\s+)?(${AI_TARGET_TYPE_PATTERN})`,
      "i"
    )
  );
  const bare = text.match(
    new RegExp(
      `${AI_CONVERT_VERB_PATTERN}\\s+${AI_TARGET_CONNECTOR_PATTERN}\\s*(?:a\\s+|an\\s+)?(${AI_TARGET_TYPE_PATTERN})`,
      "i"
    )
  );
  const targetMatch = referent || bare;
  const questionNumber =
    (text.match(/question\s*(\d+)/i) &&
      Math.max(1, Number.parseInt(text.match(/question\s*(\d+)/i)[1], 10) || 1)) ||
    contextNumber;
  if (targetMatch && questionNumber) {
    return {
      questionNumber,
      targetType: resolveAiQuestionTargetType(targetMatch[1]),
    };
  }

  const looseType = text.match(new RegExp(`\\b(${AI_TARGET_TYPE_PATTERN})\\b`, "i"));
  if (
    looseType &&
    questionNumber &&
    new RegExp(`\\b${AI_CONVERT_VERB_PATTERN}\\b`, "i").test(text)
  ) {
    return {
      questionNumber,
      targetType: resolveAiQuestionTargetType(looseType[1]),
    };
  }

  return null;
}

function flattenDraftExercisesForReplace(exercises) {
  const flat = [];
  (exercises || []).forEach((exercise) => {
    if (!exercise || exercise.type === "video") return;
    const meta = {
      title: exercise.title,
      subTitle: exercise.subTitle,
      _courseGroup: exercise._courseGroup,
      _courseKey: exercise._courseKey,
      _sectionTitle: exercise._sectionTitle,
    };
    (exercise.items || []).forEach((item) => {
      flat.push({
        type: exercise.type,
        item,
        included: exercise.included !== false,
        meta,
      });
    });
  });
  return flat;
}

function applyInPlaceQuestionReplacement(previousExercises, nextExercises, convertIntent) {
  if (!convertIntent) return nextExercises;
  const { questionNumber, targetType } = convertIntent;
  const targetIdx = questionNumber - 1;
  if (targetIdx < 0) return nextExercises;

  const quizPrevious = (previousExercises || []).filter((exercise) => exercise?.type !== "video");
  const videos = (nextExercises || []).filter((exercise) => exercise?.type === "video");
  const nextFlat = flattenDraftExercisesForReplace(nextExercises);
  if (!nextFlat.length || targetIdx >= nextFlat.length) return nextExercises;

  if (nextFlat[targetIdx]?.type === targetType) {
    let duplicateIdx = -1;
    for (let i = nextFlat.length - 1; i >= 0; i -= 1) {
      if (nextFlat[i].type === targetType && i !== targetIdx) {
        duplicateIdx = i;
        break;
      }
    }
    if (duplicateIdx < 0) return nextExercises;
    const deduped = nextFlat
      .filter((_, index) => index !== duplicateIdx)
      .map((entry) => ({
        ...entry,
        item: { ...(entry.item || {}) },
        meta: { ...(entry.meta || {}) },
      }));
    return [...rebuildAiDraftFromFlatQuestions(deduped, quizPrevious), ...videos];
  }

  let sourceIdx = -1;
  for (let i = nextFlat.length - 1; i >= 0; i -= 1) {
    if (nextFlat[i].type === targetType) {
      sourceIdx = i;
      break;
    }
  }
  if (sourceIdx < 0 || sourceIdx === targetIdx) return nextExercises;

  const replacement = {
    ...nextFlat[sourceIdx],
    item: { ...(nextFlat[sourceIdx].item || {}) },
    meta: { ...(nextFlat[sourceIdx].meta || {}) },
  };
  const withoutSource = nextFlat
    .filter((_, index) => index !== sourceIdx)
    .map((entry) => ({
      ...entry,
      item: { ...(entry.item || {}) },
      meta: { ...(entry.meta || {}) },
    }));
  withoutSource.splice(targetIdx, 0, replacement);

  return [...rebuildAiDraftFromFlatQuestions(withoutSource, quizPrevious), ...videos];
}

function getReviewFieldSelectionText(field) {
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return "";
  const start = field.selectionStart;
  const end = field.selectionEnd;
  if (start == null || end == null || start === end) return "";
  return String(field.value || "").slice(start, end).trim();
}

function parseQuestionNumberFromSelectionLabel(text) {
  const match = String(text || "").match(/question\s*(\d+)/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getOpenExerciseCard() {
  return document.querySelector("#cms-exercise-list .cms-exercise-card.is-open");
}

function resetAiReviewAgent() {
  resetGlobalAgentSession({ clearHistory: false });
}

function renderAiReviewAgent() {
  syncGlobalAgentUi();
}

function syncAiReviewAgentBusy() {
  syncGlobalAgentBusy();
}

async function applyAiReviewRevision(rawRequest) {
  return applyGlobalAgentMessage(rawRequest);
}

function undoAiReviewRevision() {
  undoGlobalAgentRevision();
}

function resetExerciseAgent() {
  resetGlobalAgentSession({ clearHistory: false });
}

function syncExerciseAgentPanel(show, card) {
  if (show && card) {
    openGlobalAgent();
    syncGlobalAgentUi();
    return;
  }
  if (!getOpenExerciseCard()) closeGlobalAgent();
}

async function applyExerciseAgentRevision(rawRequest) {
  return applyGlobalAgentMessage(rawRequest);
}

function undoExerciseAgentRevision() {
  undoGlobalAgentRevision();
}

function initAiReviewSelection() {}
function initExerciseAgentSelection() {}

function renderAiPreviewStep() {
  const drafts = state.aiDraftExercises || [];
  if (!drafts.length) {
    if (state.aiCourseMode && state.aiCourseResults?.length) {
      renderAiCoursePreview(state.aiCourseResults);
    } else {
      renderAiPreviewGrouped([]);
    }
    renderAiReviewAgent();
    renderMaterialAssetLibrary();
    return;
  }
  if (state.aiCourseMode && drafts.some((d) => d._courseKey != null || d._sectionTitle)) {
    const map = new Map();
    const keyOrder = [];
    drafts.forEach((exercise, index) => {
      const key = exercise._courseKey || String(exercise._courseGroup ?? index);
      if (!map.has(key)) {
        map.set(key, { key, title: exercise._sectionTitle || `Section ${keyOrder.length + 1}`, items: [] });
        keyOrder.push(key);
      }
      map.get(key).items.push({ exercise, index });
    });
    renderAiPreviewGrouped(keyOrder.map((key) => map.get(key)));
    renderAiReviewAgent();
    renderMaterialAssetLibrary();
    return;
  }
  renderAiPreviewGrouped([
    {
      key: "section",
      title: state.sections[state.editingSectionIndex]?.title?.trim() || "Generated exercises",
      items: drafts.map((exercise, index) => ({ exercise, index })),
    },
  ]);
  renderAiReviewAgent();
  renderMaterialAssetLibrary();
}

function setAiWizardStep(step) {
  if (state.aiWizardBusy && step !== state.aiWizardStep) return;
  const next = Math.max(1, Math.min(4, Number(step) || 1));
  const prev = state.aiWizardStep;
  if (prev === 3 && next !== 3) collectAiDraftFromDom();
  state.aiWizardStep = next;
  state.aiWizardMaxStep = Math.max(state.aiWizardMaxStep || 1, next);
  document.querySelectorAll(".cms-ai-step").forEach((btn) => {
    const n = Number(btn.dataset.step);
    const isCurrent = n === next;
    const isDone = n < next;
    const isUpcoming = n > next;
    btn.classList.toggle("is-current", isCurrent);
    btn.classList.toggle("is-done", isDone);
    btn.classList.toggle("is-upcoming", isUpcoming);
    btn.disabled = n > state.aiWizardMaxStep;
    btn.setAttribute("aria-current", isCurrent ? "step" : "false");
  });
  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    const active = Number(panel.dataset.stepPanel) === next;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  const back = $("#btn-cms-ai-back");
  const nextBtn = $("#btn-cms-ai-next");
  const publish = $("#btn-cms-ai-publish");
  const previewReady = hasAiPreviewReady();
  if (back) back.hidden = next === 1;
  if (back) back.disabled = state.aiWizardBusy;
  if (publish) publish.hidden = next !== 4;
  if (nextBtn) {
    nextBtn.hidden = next === 4;
    nextBtn.classList.remove("small");
    if (next === 2) {
      nextBtn.textContent = previewReady ? "Continue" : "Next";
    } else if (next === 3) {
      nextBtn.textContent = "Continue to publish";
    } else {
      nextBtn.textContent = "Continue";
    }
  }
  if (next === 1 || next === 2) syncAiWizardCopy();
  if (next === 2) syncAiMaterialState();
  if (next === 1 || (next === 2 && prev !== 2)) resetAiGenProgress();
  if (next === 3) renderAiPreviewStep();
  if (next === 4) renderAiPublishSummary();
  updateAiWizardSummary();
  syncGlobalAgentUi();
  syncAiReviewAgentLayout();
  if (next === 3 && prev !== 3) {
    openGlobalAgent();
    scheduleAiPreviewScrollToStart("enter-review-step");
  }
}

function getAiInstructions() {
  return $("#cms-ai-instructions")?.value.trim() || "";
}

function getAiMaterialText() {
  return (
    state.aiMaterialText ||
    $("#cms-ai-material-preview")?.value.trim() ||
    $("#cms-ai-paste")?.value.trim() ||
    ""
  );
}

function readAiTypeCount(prefix, typeKey) {
  const perType = $(`#${prefix}-count-${typeKey}`);
  if (perType) {
    return Math.max(1, Math.min(10, Number(perType.value) || 1));
  }
  return Math.max(1, Math.min(10, Number($(`#${prefix}-count`)?.value) || 3));
}

function getAiTypeCounts(prefix = "cms-ai") {
  if (prefix === "cms-ai" && state.aiTemplate && AI_TEMPLATES[state.aiTemplate]) {
    const presetTypes = { ...AI_TEMPLATES[state.aiTemplate].types };
    return presetTypes;
  }
  const hasPerTypeInputs = !!$(`#${prefix}-count-mcquiz`);
  const types = {};
  if (hasPerTypeInputs) {
    for (const key of AI_CUSTOM_TYPE_KEYS) {
      if ($(`#${prefix}-type-${key}`)?.checked) types[key] = readAiTypeCount(prefix, key);
    }
  } else {
    const count = Math.max(1, Math.min(10, Number($(`#${prefix}-count`)?.value) || 3));
    if ($(`#${prefix}-type-mcquiz`)?.checked) types.mcquiz = count;
    if ($(`#${prefix}-type-fastmcquiz`)?.checked) types.fastmcquiz = count;
    if ($(`#${prefix}-type-buzzin`)?.checked) types.buzzin = count;
    if ($(`#${prefix}-type-video`)?.checked) types.video = count;
  }
  return types;
}

function getAiGenerationSettings(prefix = "cms-ai") {
  const preset = prefix === "cms-ai" ? AI_TEMPLATES[state.aiTemplate] : null;
  const speakLangCode = prefix === "cms-ai" ? getAiSpeakLangCode() : state.editingCourse?.langCode || "en";
  return {
    langCode: speakLangCode,
    speakLangCode,
    difficulty: preset?.difficulty || $(`#${prefix}-difficulty`)?.value || "medium",
    types: getAiTypeCounts(prefix),
    template: state.aiTemplate || "custom",
  };
}

function aiFormatLabel(types, difficulty, speakLangCode) {
  const names = {
    mcquiz: "MC Quiz",
    fastmcquiz: "Fast MC Quiz",
    buzzin: "Buzz in Question",
    video: "Video",
  };
  const parts = Object.entries(types || {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${names[type] || type}`);
  if (difficulty) parts.push(String(difficulty)[0].toUpperCase() + String(difficulty).slice(1));
  if (speakLangCode) parts.push(communityLangLabel(speakLangCode));
  return parts.join(" · ") || "No types";
}

function collectAiCoursePlanFromDom() {
  if (!state.aiCoursePlan) return null;
  const settings = getAiGenerationSettings();
  const cards = [...document.querySelectorAll(".cms-ai-plan-card")];
  const sections = cards.map((card, index) => {
    const excerpt = card.querySelector(".cms-ai-plan-excerpt")?.value.trim() || "";
    return {
      key: card.dataset.planKey || String(index),
      title: card.querySelector(".cms-ai-plan-title")?.value.trim() || `Section ${index + 1}`,
      summary: card.querySelector(".cms-ai-plan-summary")?.value.trim() || "",
      materialExcerpt: excerpt,
      types: { ...settings.types },
      difficulty: settings.difficulty,
      included: Boolean(card.querySelector(".cms-ai-plan-include")?.checked) && !!excerpt,
      warning: card.querySelector(".cms-ai-plan-warning")?.textContent || "",
    };
  });
  state.aiCoursePlan = {
    ...state.aiCoursePlan,
    formatSource: "step1",
    appliedTemplate: settings.template,
    appliedTypes: { ...settings.types },
    appliedDifficulty: settings.difficulty,
    appliedSpeakLangCode: settings.speakLangCode,
    formatLabel: aiFormatLabel(settings.types, settings.difficulty, settings.speakLangCode),
    courseTitle:
      $("#cms-ai-plan-course-title")?.value.trim() ||
      state.aiCoursePlan.courseTitle ||
      "Course",
    sections,
  };
  return state.aiCoursePlan;
}

function renderAiCoursePlan() {
  const list = $("#cms-ai-plan-list");
  const meta = $("#cms-ai-plan-meta");
  if (!list || !meta) return;

  const plan = state.aiCoursePlan;
  if (!plan?.sections?.length) {
    meta.innerHTML = "";
    list.innerHTML = `<div class="cms-empty"><p class="cms-empty-title">No course plan yet</p><p class="cms-empty-copy">Enable course mode on Material, prepare a document, then build the plan.</p></div>`;
    return;
  }

  const formatText =
    plan.formatLabel ||
    aiFormatLabel(plan.appliedTypes, plan.appliedDifficulty, plan.appliedSpeakLangCode);
  meta.innerHTML = `
    <span><strong>Format locked:</strong> ${escapeHtml(formatText)}</span>
    <span><strong>Planner:</strong> ${escapeHtml(plan.planner || "headings")}</span>
    <span><strong>Sections:</strong> ${plan.sections.length}</span>
    <label class="field cms-ai-field">
      <span>Course title</span>
      <input type="text" id="cms-ai-plan-course-title" value="${escapeHtml(plan.courseTitle || "")}" />
    </label>`;

  list.innerHTML = plan.sections
    .map((section, index) => {
      const chars = String(section.materialExcerpt || "").length;
      return `
      <article class="cms-ai-plan-card ${section.included === false ? "is-excluded" : ""}" data-plan-index="${index}" data-plan-key="${escapeHtml(section.key || String(index))}">
        <div class="cms-ai-plan-card-head">
          <input type="checkbox" class="cms-ai-plan-include" ${section.included === false ? "" : "checked"} aria-label="Include section" />
          <input type="text" class="cms-ai-plan-title" value="${escapeHtml(section.title || "")}" placeholder="Section title" />
          <span class="cms-ai-plan-format">${escapeHtml(formatText)}</span>
        </div>
        <input type="text" class="cms-ai-plan-summary" value="${escapeHtml(section.summary || "")}" placeholder="Short summary (optional)" />
        <textarea class="cms-ai-textarea cms-ai-plan-excerpt" rows="4" placeholder="Material for this section…">${escapeHtml(section.materialExcerpt || "")}</textarea>
        <p class="hint">${chars} characters</p>
        ${section.warning ? `<p class="cms-ai-plan-warning">${escapeHtml(section.warning)}</p>` : ""}
      </article>`;
    })
    .join("");
}

async function analyzeAiCoursePlan(options = {}) {
  const statusEl = options.statusEl || $("#cms-ai-generate-status");
  const errorEl = $("#cms-ai-error");
  const btn = $("#btn-cms-ai-next");
  if (!statusEl || !errorEl) return false;

  let material = getAiMaterialText();
  const settings = getAiGenerationSettings();
  errorEl.textContent = "";

  if (!material) {
    const files = getAiSelectedFiles();
    const pasted = $("#cms-ai-paste")?.value.trim();
    const videoUrl = $("#cms-ai-video-url")?.value.trim();
    if (files.length || pasted || videoUrl) {
      const prepared = await extractAiMaterial({
        forCourse: true,
        manageBusy: false,
        statusEl,
        silentStatus: options.silentStatus,
      });
      if (!prepared) return false;
      material = getAiMaterialText();
    }
  }
  if (!material) {
    setCmsError(errorEl, "Add source material first.");
    return false;
  }
  if (!Object.keys(settings.types).length) {
    setCmsError(errorEl, "Pick a template or at least one custom exercise type.");
    return false;
  }

  if (!options.silentStatus && statusEl) statusEl.textContent = "Building course plan…";
  if (options.manageBusy !== false) setAiWizardBusy(true, "Building course plan…");
  try {
    const data = await api("/api/cms/analyze-course-material", {
      method: "POST",
      body: {
        material,
        langCode: settings.langCode,
        difficulty: settings.difficulty,
        types: settings.types,
        template: settings.template,
        instructions: getAiInstructions() || undefined,
      },
    });
    state.aiCoursePlan = data.plan;
    state.aiCourseResults = [];
    statusEl.textContent = data.usedLlm
      ? `Plan ready (${data.plan.sections.length} section(s)). Format locked from Step 1.`
      : `Plan ready from headings (${data.plan.sections.length} section(s)). Format locked from Step 1.`;
    showAiGenSummary(`${data.plan.sections.length} section(s) in plan`);
    return true;
  } catch (err) {
    statusEl.textContent = "";
    setCmsError(errorEl, err.message);
    return false;
  } finally {
    if (options.manageBusy !== false) setAiWizardBusy(false);
  }
}

function resolveAiCoursePlan() {
  if (document.querySelectorAll(".cms-ai-plan-card").length) {
    return collectAiCoursePlanFromDom();
  }
  if (!state.aiCoursePlan?.sections?.length) return null;
  const settings = getAiGenerationSettings();
  return {
    ...state.aiCoursePlan,
    formatSource: "step1",
    appliedTemplate: settings.template,
    appliedTypes: { ...settings.types },
    appliedDifficulty: settings.difficulty,
    appliedSpeakLangCode: settings.speakLangCode,
    formatLabel: aiFormatLabel(settings.types, settings.difficulty, settings.speakLangCode),
    sections: state.aiCoursePlan.sections.map((section) => ({
      ...section,
      types: { ...settings.types },
      difficulty: settings.difficulty,
      included: section.included !== false && !!(section.materialExcerpt || section.material || "").trim(),
    })),
  };
}

async function generateCourseFromPlan(options = {}) {
  const statusEl = $("#cms-ai-generate-status");
  const errorEl = $("#cms-ai-error");
  const btn = $("#btn-cms-ai-next");
  if (!statusEl || !errorEl) return false;

  const settings = getAiGenerationSettings();
  const plan = resolveAiCoursePlan();
  errorEl.textContent = "";

  if (!plan?.sections?.some((section) => section.included)) {
    errorEl.textContent = "Include at least one section with material.";
    return false;
  }

  if (!options.silentStatus && statusEl) statusEl.textContent = "Generating course exercises…";
  if (options.manageBusy !== false) setAiWizardBusy(true, "Generating course exercises…");

  try {
    const data = await api("/api/cms/generate-course-from-plan", {
      method: "POST",
      body: {
        plan,
        langCode: settings.langCode,
        difficulty: settings.difficulty,
        types: settings.types,
        template: settings.template,
        instructions: getAiInstructions() || undefined,
      },
    });

    state.aiCoursePlan = data.plan || plan;
    const videoCount = Number(data.videoCount) || settings.types.video || 0;
    const results = [];

    for (let i = 0; i < (data.results || []).length; i++) {
      const entry = data.results[i];
      const sectionProgress = 55 + Math.round(((i + 1) / Math.max(1, data.results.length)) * 35);
      setAiGenProgress(sectionProgress, `Section ${i + 1}/${data.results.length}: ${entry.sectionTitle || "Untitled"}…`);
      if (!options.silentStatus && statusEl) {
        statusEl.textContent = `Section ${i + 1}/${data.results.length}: ${entry.sectionTitle || "Untitled"}…`;
      }
      const exercises = [...(entry.exercises || [])].map((exercise) => ({
        ...exercise,
        included: true,
        ...(settings.speakLangCode ? { speakLangCode: settings.speakLangCode } : {}),
      }));

      if (entry.ok && videoCount > 0) {
        for (let v = 0; v < videoCount; v++) {
          statusEl.textContent = `Section ${i + 1}: generating video ${v + 1}/${videoCount}…`;
          try {
            const videoExercise = await createAiVideoExercise(entry.material || "", {
              onUpdate: (job) => {
                if (job.status) {
                  statusEl.textContent = `Section ${i + 1} video ${v + 1}/${videoCount}: ${job.status}`;
                }
              },
            });
            videoExercise.title =
              videoCount > 1
                ? `${entry.sectionTitle || "Lesson"} video ${v + 1}`
                : `${entry.sectionTitle || "Lesson"} video`;
            videoExercise.included = true;
            if (settings.speakLangCode) videoExercise.speakLangCode = settings.speakLangCode;
            exercises.push(videoExercise);
          } catch (videoErr) {
            entry.message = entry.message
              ? `${entry.message}; video: ${videoErr.message}`
              : `video: ${videoErr.message}`;
          }
        }
      }

      results.push({
        ...entry,
        exercises,
        ok: entry.ok || exercises.length > 0,
      });
    }

    state.aiCourseResults = results;
    renderAiCoursePreview(results);
    const stats = data.stats || {};
    statusEl.textContent = `Done: ${stats.succeeded || 0} section(s) generated, ${stats.failed || 0} failed. Review below.`;
    showAiGenSummary(buildAiGenSummaryFromCourseResults(results, stats));
    return results.some((entry) => entry.ok && entry.exercises?.length);
  } catch (err) {
    statusEl.textContent = "";
    setCmsError(errorEl, err.message);
    return false;
  } finally {
    if (options.manageBusy !== false) setAiWizardBusy(false);
  }
}

function renderAiCoursePreview(results) {
  const groups = (results || []).filter((entry) => entry.ok && entry.exercises?.length);
  if (!groups.length) {
    renderAiPreviewGrouped([]);
    state.aiDraftExercises = [];
    return;
  }

  let globalIndex = 0;
  const flat = [];
  const grouped = groups.map((entry, groupIndex) => {
    const items = (entry.exercises || []).map((exercise) => {
      const index = globalIndex++;
      flat.push({
        ...exercise,
        included: exercise.included !== false,
        _courseGroup: groupIndex,
        _courseKey: entry.key,
        _sectionTitle: entry.sectionTitle,
      });
      return { exercise, index };
    });
    return {
      key: entry.key || String(groupIndex),
      title: entry.sectionTitle || `Section ${groupIndex + 1}`,
      items,
    };
  });
  state.aiDraftExercises = flat;
  resetAiReviewAgent();
  renderAiPreviewGrouped(grouped);
}

function selectedAiCourseGroups() {
  collectAiDraftFromDom();
  const groups = new Map();
  (state.aiDraftExercises || []).forEach((exercise, index) => {
    if (exercise.included === false) return;
    const valid =
      exercise.type === "video"
        ? exercise.items.some((item) => item.videoUrl)
        : exercise.type === "buzzin"
          ? exercise.items.some((item) => item.topic)
          : exercise.items.some((item) => item.title && (item.options || []).length >= 2);
    if (!valid) return;
    const key = exercise._courseKey || `g-${exercise._courseGroup ?? 0}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sectionTitle: exercise._sectionTitle || `Section ${(exercise._courseGroup ?? 0) + 1}`,
        exercises: [],
      });
    }
    const { included: _included, _courseGroup, _courseKey, _sectionTitle, ...rest } = exercise;
    groups.get(key).exercises.push(rest);
  });
  return [...groups.values()];
}

async function publishAiCourse() {
  const errorEl = $("#cms-ai-error");
  const statusEl = $("#cms-ai-generate-status");
  const btn = $("#btn-cms-ai-publish");
  if (!errorEl || !statusEl || !btn) return;

  errorEl.textContent = "";
  const groups = selectedAiCourseGroups();
  if (!groups.length) {
    errorEl.textContent = "Keep at least one exercise before publishing the course.";
    return;
  }

  syncSectionsMetadataFromDom();
  let applied = 0;
  for (const group of groups) {
    let sectionIndex = state.sections.findIndex(
      (section) => section.title?.trim() === group.sectionTitle?.trim()
    );
    if (sectionIndex < 0) {
      state.sections.push(defaultSection(group.sectionTitle));
      sectionIndex = state.sections.length - 1;
    }
    const section = state.sections[sectionIndex];
    if (!section.exercises) section.exercises = [];
    group.exercises.forEach((exercise) => {
      section.exercises.push({
        ...exercise,
        order: section.exercises.length + 1,
      });
      applied += 1;
    });
  }

  await saveCourseStructure({
    errorEl,
    statusEl,
    btn,
    successMessage: `Published ${applied} exercise(s) across ${groups.length} section(s).`,
  });
  if (!errorEl.textContent) {
    showCmsToast(
      `Published successfully — ${applied} exercise${applied === 1 ? "" : "s"} across ${groups.length} section${groups.length === 1 ? "" : "s"}.`
    );
    $("#cms-exercises-status").textContent = `Published course: ${groups.length} section(s), ${applied} exercise(s).`;
    state.editingSectionIndex = null;
    $("#cms-sections-view").hidden = false;
    $("#cms-exercises-view").hidden = true;
    renderSectionEditors();
    resetAiGeneratePanel();
  }
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function extractMaterialRequest({ files, file, pasted, videoUrl, language, maxChars }) {
  const uploadFiles = files?.length ? files : file ? [file] : [];
  if (uploadFiles.length) {
    const form = new FormData();
    for (const uploadFile of uploadFiles) {
      form.append("files", uploadFile);
    }
    form.append("language", language || getAiSpeakLangCode());
    const materialHint = getAiInstructions();
    if (materialHint) form.append("materialHint", materialHint);
    if (maxChars) form.append("maxChars", String(maxChars));
    const headers = { Accept: "application/json" };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    headers["X-Teacher-Id"] = String(state.user?.id || "");
    // #region agent log
    fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
      body: JSON.stringify({
        sessionId: "365eeb",
        runId: "multi-upload",
        hypothesisId: "H1",
        location: "cms.js:extractMaterialRequest",
        message: "uploading material files",
        data: { fileCount: uploadFiles.length, names: uploadFiles.map((f) => f.name) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const res = await fetch("/api/cms/extract-material", { method: "POST", headers, body: form });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    // #region agent log
    if (!res.ok) {
      fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
        body: JSON.stringify({
          sessionId: "365eeb",
          runId: "multi-upload",
          hypothesisId: "H4",
          location: "cms.js:extractMaterialRequest:error",
          message: "extract-material failed",
          data: { status: res.status, error: parsed?.message || text?.slice(0, 200) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
    if (!res.ok) throw new Error(parsed?.message || `Request failed (${res.status})`);
    return parsed;
  }

  return api("/api/cms/extract-material", {
    method: "POST",
    body: {
      text: pasted || undefined,
      videoUrl: videoUrl || undefined,
      language: language || getAiSpeakLangCode(),
      maxChars: maxChars || undefined,
    },
  });
}

function summarizeAiItem(item, type) {
  if (type === "buzzin") return String(item?.topic || "").trim();
  return String(item?.title || "").trim();
}

function renderAiPreviewCard(exercise, index, { selectClass = "cms-ai-select", indexAttr = "data-ai-index", extraAttrs = {} } = {}) {
  const extra = Object.entries(extraAttrs)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(" ");
  const items = (exercise.items || [])
    .map((item) => `<li>${escapeHtml(summarizeAiItem(item, exercise.type))}</li>`)
    .join("");
  return `
    <article class="cms-ai-preview-card" ${indexAttr}="${index}">
      <div class="cms-ai-preview-head">
        <input type="checkbox" class="${selectClass}" ${indexAttr}="${index}" ${extra} checked aria-label="Include ${escapeHtml(exercise.title || "exercise")}" />
        <div class="cms-ai-preview-meta">
          <p class="cms-ai-preview-title">${escapeHtml(exercise.title || "Exercise")}</p>
          <p class="cms-ai-preview-sub">${escapeHtml(exercise.subTitle || exercise.type)} · ${(exercise.items || []).length} item(s)</p>
        </div>
      </div>
      <ol class="cms-ai-preview-items">${items}</ol>
    </article>`;
}

function getSelectedExerciseIndexes(selector) {
  return new Set(
    [...document.querySelectorAll(`${selector}:checked`)].map((el) => Number(el.dataset.aiIndex))
  );
}

async function exportExercisesJson({ mode = "section", exercises, sectionIndex, batchResults }) {
  let payload;
  if (mode === "batch") {
    const sections = (batchResults || [])
      .filter((entry) => entry.ok && entry.exercises?.length)
      .map((entry) => ({
        sectionId: entry.sectionId ?? null,
        sectionTitle: entry.sectionTitle || "",
        sectionIndex: entry.sectionIndex ?? null,
        exercises: entry.exercises,
      }));
    if (!sections.length) throw new Error("Nothing to export yet.");
    const data = await api("/api/cms/export-exercises-json", {
      method: "POST",
      body: {
        mode: "batch",
        course: state.editingCourse,
        sections,
      },
    });
    payload = data.payload;
  } else {
    const list = exercises || state.aiDraftExercises || [];
    if (!list.length) throw new Error("Nothing to export yet.");
    const section = state.sections[state.editingSectionIndex];
    const data = await api("/api/cms/export-exercises-json", {
      method: "POST",
      body: {
        mode: "section",
        course: state.editingCourse,
        section,
        sectionIndex: state.editingSectionIndex,
        exercises: list,
      },
    });
    payload = data.payload;
  }

  const slug = slugifyFilename(state.editingCourse?.name || "course");
  downloadJsonFile(`${slug}-exercises-${Date.now()}.json`, payload);
}

async function importExercisesJsonFromFile(file, { applyTarget = "preview" } = {}) {
  const text = await file.text();
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Import file is not valid JSON.");
  }

  const data = await api("/api/cms/import-exercises-json", {
    method: "POST",
    body: raw,
  });

  if (applyTarget === "preview") {
    const first = data.sections?.[0];
    state.aiDraftExercises = first?.exercises || [];
    resetAiReviewAgent();
    renderAiPreview(state.aiDraftExercises);
    setAiWizardStep(3);
    $("#cms-ai-generate-status").textContent = `Imported ${state.aiDraftExercises.length} exercise(s). Review before publishing.`;
    $("#cms-ai-error").textContent = "";
    return data;
  }

  applyImportedSections(data, { replace: false });
  $("#cms-batch-generate-status").textContent = `Imported exercises into ${data.sections.length} section(s). Save sections when ready.`;
  $("#cms-batch-error").textContent = "";
  return data;
}

function resolveImportSectionIndex(entry) {
  if (entry.sectionId != null) {
    const byId = state.sections.findIndex((section) => section.id === entry.sectionId);
    if (byId >= 0) return byId;
  }
  if (entry.sectionIndex != null && state.sections[entry.sectionIndex]) {
    return entry.sectionIndex;
  }
  const title = String(entry.sectionTitle || "").trim();
  if (title) {
    const byTitle = state.sections.findIndex((section) => String(section.title || "").trim() === title);
    if (byTitle >= 0) return byTitle;
  }
  return -1;
}

function applyImportedSections(parsed, { replace = false } = {}) {
  syncSectionsMetadataFromDom();
  let appliedSections = 0;
  let appliedExercises = 0;

  for (const entry of parsed.sections || []) {
    const sectionIndex = resolveImportSectionIndex(entry);
    if (sectionIndex < 0) continue;
    const section = state.sections[sectionIndex];
    if (!section) continue;
    if (replace) section.exercises = [];
    if (!section.exercises) section.exercises = [];
    for (const exercise of entry.exercises || []) {
      section.exercises.push({
        ...exercise,
        order: section.exercises.length + 1,
      });
      appliedExercises += 1;
    }
    appliedSections += 1;
  }

  if (!appliedExercises) {
    throw new Error("No matching sections found for this import file.");
  }

  if (isExercisesSubpageOpen()) {
    renderExerciseEditors({ skipReveal: true });
  } else {
    renderSectionEditors();
  }

  return { appliedSections, appliedExercises };
}

function resetBatchAiPanel() {
  state.batchDraftResults = [];
  state.batchPreparedMaterials = {};
  $("#cms-batch-generate-status") && ($("#cms-batch-generate-status").textContent = "");
  $("#cms-batch-error") && ($("#cms-batch-error").textContent = "");
  $("#cms-batch-preview-section")?.setAttribute("hidden", "");
  $("#cms-batch-preview") && ($("#cms-batch-preview").innerHTML = "");
  renderBatchAiRows();
}

function renderBatchAiRows() {
  const container = $("#cms-batch-ai-rows");
  if (!container) return;
  syncSectionsMetadataFromDom();

  if (!state.sections.length) {
    container.innerHTML = `<p class="hint">Add at least one section first.</p>`;
    return;
  }

  container.innerHTML = state.sections
    .map((section, sectionIndex) => {
      const title = section.title?.trim() || `Section ${sectionIndex + 1}`;
      const prepared = state.batchPreparedMaterials[sectionIndex];
      const preparedHint = prepared
        ? `<span class="status-msg">Prepared (${prepared.length} chars)</span>`
        : "";
      return `
        <article class="cms-batch-row" data-section-index="${sectionIndex}">
          <div class="cms-batch-row-head">
            <p class="cms-batch-row-title">${escapeHtml(title)}</p>
            <label class="cms-batch-row-include">
              <input type="checkbox" class="cms-batch-include" data-section-index="${sectionIndex}" checked />
              Include
            </label>
          </div>
          <textarea class="cms-batch-paste" data-section-index="${sectionIndex}" placeholder="Paste material for this section…">${escapeHtml(prepared || "")}</textarea>
          <div class="cms-batch-row-actions">
            <label class="btn secondary small cms-ai-file-label">
              <input type="file" class="cms-batch-file" data-section-index="${sectionIndex}" hidden accept=".txt,.md,.pdf,.docx,.pptx,.vtt,.mp4,.mov,.m4v,.mkv,.avi,.webm,.mp3,.wav,.m4a,.ogg,.webm,.flac,.aac,.jpg,.jpeg,.png,.webp,.gif,video/*,audio/*,image/*" />
              Upload
            </label>
            <button type="button" class="btn secondary small cms-batch-prepare" data-section-index="${sectionIndex}">Prepare</button>
            ${preparedHint}
            <span class="status-msg cms-batch-row-status" data-section-index="${sectionIndex}"></span>
          </div>
        </article>`;
    })
    .join("");
}

function renderBatchPreview(results) {
  const sectionEl = $("#cms-batch-preview-section");
  const container = $("#cms-batch-preview");
  if (!sectionEl || !container) return;

  const okResults = (results || []).filter((entry) => entry.ok && entry.exercises?.length);
  if (!okResults.length) {
    sectionEl.hidden = true;
    container.innerHTML = "";
    return;
  }

  sectionEl.hidden = false;
  container.innerHTML = okResults
    .map((result, resultIndex) => {
      const cards = (result.exercises || [])
        .map((exercise, exerciseIndex) =>
          renderAiPreviewCard(exercise, exerciseIndex, {
            selectClass: "cms-batch-select",
            indexAttr: "data-batch-exercise-index",
            extraAttrs: {
              "data-batch-result-index": resultIndex,
              "data-ai-index": exerciseIndex,
            },
          })
        )
        .join("");
      const title = result.sectionTitle || `Section ${Number(result.sectionIndex) + 1}`;
      return `
        <section class="cms-batch-preview-group" data-batch-result-index="${resultIndex}">
          <p class="cms-batch-preview-group-title">${escapeHtml(title)}</p>
          <div class="cms-ai-preview-list">${cards}</div>
        </section>`;
    })
    .join("");

}

async function prepareBatchRowMaterial(sectionIndex) {
  const row = document.querySelector(`.cms-batch-row[data-section-index="${sectionIndex}"]`);
  if (!row) return "";

  const statusEl = row.querySelector(`.cms-batch-row-status[data-section-index="${sectionIndex}"]`);
  const pasted = row.querySelector(".cms-batch-paste")?.value.trim();
  const file = row.querySelector(".cms-batch-file")?.files?.[0];

  if (pasted) {
    state.batchPreparedMaterials[sectionIndex] = pasted;
    if (statusEl) statusEl.textContent = `Ready (${pasted.length} chars).`;
    return pasted;
  }

  if (!file) {
    throw new Error("Paste material or upload a file for this section.");
  }

  if (statusEl) statusEl.textContent = "Preparing…";
  const data = await extractMaterialRequest({ file, language: state.editingCourse?.langCode || "en" });
  const text = data.text || "";
  state.batchPreparedMaterials[sectionIndex] = text;
  const textarea = row.querySelector(".cms-batch-paste");
  if (textarea) textarea.value = text;
  if (statusEl) {
    statusEl.textContent = data.truncated
      ? `Ready (${data.originalLength} chars, truncated).`
      : `Ready (${text.length} chars).`;
  }
  return text;
}

async function batchGenerateAllSections() {
  const statusEl = $("#cms-batch-generate-status");
  const errorEl = $("#cms-batch-error");
  const btn = $("#btn-cms-batch-generate");
  if (!statusEl || !errorEl || !btn) return;

  syncSectionsMetadataFromDom();
  errorEl.textContent = "";
  const settings = getAiGenerationSettings("cms-batch");
  if (!Object.keys(settings.types).length) {
    errorEl.textContent = "Select at least one exercise type.";
    return;
  }

  const jobs = [];
  for (const row of document.querySelectorAll(".cms-batch-row")) {
    const sectionIndex = Number(row.dataset.sectionIndex);
    const include = row.querySelector(".cms-batch-include")?.checked;
    if (!include) continue;

    const section = state.sections[sectionIndex];
    if (!section) continue;

    let material =
      row.querySelector(".cms-batch-paste")?.value.trim() ||
      state.batchPreparedMaterials[sectionIndex] ||
      "";
    const file = row.querySelector(".cms-batch-file")?.files?.[0];

    try {
      if (!material && file) {
        material = await prepareBatchRowMaterial(sectionIndex);
      }
    } catch (err) {
      errorEl.textContent = err.message;
      return;
    }

    if (!material) continue;

    jobs.push({
      key: String(sectionIndex),
      sectionIndex,
      sectionId: section.id ?? null,
      sectionTitle: section.title || `Section ${sectionIndex + 1}`,
      material,
    });
  }

  if (!jobs.length) {
    errorEl.textContent = "Add material to at least one included section.";
    return;
  }

  statusEl.textContent = `Generating ${jobs.length} section(s)…`;
  btn.disabled = true;

  try {
    const data = await api("/api/cms/batch-generate-exercises", {
      method: "POST",
      body: {
        ...settings,
        sections: jobs,
      },
    });

    state.batchDraftResults = data.results || [];
    renderBatchPreview(state.batchDraftResults);
    const stats = data.stats || {};
    statusEl.textContent = `Done: ${stats.succeeded || 0} succeeded, ${stats.failed || 0} failed. Review and apply below.`;
    if ((stats.failed || 0) > 0) {
      const failed = state.batchDraftResults.filter((entry) => !entry.ok).map((entry) => entry.sectionTitle).join(", ");
      errorEl.textContent = failed ? `Failed: ${failed}` : "";
    }
  } catch (err) {
    statusEl.textContent = "";
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function applyBatchResultsToSections() {
  syncSectionsMetadataFromDom();
  const selected = new Map();

  document.querySelectorAll(".cms-batch-select:checked").forEach((input) => {
    const resultIndex = Number(input.dataset.batchResultIndex);
    const exerciseIndex = Number(input.dataset.batchExerciseIndex);
    if (!selected.has(resultIndex)) selected.set(resultIndex, new Set());
    selected.get(resultIndex).add(exerciseIndex);
  });

  if (!selected.size) {
    $("#cms-batch-error").textContent = "Select at least one generated exercise.";
    return;
  }

  let appliedExercises = 0;
  for (const [resultIndex, exerciseIndexes] of selected.entries()) {
    const result = state.batchDraftResults[resultIndex];
    if (!result?.ok) continue;
    const sectionIndex =
      result.sectionIndex != null && state.sections[result.sectionIndex]
        ? result.sectionIndex
        : resolveImportSectionIndex(result);
    if (sectionIndex < 0) continue;

    const section = state.sections[sectionIndex];
    if (!section.exercises) section.exercises = [];
    (result.exercises || []).forEach((exercise, exerciseIndex) => {
      if (!exerciseIndexes.has(exerciseIndex)) return;
      section.exercises.push({
        ...exercise,
        order: section.exercises.length + 1,
      });
      appliedExercises += 1;
    });
  }

  if (!appliedExercises) {
    $("#cms-batch-error").textContent = "Could not apply selected exercises.";
    return;
  }

  renderSectionEditors();
  $("#cms-batch-error").textContent = "";
  $("#cms-batch-generate-status").textContent = `Applied ${appliedExercises} exercise(s). Save sections when ready.`;
  state.batchDraftResults = [];
  renderBatchPreview([]);
}

function renderAiPreview(exercises) {
  renderAiPreviewGrouped([
    {
      key: "section",
      title: state.sections[state.editingSectionIndex]?.title?.trim() || "Generated exercises",
      items: (exercises || []).map((exercise, index) => ({ exercise, index })),
    },
  ]);
}

function aiDragHandleMarkup(label = "Drag to reorder question") {
  return `<span class="cms-drag-handle" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="5" cy="4" r="1.25" fill="currentColor"/><circle cx="11" cy="4" r="1.25" fill="currentColor"/><circle cx="5" cy="8" r="1.25" fill="currentColor"/><circle cx="11" cy="8" r="1.25" fill="currentColor"/><circle cx="5" cy="12" r="1.25" fill="currentColor"/><circle cx="11" cy="12" r="1.25" fill="currentColor"/></svg></span>`;
}

function flattenGroupItemsForReview(groupItems) {
  const flat = [];
  const videos = [];
  (groupItems || []).forEach(({ exercise, index: exerciseIndex }) => {
    if (!exercise) return;
    if (exercise.type === "video") {
      videos.push({ exercise, exerciseIndex });
      return;
    }
    const meta = {
      title: exercise.title,
      subTitle: exercise.subTitle,
      _courseGroup: exercise._courseGroup,
      _courseKey: exercise._courseKey,
      _sectionTitle: exercise._sectionTitle,
    };
    (exercise.items || []).forEach((item, itemIndex) => {
      flat.push({
        type: exercise.type || "mcquiz",
        item,
        exerciseIndex,
        itemIndex,
        included: exercise.included !== false,
        meta,
      });
    });
  });
  return { flat, videos };
}

function rebuildAiDraftFromFlatQuestions(flatEntries, previousExercises) {
  const segments = [];
  for (const entry of flatEntries || []) {
    const last = segments[segments.length - 1];
    if (last && last.type === entry.type && last.included === entry.included) {
      last.items.push(entry.item);
    } else {
      segments.push({
        type: entry.type,
        included: entry.included,
        items: [entry.item],
        meta: entry.meta || {},
      });
    }
  }

  const priorPool = (Array.isArray(previousExercises) ? previousExercises : []).filter(
    (exercise) => exercise?.type && exercise.type !== "video"
  );
  const usedPrior = new Set();

  return segments.map((segment) => {
    let priorIndex = priorPool.findIndex(
      (exercise, index) => !usedPrior.has(index) && exercise.type === segment.type
    );
    if (priorIndex < 0) {
      priorIndex = priorPool.findIndex((exercise) => exercise.type === segment.type);
    }
    const prior = priorIndex >= 0 ? priorPool[priorIndex] : null;
    if (priorIndex >= 0) usedPrior.add(priorIndex);
    const fallback = priorPool[0] || segment.meta;
    return {
      type: segment.type,
      title: prior?.title || segment.meta?.title || exerciseTypeShortLabel(segment.type),
      subTitle: prior?.subTitle || segment.meta?.subTitle || exerciseSubTitleForType(segment.type),
      included: segment.included,
      items: segment.items,
      _courseGroup: prior?._courseGroup ?? segment.meta?._courseGroup ?? fallback?._courseGroup,
      _courseKey: prior?._courseKey ?? segment.meta?._courseKey ?? fallback?._courseKey,
      _sectionTitle: prior?._sectionTitle ?? segment.meta?._sectionTitle ?? fallback?._sectionTitle,
    };
  });
}

function readFlatQuestionBlockFromDom(block) {
  const type = block.dataset.itemType || "mcquiz";
  const included = Boolean(block.querySelector(".cms-ai-select")?.checked);
  if (type === "buzzin") {
    return {
      type,
      included,
      item: {
        topic: block.querySelector('[data-field="topic"]')?.value.trim() || "",
        correctAnswer:
          block.querySelector('[data-field="correctAnswer"]')?.value.trim() ||
          "Any clear, relevant spoken answer is acceptable.",
        image: block.querySelector(".cms-ai-q-image-value")?.value.trim() || null,
      },
    };
  }
  const options = [...block.querySelectorAll(".cms-ai-option-row")]
    .map((row) => ({
      text: row.querySelector(".cms-ai-opt-text")?.value.trim() || "",
      isCorrect: Boolean(row.querySelector('input[type="radio"]')?.checked),
    }))
    .filter((opt) => opt.text);
  return {
    type,
    included,
    item: {
      title: block.querySelector('[data-field="title"]')?.value.trim() || "",
      options: ensureSingleCorrectOption(options),
      timeLimit:
        Number(block.querySelector(".cms-ai-item-time")?.value) ||
        (type === "fastmcquiz" ? 10 : 15),
      image: block.querySelector(".cms-ai-q-image-value")?.value.trim() || null,
    },
  };
}

function readAiVideoExerciseFromDom(card, previous) {
  const exerciseIndex = Number(card.dataset.aiIndex);
  const previousExercise = Number.isFinite(exerciseIndex) ? previous?.[exerciseIndex] : null;
  const included = Boolean(card.querySelector(".cms-ai-select")?.checked);
  const title =
    card.querySelector(".cms-ai-edit-title")?.value.trim() ||
    previousExercise?.title?.trim() ||
    exerciseTypeShortLabel("video");
  const videoUrl = card.querySelector(".cms-ai-video-url")?.value.trim() || "";
  return {
    type: "video",
    title,
    subTitle: exerciseSubTitleForType("video"),
    included,
    items: [{ videoUrl }],
    _courseGroup: previousExercise?._courseGroup,
    _courseKey: previousExercise?._courseKey,
    _sectionTitle: previousExercise?._sectionTitle,
  };
}

function collectAiReviewGroupFromDom(groupEl, previous) {
  const exercises = [];
  const list = groupEl.querySelector(".cms-ai-question-list");
  if (list) {
    const indices = (list.dataset.exerciseIndices || "")
      .split(",")
      .map((value) => Number(value))
      .filter(Number.isFinite);
    const groupPrevious = indices.map((index) => previous?.[index]).filter(Boolean);
    const sourceMeta = groupPrevious[0] || {};
    const flatEntries = [...list.querySelectorAll(".cms-ai-item-block")].map((block) => {
      const entry = readFlatQuestionBlockFromDom(block);
      entry.meta = {
        title: sourceMeta.title,
        subTitle: sourceMeta.subTitle,
        _courseGroup: sourceMeta._courseGroup,
        _courseKey: sourceMeta._courseKey,
        _sectionTitle: sourceMeta._sectionTitle,
      };
      return entry;
    });
    exercises.push(...rebuildAiDraftFromFlatQuestions(flatEntries, groupPrevious));
  }
  groupEl.querySelectorAll(".cms-ai-edit-card[data-type='video']").forEach((card) => {
    exercises.push(readAiVideoExerciseFromDom(card, previous));
  });
  return exercises;
}

function renderAiAddQuestionRow() {
  return `
    <div class="cms-ai-add-question-row" role="group" aria-label="Add question">
      <button type="button" class="btn secondary small cms-ai-add-question" data-add-type="mcquiz">Add MC</button>
      <button type="button" class="btn secondary small cms-ai-add-question" data-add-type="fastmcquiz">Add Fast MC</button>
      <button type="button" class="btn secondary small cms-ai-add-question" data-add-type="buzzin">Add Buzz In</button>
    </div>`;
}

function renderAiQuestionBlock(type, item, questionNumber, flatIndex, included = true) {
  const blockType = type || "mcquiz";
  const head = `
    <div class="cms-ai-item-block-head">
      <div class="cms-ai-item-block-head-start">
        ${aiDragHandleMarkup()}
        <label class="cms-ai-include-toggle cms-ai-include-toggle--compact">
          <input type="checkbox" class="cms-ai-select" ${included ? "checked" : ""} aria-label="Include question ${questionNumber}" />
          <span class="visually-hidden">Include</span>
        </label>
        ${aiTypeBadge(blockType)}
        <span class="cms-ai-item-number">Question ${questionNumber}</span>
      </div>
      <div class="cms-ai-item-block-actions">
        <button type="button" class="cms-row-btn cms-row-btn-quiet cms-ai-remove-item">Remove</button>
      </div>
    </div>`;

  if (blockType === "buzzin") {
    return `
      <div class="cms-ai-item-block cms-ai-buzzin-block" data-item-type="buzzin" data-flat-index="${flatIndex}" data-question-number="${questionNumber}">
        ${head}
        <label class="field cms-ai-field">
          <textarea class="cms-ai-item-input cms-ai-item-textarea" data-field="topic" rows="2" placeholder="What should the student answer aloud?" aria-label="Question">${escapeHtml(item.topic || "")}</textarea>
        </label>
        ${renderAiQuestionImageField(item)}
        <label class="field cms-ai-field">
          <span>Expected answer</span>
          <textarea class="cms-ai-item-input cms-ai-item-textarea" data-field="correctAnswer" rows="2" placeholder="Acceptable answer rubric for AI scoring">${escapeHtml(item.correctAnswer || "")}</textarea>
        </label>
      </div>`;
  }

  const options = (item.options || [])
    .map(
      (opt, optIndex) => `
        <div class="cms-ai-option-row">
          <input type="radio" name="cms-ai-correct-${flatIndex}" ${opt.isCorrect ? "checked" : ""} aria-label="Correct option" />
          <input type="text" class="cms-ai-opt-text" value="${escapeHtml(opt.text || "")}" placeholder="Option ${optIndex + 1}" />
        </div>`
    )
    .join("");

  return `
    <div class="cms-ai-item-block cms-ai-quiz-block" data-item-type="${escapeHtml(blockType)}" data-flat-index="${flatIndex}" data-question-number="${questionNumber}">
      ${head}
      <input type="text" class="cms-ai-item-input cms-ai-item-question" data-field="title" value="${escapeHtml(item.title || "")}" placeholder="Question text" />
      ${renderAiQuestionImageField(item)}
      <label class="cms-ai-field field cms-ai-time-field">
        <span>Time (sec)</span>
        <input type="number" class="cms-ai-item-time" min="5" max="60" value="${escapeHtml(String(item.timeLimit || (blockType === "fastmcquiz" ? 10 : 15)))}" />
      </label>
      <div class="cms-ai-options-stack" aria-label="Answer options">
        ${options}
      </div>
      <div class="cms-ai-item-toolbar">
        <button type="button" class="btn secondary small cms-ai-add-option">Add option</button>
      </div>
    </div>`;
}

function renderAiVideoCard(exercise, index) {
  const included = exercise.included !== false;
  const videoUrl = exercise.items?.[0]?.videoUrl || "";
  return `
    <article class="cms-ai-preview-card cms-ai-edit-card" data-ai-index="${index}" data-type="video">
      <div class="cms-ai-preview-head">
        <label class="cms-ai-include-toggle">
          <input type="checkbox" class="cms-ai-select" data-ai-index="${index}" ${included ? "checked" : ""} aria-label="Include ${escapeHtml(exercise.title || "exercise")}" />
          <span>Include</span>
        </label>
        ${aiTypeBadge("video")}
        <div class="cms-ai-preview-meta">
          <input type="text" class="cms-ai-edit-title" value="${escapeHtml(exercise.title || "")}" placeholder="Exercise title" />
        </div>
      </div>
      <div class="cms-ai-edit-card-body">
        <label class="field">
          <span>Video URL</span>
          <input type="url" class="cms-ai-video-url" value="${escapeHtml(videoUrl)}" placeholder="https://..." />
        </label>
        ${cmsVideoPreviewMarkup(videoUrl)}
      </div>
    </article>`;
}

function renderAiReviewGroupContent(groupItems, questionOffset = 0) {
  const { flat, videos } = flattenGroupItemsForReview(groupItems);
  const exerciseIndices = (groupItems || []).map(({ index }) => index).join(",");
  const questions = flat
    .map((entry, index) =>
      renderAiQuestionBlock(
        entry.type,
        entry.item,
        questionOffset + index + 1,
        questionOffset + index,
        entry.included
      )
    )
    .join("");
  const videoCards = videos.map(({ exercise, exerciseIndex }) => renderAiVideoCard(exercise, exerciseIndex)).join("");
  return {
    html: `
      <div class="cms-ai-question-list" data-exercise-indices="${escapeHtml(exerciseIndices)}">
        ${questions || `<p class="hint cms-ai-question-empty">No questions yet. Add one below.</p>`}
      </div>
      ${videoCards}
      ${renderAiAddQuestionRow()}`,
    questionCount: flat.length,
  };
}

function collectAiDraftFromDom() {
  const container = $("#cms-ai-preview");
  if (!container) return state.aiDraftExercises || [];
  const previous = state.aiDraftExercises || [];

  const groups = container.querySelectorAll(".cms-ai-course-preview-group");
  if (groups.length) {
    const rebuilt = [];
    groups.forEach((groupEl) => {
      rebuilt.push(...collectAiReviewGroupFromDom(groupEl, previous));
    });
    state.aiDraftExercises = rebuilt;
    return rebuilt;
  }

  const list = container.querySelector(".cms-ai-question-list");
  if (list) {
    const indices = (list.dataset.exerciseIndices || "")
      .split(",")
      .map((value) => Number(value))
      .filter(Number.isFinite);
    const groupPrevious = indices.map((index) => previous?.[index]).filter(Boolean);
    const flatEntries = [...list.querySelectorAll(".cms-ai-item-block")].map(readFlatQuestionBlockFromDom);
    flatEntries.forEach((entry) => {
      const source = groupPrevious[0];
      if (source) {
        entry.meta = {
          title: source.title,
          subTitle: source.subTitle,
          _courseGroup: source._courseGroup,
          _courseKey: source._courseKey,
          _sectionTitle: source._sectionTitle,
        };
      }
    });
    const rebuilt = rebuildAiDraftFromFlatQuestions(flatEntries, groupPrevious);
    container.querySelectorAll(".cms-ai-edit-card[data-type='video']").forEach((card) => {
      rebuilt.push(readAiVideoExerciseFromDom(card, previous));
    });
    state.aiDraftExercises = rebuilt;
    return rebuilt;
  }

  state.aiDraftExercises = previous;
  return previous;
}

function setupAiQuestionDrag(block, container) {
  block.draggable = false;
  const handle = block.querySelector(".cms-drag-handle");
  handle?.addEventListener("pointerdown", () => {
    block.draggable = true;
    const stop = () => {
      if (!block.classList.contains("dragging-ai-question")) block.draggable = false;
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointerup", stop);
  });

  block.addEventListener("dragstart", (event) => {
    if (!block.draggable) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    block.classList.add("dragging-ai-question");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", block.dataset.flatIndex || "");
  });

  block.addEventListener("dragend", () => {
    block.classList.remove("dragging-ai-question");
    block.draggable = false;
    collectAiDraftFromDom();
    renderAiPreviewStep();
  });

  block.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const dragging = container.querySelector(".dragging-ai-question");
    if (!dragging || dragging === block) return;
    const rect = block.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    container.insertBefore(dragging, after ? block.nextSibling : block);
  });
}

function wireAiQuestionLists() {
  document.querySelectorAll(".cms-ai-question-list").forEach((list) => {
    list.querySelectorAll(".cms-ai-item-block").forEach((block) => {
      setupAiQuestionDrag(block, list);
    });
  });
}

function renderAiPublishSummary() {
  const summary = $("#cms-ai-publish-summary");
  if (!summary) return;

  if (state.aiCourseMode) {
    const groups = selectedAiCourseGroups();
    const itemCount = groups.reduce(
      (sum, group) => sum + group.exercises.reduce((n, exercise) => n + (exercise.items?.length || 0), 0),
      0
    );
    if (!groups.length) {
      summary.innerHTML = `<p>No course exercises selected. Go back to Preview and include at least one.</p>`;
      return;
    }
    const lines = groups
      .map(
        (group) =>
          `<li>${escapeHtml(group.sectionTitle)} — ${group.exercises.length} exercise(s)</li>`
      )
      .join("");
    summary.innerHTML = `
      <p>${groups.length} section(s), ${itemCount} item(s) will be saved into the course.</p>
      <ul>${lines}</ul>`;
    return;
  }

  const drafts = collectAiDraftFromDom();
  const selected = drafts.filter((exercise) => exercise.included !== false);
  const itemCount = selected.reduce((sum, exercise) => sum + (exercise.items?.length || 0), 0);
  if (!selected.length) {
    summary.innerHTML = `<p>No exercises selected. Go back to Preview and include at least one.</p>`;
    return;
  }
  const lines = selected
    .map(
      (exercise) =>
        `<li>${escapeHtml(exercise.title)} — ${escapeHtml(exercise.subTitle || exercise.type)} (${exercise.items.length})</li>`
    )
    .join("");
  summary.innerHTML = `
    <p>${selected.length} exercise(s), ${itemCount} item(s) will be saved into this section.</p>
    <ul>${lines}</ul>`;
}

function syncAiFileNameLabel() {
  const input = $("#cms-ai-file");
  const dropLabel = $("#cms-ai-file-drop-label");
  const meta = $("#cms-ai-file-name");
  const dropZone = $("#cms-ai-file-drop");
  const files = getAiSelectedFiles();
  renderAiFileList();
  if (!dropLabel) return;
  if (!files.length) {
    dropLabel.textContent = "Choose or drop files";
    if (meta) {
      meta.hidden = true;
      meta.textContent = "";
    }
    dropZone?.classList.remove("has-file");
    if (input) input.value = "";
    syncAiMaterialState();
    return;
  }
  if (files.length === 1) {
    const file = files[0];
    dropLabel.textContent = file.name.length > 30 ? `${file.name.slice(0, 27)}…` : file.name;
    if (meta) {
      meta.hidden = false;
      meta.textContent = formatAiFileSize(file.size);
    }
  } else {
    dropLabel.textContent = `${files.length} files selected`;
    if (meta) {
      meta.hidden = false;
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      meta.textContent = formatAiFileSize(totalBytes);
    }
  }
  dropZone?.classList.add("has-file");
  syncAiMaterialState();
}

async function extractAiMaterial(options = {}) {
  const statusEl = options.statusEl || $("#cms-ai-extract-status") || $("#cms-ai-generate-status");
  const errorEl = $("#cms-ai-error");
  const previewEl = $("#cms-ai-material-preview");
  const manageBusy = options.manageBusy !== false;
  if (!errorEl || !previewEl) return false;

  setCmsError(errorEl, "");
  if (statusEl && !options.silentStatus) {
    statusEl.hidden = false;
    statusEl.textContent = "Preparing material…";
  }
  if (manageBusy) setAiWizardBusy(true, "Preparing material…");

  try {
    const files = getAiSelectedFiles();
    const pasted = $("#cms-ai-paste")?.value.trim();
    const videoUrl = $("#cms-ai-video-url")?.value.trim();
    if (!files.length && !pasted && !videoUrl) {
      throw new Error("Paste text, upload file(s), or provide a video URL.");
    }

    const data = await extractMaterialRequest({
      files,
      pasted,
      videoUrl,
      language: getAiSpeakLangCode(),
      maxChars: options.forCourse || state.aiCourseMode ? 40000 : undefined,
    });

    state.aiMaterialText = data.text || "";
    if (Array.isArray(data.imageAssets)) {
      state.aiMaterialAssets = data.imageAssets;
      // #region agent log
      fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
        body: JSON.stringify({
          sessionId: "365eeb",
          location: "cms.js:extractAiMaterial",
          message: "material assets replaced from extract",
          data: {
            assetCount: state.aiMaterialAssets.length,
            labels: state.aiMaterialAssets.map((asset) => asset.label),
          },
          timestamp: Date.now(),
          hypothesisId: "IMG-CROP",
          runId: "image-vision-crop",
        }),
      }).catch(() => {});
      // #endregion
    }
    previewEl.value = state.aiMaterialText;
    previewEl.hidden = true;
    if (statusEl && !options.silentStatus) {
      const filePrefix = data.fileCount > 1 ? `${data.fileCount} files · ` : "";
      const assetSuffix =
        data.imageAssetCount > 0
          ? ` · ${data.imageAssetCount} figure(s) extracted${data.imageAssetCount > 1 ? " (cropped)" : ""}`
          : "";
      statusEl.textContent = data.truncated
        ? `${filePrefix}Ready (${data.originalLength} chars, truncated for generation).${assetSuffix}`
        : `${filePrefix}Ready (${state.aiMaterialText.length} chars).${assetSuffix}`;
      if (data.source === "video") {
        statusEl.textContent += data.captionUrl ? " Video transcribed." : " Video uploaded.";
      } else if (data.source === "audio") {
        statusEl.textContent += " Audio transcribed.";
      } else if (data.source === "image") {
        statusEl.textContent += " Image converted to markdown.";
      }
    }
    syncAiMaterialState();
    renderMaterialAssetLibrary();
    return true;
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.hidden = true;
    }
    setCmsError(errorEl, err.message);
    return false;
  } finally {
    if (manageBusy) setAiWizardBusy(false);
  }
}

async function createAiVideoExercise(script, { onUpdate, onLog } = {}) {
  const trimmed = String(script || "").trim();
  if (!trimmed) {
    throw new Error("Prepare or paste a script first.");
  }

  const renderLog = (logs) => {
    const videoLog = $("#cms-ai-video-log");
    if (!videoLog) return;
    const lines = Array.isArray(logs) ? logs.filter(Boolean) : [];
    if (!lines.length) {
      videoLog.hidden = true;
      videoLog.textContent = "";
      return;
    }
    videoLog.hidden = false;
    videoLog.textContent = lines.join("\n");
    videoLog.scrollTop = videoLog.scrollHeight;
    if (typeof onLog === "function") onLog(lines);
  };

  renderLog(["Queued."]);
  const started = await api("/api/cms/generate-video", {
    method: "POST",
    body: { text: trimmed },
  });

  const finished = await pollVideoGenerationJob(started.jobId, {
    onUpdate: (data) => {
      renderLog(data.logs);
      if (typeof onUpdate === "function") onUpdate(data);
    },
  });

  if (!finished.videoUrl) {
    throw new Error("Video job completed, but no video URL was returned.");
  }

  const section = state.sections[state.editingSectionIndex];
  const sectionTitle = section?.title?.trim() || "Lesson";
  return {
    type: "video",
    title: `${sectionTitle} video`,
    subTitle: exerciseSubTitleForType("video"),
    items: [{ videoUrl: finished.videoUrl }],
    included: true,
  };
}

async function generateAiExercises(options = {}) {
  const statusEl = $("#cms-ai-generate-status");
  const errorEl = $("#cms-ai-error");
  const btn = $("#btn-cms-ai-next");
  if (!statusEl || !errorEl) return false;

  let material = getAiMaterialText();
  const llmTypes = aiLlmTypeCounts();
  const wantsVideo = aiWantsVideo();
  const settings = getAiGenerationSettings();
  const manageBusy = options.manageBusy !== false;

  errorEl.textContent = "";
  resetAiGenProgress();
  setAiGenProgress(0, "Starting…");
  if (manageBusy) setAiWizardBusy(true, "Starting…");

  try {
    if (!material) {
      const files = getAiSelectedFiles();
      const pasted = $("#cms-ai-paste")?.value.trim();
      const videoUrl = $("#cms-ai-video-url")?.value.trim();
      if (files.length || pasted || videoUrl) {
        setAiGenProgress(8, "Preparing material…");
        const prepared = await extractAiMaterial({
          manageBusy: false,
          statusEl,
          forCourse: state.aiCourseMode,
          silentStatus: true,
        });
        if (!prepared) {
          resetAiGenProgress();
          return false;
        }
        material = getAiMaterialText();
        setAiGenProgress(35, "Material ready");
      }
    } else {
      setAiGenProgress(20, "Material ready");
    }
    if (!material) {
      resetAiGenProgress();
      setCmsError(
        errorEl,
        isAiVideoOnly() ? "Paste or upload a lesson script first." : "Add source material first."
      );
      return false;
    }
    if (!Object.keys(llmTypes).length && !wantsVideo) {
      resetAiGenProgress();
      setCmsError(errorEl, "Select at least one exercise type.");
      return false;
    }

    const generatingLabel =
      wantsVideo && !Object.keys(llmTypes).length
        ? "Generating video…"
        : getAiInstructions()
          ? "Applying your prompt, then generating exercises…"
          : "Generating exercises…";
    setAiGenProgress(45, generatingLabel);
    startAiGenProgressTicker(45, 88, 90000);

    let exercises = [];

    if (Object.keys(llmTypes).length) {
      const instructions = getAiInstructions();
      const data = await api("/api/cms/generate-exercises", {
        method: "POST",
        body: {
          material,
          langCode: settings.langCode,
          difficulty: settings.difficulty,
          types: llmTypes,
          instructions: instructions || undefined,
          imageAssets: state.aiMaterialAssets?.length ? state.aiMaterialAssets : undefined,
        },
      });
      // #region agent log
      fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
        body: JSON.stringify({
          sessionId: "365eeb",
          location: "cms.js:generateAiExercises",
          message: "generate-exercises langCode sent",
          data: {
            langCode: settings.langCode,
            speakLangCode: settings.speakLangCode,
            difficulty: settings.difficulty,
          },
          timestamp: Date.now(),
          hypothesisId: "H-GEN-LANG",
          runId: "gen-lang",
        }),
      }).catch(() => {});
      // #endregion
      exercises = data.exercises || [];
      // #region agent log
      fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
        body: JSON.stringify({
          sessionId: "365eeb",
          location: "cms.js:generateAiExercises",
          message: "api exercises before auto-apply",
          data: {
            itemCount: exercises.reduce((count, ex) => count + (ex.items || []).length, 0),
            withImage: exercises.reduce(
              (count, ex) => count + (ex.items || []).filter((item) => item?.image).length,
              0
            ),
            sampleItems: exercises
              .flatMap((ex) => ex.items || [])
              .slice(0, 5)
              .map((item) => ({
                title: item?.title || item?.topic || "",
                image: item?.image || null,
                imageRef: item?.imageRef || null,
                imageRefConfidence: item?.imageRefConfidence ?? item?.confidence ?? null,
              })),
          },
          timestamp: Date.now(),
          hypothesisId: "IMG-MATCH",
          runId: "image-match-v3",
        }),
      }).catch(() => {});
      // #endregion
      exercises = autoApplyMaterialImagesToExercises(exercises, state.aiMaterialAssets);
      const stats = data.stats || {};
      stopAiGenProgressTicker();
      setAiGenProgress(90, "Finishing…");
      if (stats.partial && !options.silentStatus) {
        statusEl.textContent = `Generated ${stats.generated || exercises.length} item(s) (partial).`;
      }
    }

    if (wantsVideo) {
      const videoCount = getAiTypeCounts().video || 1;
      const section = state.sections[state.editingSectionIndex];
      const sectionTitle = section?.title?.trim() || "Lesson";
      for (let i = 0; i < videoCount; i++) {
        const videoLabel =
          videoCount > 1
            ? `Generating video ${i + 1} of ${videoCount}…`
            : "Generating video…";
        setAiGenProgress(90 + Math.round(((i + 1) / videoCount) * 8), videoLabel);
        if (!options.silentStatus) {
          statusEl.textContent =
            videoCount > 1
              ? `Generating video ${i + 1} of ${videoCount}… this can take a few minutes.`
              : "Generating video… this can take a few minutes.";
        }
        const videoExercise = await createAiVideoExercise(material, {
          onUpdate: (data) => {
            if (data.status) {
              const prefix = videoCount > 1 ? `Video ${i + 1}/${videoCount}: ` : "Video: ";
              statusEl.textContent = `${prefix}${data.status}${
                data.segmentsDone && data.segmentCount
                  ? ` (${data.segmentsDone}/${data.segmentCount})`
                  : ""
              }`;
            }
          },
        });
        if (videoCount > 1) videoExercise.title = `${sectionTitle} video ${i + 1}`;
        if (settings.speakLangCode) videoExercise.speakLangCode = settings.speakLangCode;
        exercises.push(videoExercise);
      }
    }

    if (settings.speakLangCode) {
      exercises = exercises.map((exercise) => ({ ...exercise, speakLangCode: settings.speakLangCode }));
    }
    // #region agent log
    fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
      body: JSON.stringify({
        sessionId: "365eeb",
        location: "cms.js:generateAiExercises",
        message: "speak lang stamped on draft exercises",
        data: {
          speakLangCode: settings.speakLangCode,
          exerciseCount: exercises.length,
          sample: exercises.slice(0, 3).map((exercise) => ({
            type: exercise.type,
            speakLangCode: exercise.speakLangCode || null,
          })),
        },
        timestamp: Date.now(),
        hypothesisId: "H1",
        runId: "speak-lang",
      }),
    }).catch(() => {});
    // #endregion

    state.aiDraftExercises = exercises;
    resetAiReviewAgent();
    renderAiPreview(state.aiDraftExercises);
    renderMaterialAssetLibrary();
    stopAiGenProgressTicker();
    setAiGenProgress(100, "Done");
    if (!options.silentStatus) {
      const withImages = exercises.reduce(
        (count, exercise) => count + (exercise.items || []).filter((item) => item?.image).length,
        0
      );
      const imageNote = withImages ? ` · ${withImages} question image(s) attached` : "";
      statusEl.textContent = exercises.length
        ? `Ready with ${exercises.length} exercise(s)${imageNote}. Edit, then continue.`
        : "Nothing was generated.";
    }
    showAiGenSummary(buildAiGenSummaryFromExercises(exercises));
    return exercises.length > 0;
  } catch (err) {
    stopAiGenProgressTicker();
    resetAiGenProgress();
    statusEl.textContent = "";
    setCmsError(errorEl, err.message);
    return false;
  } finally {
    if (manageBusy) setAiWizardBusy(false);
  }
}

function selectedAiExercises() {
  return collectAiDraftFromDom().filter((exercise) => {
    if (exercise.included === false) return false;
    if (exercise.type === "video") return exercise.items.some((item) => item.videoUrl);
    if (exercise.type === "buzzin") return exercise.items.some((item) => item.topic);
    return exercise.items.some((item) => item.title && (item.options || []).length >= 2);
  });
}

function addAiExercisesToSection() {
  const sectionIndex = state.editingSectionIndex;
  if (sectionIndex == null) return 0;

  syncExercisesFromDomIfRendered();
  const section = state.sections[sectionIndex];
  if (!section) return 0;

  const picks = selectedAiExercises();
  if (!picks.length) {
    $("#cms-ai-error").textContent = "Select at least one generated exercise.";
    return 0;
  }

  if (!section.exercises) section.exercises = [];
  const beforeCount = section.exercises.length;
  picks.forEach((exercise) => {
    const { included: _included, ...rest } = exercise;
    section.exercises.push({
      ...rest,
      order: section.exercises.length + 1,
    });
  });

  state.expandedExerciseIndex = null;
  renderExerciseEditors({ skipReveal: true });
  // #region agent log
  fetch('http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'365eeb'},body:JSON.stringify({sessionId:'365eeb',location:'cms.js:addAiExercisesToSection',message:'exercises merged for publish',data:{beforeCount,added:picks.length,afterCount:section.exercises.length,speakLangCodes:picks.map((exercise)=>exercise.speakLangCode||null),domCards:document.querySelectorAll('#cms-exercise-list .cms-exercise-card').length},timestamp:Date.now(),hypothesisId:'H2',runId:'speak-lang'})}).catch(()=>{});
  // #endregion
  return picks.length;
}

async function publishAiExercises() {
  if (state.aiCourseMode) {
    await publishAiCourse();
    return;
  }
  const errorEl = $("#cms-ai-error");
  const statusEl = $("#cms-ai-generate-status");
  const btn = $("#btn-cms-ai-publish");
  if (!errorEl || !statusEl || !btn) return;

  errorEl.textContent = "";
  const added = addAiExercisesToSection();
  if (!added) return;

  await saveCourseStructure({
    errorEl,
    statusEl,
    btn,
    successMessage: `Published ${added} exercise(s). Ready to host.`,
  });
  if (!errorEl.innerHTML.trim()) {
    showCmsToast(
      `Published successfully — ${added} exercise${added === 1 ? "" : "s"} added to this section.`
    );
    $("#cms-exercises-status").textContent = `Published ${added} exercise(s). Ready to host.`;
    state.expandedExerciseIndex = null;
    state.exercisesSaveUnlocked = true;
    syncExercisesSaveButton();
    resetAiGeneratePanel();
  }
}

async function handleAiWizardNext() {
  if (state.aiWizardBusy) return;
  const errorEl = $("#cms-ai-error");
  if (errorEl) setCmsError(errorEl, "");
  const step = state.aiWizardStep;

  if (step === 1) {
    const types = getAiTypeCounts();
    if (!Object.keys(types).length) {
      setCmsError(errorEl, "Pick a template or at least one custom exercise type.");
      return;
    }
    setAiWizardStep(2);
    return;
  }

  if (step === 2) {
    if (state.aiCourseMode) {
      if (hasAiPreviewReady()) {
        renderAiPreviewStep();
        setAiWizardStep(3);
        return;
      }
      resetAiGenProgress();
      setAiGenProgress(0, "Starting…");
      setAiWizardBusy(true, "Starting…");
      try {
        setAiGenProgress(10, "Building course plan…");
        const analyzed = await analyzeAiCoursePlan({ manageBusy: false, silentStatus: true });
        if (!analyzed) {
          resetAiGenProgress();
          return;
        }
        setAiGenProgress(40, "Generating course…");
        startAiGenProgressTicker(40, 88, 120000);
        const generated = await generateCourseFromPlan({ manageBusy: false, silentStatus: true });
        stopAiGenProgressTicker();
        if (!generated) {
          resetAiGenProgress();
          return;
        }
        setAiGenProgress(100, "Done");
        setAiWizardStep(3);
      } finally {
        setAiWizardBusy(false);
      }
      return;
    }
    if (hasAiPreviewReady()) {
      // #region agent log
      fetch('http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'365eeb'},body:JSON.stringify({sessionId:'365eeb',location:'cms.js:handleAiWizardNext',message:'step2 next preview-ready path',data:{assetCount:state.aiMaterialAssets?.length||0},timestamp:Date.now(),hypothesisId:'D',runId:'pre-fix'})}).catch(()=>{});
      // #endregion
      autoApplyMaterialImagesToDraft();
      renderAiPreviewStep();
      setAiWizardStep(3);
      return;
    }
    const ok = await generateAiExercises();
    if (ok) {
      // #region agent log
      fetch('http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'365eeb'},body:JSON.stringify({sessionId:'365eeb',location:'cms.js:handleAiWizardNext',message:'step2 next generate path',data:{assetCount:state.aiMaterialAssets?.length||0},timestamp:Date.now(),hypothesisId:'D',runId:'pre-fix'})}).catch(()=>{});
      // #endregion
      autoApplyMaterialImagesToDraft();
      renderAiPreviewStep();
      setAiWizardStep(3);
    }
    return;
  }

  if (step === 3) {
    if (state.aiCourseMode) {
      const groups = selectedAiCourseGroups();
      if (!groups.length) {
        setCmsError(errorEl, "Keep at least one exercise, or go back and generate again.");
        return;
      }
    } else {
      const picks = selectedAiExercises();
      if (!picks.length) {
        setCmsError(errorEl, "Keep at least one exercise, or go back and generate again.");
        return;
      }
    }
    setAiWizardStep(4);
  }
}

function handleAiWizardBack() {
  if (state.aiWizardBusy) return;
  setCmsError($("#cms-ai-error"), "");
  if (state.aiWizardStep <= 1) return;
  setAiWizardStep(state.aiWizardStep - 1);
}

function defaultAiItem(type) {
  if (type === "buzzin") {
    return {
      topic: "Talk about this topic using words from the lesson.",
      correctAnswer: "Any clear, relevant spoken answer is acceptable.",
      image: null,
    };
  }
  return {
    title: "New question?",
    options: [
      { text: "Option A", isCorrect: true },
      { text: "Option B", isCorrect: false },
    ],
    timeLimit: type === "fastmcquiz" ? 10 : 15,
    image: null,
  };
}

function handleAiPreviewClick(event) {
  const block = event.target.closest(".cms-ai-item-block");
  const list = event.target.closest(".cms-ai-question-list");

  if (event.target.closest(".cms-ai-add-question")) {
    const addBtn = event.target.closest("[data-add-type]");
    if (!addBtn) return;
    collectAiDraftFromDom();
    const type = addBtn.dataset.addType || "mcquiz";
    const draft = state.aiDraftExercises || [];
    const anchor = draft[draft.length - 1];
    draft.push({
      type,
      title: exerciseTypeShortLabel(type),
      subTitle: exerciseSubTitleForType(type),
      included: true,
      items: [defaultAiItem(type)],
      _courseGroup: anchor?._courseGroup,
      _courseKey: anchor?._courseKey,
      _sectionTitle: anchor?._sectionTitle,
    });
    state.aiDraftExercises = draft;
    renderAiPreviewStep();
    return;
  }

  if (!block || !list) return;
  const flatIndex = Number(block.dataset.flatIndex);
  if (!Number.isFinite(flatIndex)) return;

  collectAiDraftFromDom();

  if (event.target.closest(".cms-ai-remove-item")) {
    collectAiDraftFromDom();
    const previous = state.aiDraftExercises || [];
    const quiz = previous.filter((exercise) => exercise.type !== "video");
    const videos = previous.filter((exercise) => exercise.type === "video");
    const { flat } = flattenGroupItemsForReview(quiz.map((exercise, index) => ({ exercise, index })));
    if (flat.length <= 1) {
      setCmsError($("#cms-ai-error"), "Keep at least one question.");
      return;
    }
    flat.splice(flatIndex, 1);
    state.aiDraftExercises = [...rebuildAiDraftFromFlatQuestions(flat, quiz), ...videos];
    renderAiPreviewStep();
    return;
  }

  if (event.target.closest(".cms-ai-add-option")) {
    const type = block.dataset.itemType || "mcquiz";
    if (type === "buzzin") return;
    const rebuilt = state.aiDraftExercises || [];
    const quiz = rebuilt.filter((exercise) => exercise.type !== "video");
    const videos = rebuilt.filter((exercise) => exercise.type === "video");
    const { flat } = flattenGroupItemsForReview(quiz.map((exercise, index) => ({ exercise, index })));
    const entry = flat[flatIndex];
    if (!entry) return;
    entry.item.options = entry.item.options || [];
    if (entry.item.options.length >= 6) return;
    entry.item.options.push({ text: `Option ${entry.item.options.length + 1}`, isCorrect: false });
    flat[flatIndex] = entry;
    state.aiDraftExercises = [...rebuildAiDraftFromFlatQuestions(flat, quiz), ...videos];
    renderAiPreviewStep();
    return;
  }

  if (event.target.closest(".cms-q-image-preview-btn")) {
    openQuestionImagePreview(block, "cms-ai-q");
    return;
  }

  if (event.target.closest(".cms-ai-q-image-remove")) {
    const valueInput = block.querySelector(".cms-ai-q-image-value");
    if (valueInput) valueInput.value = "";
    updateQuestionImagePreview(block, "", "cms-ai-q");
    const statusEl = block.querySelector(".cms-ai-q-image-status");
    if (statusEl) statusEl.textContent = "";
    return;
  }

  if (event.target.closest(".cms-ai-q-image-generate")) {
    showUpcomingAiImageMessage(block.querySelector(".cms-ai-q-image-status"));
    return;
  }

  if (event.target.closest(".cms-ai-q-pick-asset")) {
    document.querySelectorAll(".cms-ai-item-block.is-asset-pick-target").forEach((el) => {
      el.classList.remove("is-asset-pick-target");
    });
    block.classList.add("is-asset-pick-target");
    const statusEl = block.querySelector(".cms-ai-q-image-status");
    if (statusEl) statusEl.textContent = "Now click an image in the material library.";
    $("#cms-ai-review-assets")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
}

function openSectionExercises(sectionIndex) {
  syncSectionsMetadataFromDom();
  const section = state.sections[sectionIndex];
  if (!section) return;

  const resolvedIndex =
    section.id != null ? state.sections.findIndex((s) => s.id === section.id) : sectionIndex;
  state.editingSectionIndex = resolvedIndex >= 0 ? resolvedIndex : sectionIndex;
  state.expandedExerciseIndex = null;
  state.exerciseAgentCardIndex = null;

  const activeSection = state.sections[state.editingSectionIndex];
  $("#cms-exercises-section-title").textContent =
    activeSection?.title?.trim() || `Section ${state.editingSectionIndex + 1}`;
  state.exercisesSaveUnlocked = (activeSection?.exercises?.length || 0) > 0;
  $("#cms-sections-view").hidden = true;
  $("#cms-exercises-view").hidden = false;
  $("#cms-exercises-error").textContent = "";
  $("#cms-exercises-status").textContent = "";
  resetAiGeneratePanel();
  renderExerciseEditors({ skipReveal: true });
  syncExerciseAgentPanel(false);
  updateExercisesViewDurationEstimate();
  syncExercisesSaveButton();
  cmsMotion()?.playCmsTabEnter?.($("#cms-exercises-view"));
}

function closeSectionExercises({ reRender = true } = {}) {
  if (state.editingSectionIndex != null) syncExercisesFromDom();
  state.editingSectionIndex = null;
  state.expandedExerciseIndex = null;
  $("#cms-sections-view").hidden = false;
  $("#cms-exercises-view").hidden = true;
  if (reRender) renderSectionEditors();
  syncExerciseAgentPanel(false);
}

function switchTab(tabId) {
  const currentTab = getActiveTabId();
  if (currentTab === "sections") {
    if (isExercisesSubpageOpen()) {
      syncExercisesFromDom();
      closeSectionExercises({ reRender: false });
    } else {
      syncSectionsMetadataFromDom();
    }
  }

  document.querySelectorAll(".cms-tab").forEach((tab) => {
    const active = tab.dataset.tab === tabId;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".cms-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `cms-tab-${tabId}`);
  });
  cmsMotion()?.playCmsTabGlider?.();

  if (tabId === "sections") {
    renderSectionEditors();
  } else {
    const panel = document.querySelector(`#cms-tab-${tabId}`);
    if (panel?.classList.contains("active")) {
      cmsMotion()?.playCmsTabEnter?.(panel);
    }
  }
  syncGlobalAgentUi();
}

async function handleBannerFileChange() {
  const input = $("#course-banner-file");
  const file = input?.files?.[0];
  if (!file) return;

  $("#cms-banner-status").textContent = "";
  $("#cms-details-error").textContent = "";

  try {
    $("#cms-banner-status").textContent = "Uploading…";
    const data = await uploadBannerFile(file);
    state.editingCourse = { ...state.editingCourse, ...data.course };
    $("#course-banner").value = data.url || "";
    updateBannerPreview(data.url || "");
    $("#cms-banner-status").textContent = "Thumbnail uploaded.";
  } catch (err) {
    $("#cms-details-error").textContent = err.message;
    $("#cms-banner-status").textContent = "";
  } finally {
    if (input) input.value = "";
  }
}

function handleRemoveBanner() {
  $("#course-banner").value = "";
  updateBannerPreview("");
  $("#cms-banner-status").textContent = "";
}

async function saveDetails() {
  if (!state.editingCourse) return;
  $("#cms-details-error").textContent = "";
  $("#cms-details-status").textContent = "";

  const btn = $("#btn-save-details");
  btn.disabled = true;
  try {
    const data = await api(`/api/cms/courses/${state.editingCourse.id}`, {
      method: "PUT",
      body: {
        name: $("#course-name").value.trim(),
        description: $("#course-description").value.trim(),
        banner: $("#course-banner").value.trim(),
        classIds: getSelectedClassIds(),
      },
    });
    state.editingCourse = { ...state.editingCourse, ...data.course };
    $("#cms-edit-title").textContent = state.editingCourse.name;
    updateBannerPreview(state.editingCourse.banner || "");
    renderAssignedClasses();
    $("#cms-details-status").textContent = "Saved.";
    await enterCourseList();
  } catch (err) {
    $("#cms-details-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function deleteCourse() {
  if (!state.editingCourse) return;
  if (!confirm(`Delete "${state.editingCourse.name}"? This cannot be undone.`)) return;

  try {
    await api(`/api/cms/courses/${state.editingCourse.id}`, { method: "DELETE" });
    state.editingCourse = null;
    await enterCourseList();
  } catch (err) {
    $("#cms-details-error").textContent = err.message;
  }
}

const DEMO_VIDEO_URL =
  "https://s3.ap-east-1.amazonaws.com/langoappmaterial.uat/serverdev/ExerciseVideos/Story_In_the_sea/video-P1_Final.mp4";

function defaultExercise(type) {
  if (type === "video") {
    return {
      type: "video",
      title: "Video lesson",
      subTitle: "Video",
      items: [{ videoUrl: "" }],
    };
  }
  if (type === "buzzin") {
    return {
      type: "buzzin",
      title: "Buzz in Question",
      subTitle: "Buzz in Question",
      items: [
        {
          topic: "What is your favorite animal?",
          correctAnswer: "Any real animal with a clear reason is acceptable.",
        },
        {
          topic: "Name a place you want to visit and say why.",
          correctAnswer: "Any real place with a clear personal reason.",
        },
      ],
    };
  }
  if (type === "fastmcquiz") {
    return {
      type: "fastmcquiz",
      title: "Fast quiz",
      subTitle: "Fast MC Quiz",
      items: [
        {
          title: "Sample question?",
          options: [
            { text: "Option A", isCorrect: true },
            { text: "Option B", isCorrect: false },
          ],
          timeLimit: 15,
        },
      ],
    };
  }
  return {
    type: "mcquiz",
    title: "MC Quiz",
    subTitle: "MC Quiz",
    items: [
      {
        title: "Sample question?",
        options: [
          { text: "Option A", isCorrect: true },
          { text: "Option B", isCorrect: false },
        ],
        timeLimit: 15,
      },
    ],
  };
}

function demoExercise(type) {
  if (type === "video") {
    return {
      type: "video",
      title: "Demo: In the Sea",
      subTitle: "Video",
      items: [{ videoUrl: DEMO_VIDEO_URL }],
    };
  }
  if (type === "buzzin") {
    return {
      type: "buzzin",
      title: "Demo: Ocean Animals",
      subTitle: "Buzz in Question",
      items: [
        {
          topic: "Name an animal that lives in the ocean and say why you like it.",
          correctAnswer: "An ocean animal (for example dolphin, whale, turtle) with a reason.",
        },
        {
          topic: "What is the biggest ocean animal you know?",
          correctAnswer: "Blue whale (or another correctly named large ocean animal).",
        },
        {
          topic: "Would you rather swim with dolphins or turtles? Why?",
          correctAnswer: "Either dolphins or turtles, with a clear reason.",
        },
      ],
    };
  }
  if (type === "fastmcquiz") {
    return {
      type: "fastmcquiz",
      title: "Demo: Fast Quiz",
      subTitle: "Fast MC Quiz",
      items: [
        {
          title: "What do bees make?",
          options: [
            { text: "Honey", isCorrect: true },
            { text: "Milk", isCorrect: false },
            { text: "Bread", isCorrect: false },
          ],
          timeLimit: 10,
        },
        {
          title: "Which planet is closest to the Sun?",
          options: [
            { text: "Mercury", isCorrect: true },
            { text: "Earth", isCorrect: false },
            { text: "Mars", isCorrect: false },
          ],
          timeLimit: 10,
        },
        {
          title: "How many legs does a spider have?",
          options: [
            { text: "6", isCorrect: false },
            { text: "8", isCorrect: true },
            { text: "10", isCorrect: false },
          ],
          timeLimit: 10,
        },
        {
          title: "What gas do plants absorb?",
          options: [
            { text: "Carbon dioxide", isCorrect: true },
            { text: "Helium", isCorrect: false },
            { text: "Neon", isCorrect: false },
          ],
          timeLimit: 10,
        },
        {
          title: "Which season comes after winter?",
          options: [
            { text: "Spring", isCorrect: true },
            { text: "Autumn", isCorrect: false },
            { text: "Summer", isCorrect: false },
          ],
          timeLimit: 10,
        },
      ],
    };
  }
  return {
    type: "mcquiz",
    title: "Demo: English Basics",
    subTitle: "MC Quiz",
    items: [
      {
        title: "What color is the sky on a clear day?",
        options: [
          { text: "Blue", isCorrect: true },
          { text: "Green", isCorrect: false },
          { text: "Red", isCorrect: false },
        ],
        timeLimit: 15,
      },
      {
        title: "How many days are in a week?",
        options: [
          { text: "5", isCorrect: false },
          { text: "7", isCorrect: true },
          { text: "10", isCorrect: false },
        ],
        timeLimit: 15,
      },
      {
        title: "Which word is a noun?",
        options: [
          { text: "Run", isCorrect: false },
          { text: "Happy", isCorrect: false },
          { text: "Book", isCorrect: true },
        ],
        timeLimit: 15,
      },
    ],
  };
}

function parseNewExerciseSelection(value) {
  const raw = value || "mcquiz";
  if (raw.startsWith("demo:")) {
    return { type: raw.slice(5), demo: true };
  }
  return { type: raw, demo: false };
}

function defaultSection(title) {
  const maxId = state.sections.reduce(
    (max, section) => Math.max(max, typeof section.id === "number" ? section.id : 0),
    0
  );
  const maxOrder = state.sections.reduce((max, section) => Math.max(max, section.order || 0), 0);
  return {
    id: maxId + 1,
    title: title || `Section ${state.sections.length + 1}`,
    banner: "",
    order: maxOrder + 1,
    exercises: [],
  };
}

function updateSectionBannerPreview(sectionCard, url) {
  const preview = sectionCard.querySelector(".cms-section-thumbnail-preview");
  const img = sectionCard.querySelector(".cms-section-banner-img");
  const removeBtn = sectionCard.querySelector(".cms-remove-section-banner");
  const bannerUrl = (url || "").trim();
  if (!preview || !img) return;

  if (bannerUrl) {
    img.src = bannerUrl;
    preview.hidden = false;
    if (removeBtn) removeBtn.hidden = false;
  } else {
    img.src = CMS_EMPTY_COVER;
    preview.hidden = true;
    if (removeBtn) removeBtn.hidden = true;
  }}

async function uploadSectionBannerFile(sectionId, file) {
  if (!state.editingCourse) throw new Error("No course selected.");
  if (!sectionId) throw new Error("Save the section before uploading.");
  if (!file) throw new Error("No file selected.");

  const formData = new FormData();
  formData.append("banner", file);

  const headers = { Accept: "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  headers["X-Teacher-Id"] = String(state.user?.id || "");

  const res = await fetch(
    `/api/cms/courses/${state.editingCourse.id}/sections/${sectionId}/banner`,
    {
      method: "POST",
      headers,
      body: formData,
    }
  );

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || res.statusText };
  }

  if (!res.ok) {
    throw new Error(data?.message || `Upload failed (${res.status})`);
  }

  return data;
}

async function uploadQuestionImageFile(file) {
  if (!state.token || !state.user?.id) throw new Error("Please log in again.");
  if (!file) throw new Error("No file selected.");

  const formData = new FormData();
  formData.append("image", file);

  const res = await fetch("/api/cms/question-image", {
    method: "POST",
    headers: uploadAuthHeaders(),
    body: formData,
  });

  const data = parseUploadResponse(await res.text(), res.status);
  if (!res.ok) {
    throw new Error(data?.message || `Upload failed (${res.status})`);
  }

  return data;
}

const MAX_MC_OPTIONS = 6;
let mcQuizEditorInstance = 0;

function updateQuestionImagePreview(block, url, prefix = "cms-q") {
  const preview = block?.querySelector(`.${prefix}-image-preview`);
  const img = block?.querySelector(`.${prefix}-image-img`);
  const imageUrl = (url || "").trim();
  if (!preview || !img) return;

  if (imageUrl) {
    img.src = imageUrl;
    preview.hidden = false;
  } else {
    img.removeAttribute("src");
    preview.hidden = true;
  }
}

function renderQuestionImageFieldMarkup(image, { prefix = "cms-q", uploadLabel = "Upload PNG" } = {}) {
  const imageUrl = String(image || "").trim();
  return `
    <div class="${prefix}-image-field cms-q-image-field">
      <span class="cms-q-image-label">Question image (optional)</span>
      <div class="${prefix}-image-preview cms-q-image-preview"${imageUrl ? "" : " hidden"}>
        <button type="button" class="cms-q-image-preview-btn ${prefix}-image-preview-btn" aria-label="Preview question image">
          <img class="${prefix}-image-img cms-q-image-img" src="${escapeHtml(imageUrl)}" alt="" />
        </button>
        <button type="button" class="cms-icon-btn ${prefix}-image-remove cms-q-image-remove" aria-label="Remove image">×</button>
      </div>
      <div class="cms-q-image-actions">
        <label class="cms-thumbnail-upload btn secondary small">
          <input type="file" class="${prefix}-image-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
          ${escapeHtml(uploadLabel)}
        </label>
        <button type="button" class="btn secondary small ${prefix}-image-generate cms-q-image-generate" disabled title="Coming soon">
          Generate with AI <span class="cms-upcoming-badge">Upcoming</span>
        </button>
      </div>
      <input type="hidden" class="${prefix}-image-value" value="${escapeHtml(imageUrl)}" />
      <span class="hint ${prefix}-image-status cms-q-image-status"></span>
    </div>`;
}

function showUpcomingAiImageMessage(statusEl) {
  if (statusEl) statusEl.textContent = "AI image generation coming soon.";
}

async function uploadQuestionImageForBlock(block, file, prefix = "cms-q") {
  const statusEl = block?.querySelector(`.${prefix}-image-status`);
  const valueInput = block?.querySelector(`.${prefix}-image-value`);
  if (statusEl) statusEl.textContent = "Uploading…";
  try {
    const data = await uploadQuestionImageFile(file);
    const url = data?.url || "";
    if (valueInput) valueInput.value = url;
    updateQuestionImagePreview(block, url, prefix);
    if (statusEl) statusEl.textContent = "Image uploaded.";
    return url;
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message;
    throw err;
  }
}

function renderAiQuestionImageField(item) {
  return `${renderQuestionImageFieldMarkup(item?.image, {
    prefix: "cms-ai-q",
    uploadLabel: "Upload PNG",
  })}
      <button type="button" class="btn secondary small cms-ai-q-pick-asset">Choose from library</button>
      <p class="hint cms-ai-q-image-library-hint">Extracted images appear above after upload. Click this button, then click a thumbnail.</p>`;
}

function renderMcQuizBody(container, exercise) {
  const type = exercise.type || "mcquiz";
  const items = exercise.items?.length ? exercise.items : defaultExercise(type).items;
  const radioGroupPrefix = `correct-${++mcQuizEditorInstance}`;
  container.innerHTML = `<div class="cms-questions-list"></div>
    <button type="button" class="btn secondary small cms-add-question">+ Add question</button>`;

  const list = container.querySelector(".cms-questions-list");

  function syncQuestionFromDom(qIdx) {
    const block = list.querySelector(`.cms-question-block[data-q="${qIdx}"]`);
    if (!block || !items[qIdx]) return;

    items[qIdx].title = block.querySelector(".cms-q-text")?.value.trim() || "";
    items[qIdx].timeLimit = Number(block.querySelector(".cms-q-time")?.value) || 15;
    items[qIdx].image = block.querySelector(".cms-q-image-value")?.value.trim() || "";

    const options = [];
    block.querySelectorAll(".cms-option-row").forEach((row) => {
      const text = row.querySelector(".cms-opt-text")?.value.trim() || "";
      const isCorrect = row.querySelector('input[type="radio"]')?.checked || false;
      options.push({ text, isCorrect });
    });
    items[qIdx].options = options;
  }

  function renderQuestions() {
    list.innerHTML = items
      .map(
        (item, qIdx) => `<div class="cms-question-block" data-q="${qIdx}">
          <div class="cms-question-head">
            <span>Q${qIdx + 1}</span>
            <button type="button" class="cms-icon-btn cms-remove-question" data-q="${qIdx}">×</button>
          </div>
          <input type="text" class="cms-q-text" data-q="${qIdx}" value="${escapeHtml(item.title || "")}" placeholder="Question text" />
          ${renderQuestionImageFieldMarkup(item.image)}
          <div class="cms-options-list" data-q="${qIdx}">
            <div class="cms-options-head">
              <span aria-hidden="true"></span>
              <span class="cms-option-correct-label">Correct</span>
              <span>Answer option</span>
            </div>
            ${(item.options || [])
              .map(
                (opt, oIdx) => `<label class="cms-option-row">
                  <input type="radio" name="${radioGroupPrefix}-${qIdx}" data-q="${qIdx}" data-o="${oIdx}" ${opt.isCorrect ? "checked" : ""} aria-label="Mark option ${oIdx + 1} as correct" />
                  <input type="text" class="cms-opt-text" data-q="${qIdx}" data-o="${oIdx}" value="${escapeHtml(opt.text || "")}" placeholder="Option ${oIdx + 1}" />
                  ${(item.options || []).length > 2 ? `<button type="button" class="cms-icon-btn cms-remove-option" data-q="${qIdx}" data-o="${oIdx}" aria-label="Remove option">×</button>` : ""}
                </label>`
              )
              .join("")}
          </div>
          <button type="button" class="btn secondary small cms-add-option" data-q="${qIdx}"${(item.options || []).length >= MAX_MC_OPTIONS ? " disabled" : ""}>+ Add option</button>
          <label class="field cms-field-inline">
            <span>Time (sec)</span>
            <input type="number" class="cms-q-time" data-q="${qIdx}" min="5" max="60" value="${item.timeLimit || 15}" />
          </label>
        </div>`
      )
      .join("");

    list.querySelectorAll(".cms-remove-question").forEach((btn) => {
      btn.addEventListener("click", () => {
        items.splice(Number(btn.dataset.q), 1);
        renderQuestions();
      });
    });

    list.querySelectorAll(".cms-add-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qIdx = Number(btn.dataset.q);
        syncQuestionFromDom(qIdx);
        const options = items[qIdx]?.options || [];
        if (options.length >= MAX_MC_OPTIONS) return;
        options.push({ text: "", isCorrect: false });
        items[qIdx].options = options;
        renderQuestions();
      });
    });

    list.querySelectorAll(".cms-remove-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qIdx = Number(btn.dataset.q);
        syncQuestionFromDom(qIdx);
        const options = items[qIdx]?.options || [];
        if (options.length <= 2) return;
        options.splice(Number(btn.dataset.o), 1);
        if (!options.some((o) => o.isCorrect) && options.length) options[0].isCorrect = true;
        items[qIdx].options = options;
        renderQuestions();
      });
    });

    list.querySelectorAll(".cms-q-image-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const block = btn.closest(".cms-question-block");
        const qIdx = Number(block?.dataset.q);
        const valueInput = block?.querySelector(".cms-q-image-value");
        if (valueInput) valueInput.value = "";
        updateQuestionImagePreview(block, "");
        if (items[qIdx]) items[qIdx].image = "";
      });
    });

    list.querySelectorAll(".cms-q-image-preview-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openQuestionImagePreview(btn.closest(".cms-question-block"), "cms-q");
      });
    });

    list.querySelectorAll(".cms-q-image-file").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;

        const block = input.closest(".cms-question-block");
        const qIdx = Number(block?.dataset.q);
        try {
          const url = await uploadQuestionImageForBlock(block, file);
          if (items[qIdx]) items[qIdx].image = url;
        } catch {
          /* status shown on block */
        }
      });
    });

    list.querySelectorAll(".cms-q-image-generate").forEach((btn) => {
      btn.addEventListener("click", () => {
        const block = btn.closest(".cms-question-block");
        showUpcomingAiImageMessage(block?.querySelector(".cms-q-image-status"));
      });
    });

    list.querySelectorAll(".cms-q-time").forEach((input) => {
      input.addEventListener("input", () => {
        updateExercisesViewDurationEstimate();
      });
    });

    updateExercisesViewDurationEstimate();
  }

  renderQuestions();

  container.querySelector(".cms-add-question").addEventListener("click", () => {
    items.push({
      title: "",
      image: "",
      options: [
        { text: "", isCorrect: true },
        { text: "", isCorrect: false },
      ],
      timeLimit: 15,
    });
    renderQuestions();
    updateExercisesViewDurationEstimate();
  });

  container._collectItems = () =>
    items.map((item, qIdx) => {
      const block = list.querySelector(`.cms-question-block[data-q="${qIdx}"]`);
      const title = block?.querySelector(".cms-q-text")?.value.trim() || "";
      const image = block?.querySelector(".cms-q-image-value")?.value.trim() || "";
      const timeLimit = Number(block?.querySelector(".cms-q-time")?.value) || 15;
      const options = [];
      block?.querySelectorAll(".cms-option-row").forEach((row) => {
        const text = row.querySelector(".cms-opt-text")?.value.trim() || "";
        const isCorrect = row.querySelector('input[type="radio"]')?.checked || false;
        if (text) options.push({ text, isCorrect });
      });
      return {
        title,
        image: image || null,
        options: ensureSingleCorrectOption(options),
        timeLimit,
      };
    });
}

function cmsVideoPreviewMarkup(url = "") {
  const trimmed = String(url || "").trim();
  return `
    <div class="cms-video-preview-wrap"${trimmed ? "" : " hidden"}>
      <p class="cms-video-preview-label">Preview</p>
      <video class="cms-video-preview" controls playsinline preload="metadata"${
        trimmed ? ` src="${escapeHtml(trimmed)}"` : ""
      }></video>
    </div>`;
}

function syncCmsVideoPreview(wrap, url) {
  if (!wrap) return;
  const trimmed = String(url || "").trim();
  const video = wrap.querySelector(".cms-video-preview");
  if (!trimmed) {
    wrap.hidden = true;
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
    return;
  }
  wrap.hidden = false;
  if (video && video.getAttribute("src") !== trimmed) {
    video.src = trimmed;
    video.load();
  }
}

function wireCmsVideoPreview(root, urlInput) {
  const wrap = root?.querySelector(".cms-video-preview-wrap");
  if (!root || !urlInput || !wrap) return;
  const update = () => syncCmsVideoPreview(wrap, urlInput.value);
  urlInput.addEventListener("input", update);
  urlInput.addEventListener("change", update);
  update();
}

function wireAiVideoPreviews() {
  $("#cms-ai-preview")?.querySelectorAll('.cms-ai-edit-card[data-type="video"]').forEach((card) => {
    wireCmsVideoPreview(card, card.querySelector(".cms-ai-video-url"));
  });
}

async function pollVideoGenerationJob(jobId, { onUpdate } = {}) {
  const started = Date.now();
  const timeoutMs = 20 * 60 * 1000;
  const pollMs = 3000;

  while (Date.now() - started < timeoutMs) {
    const data = await api(`/api/cms/video-jobs/${encodeURIComponent(jobId)}`);
    if (typeof onUpdate === "function") onUpdate(data);

    const status = String(data.status || "").toLowerCase();
    if (status === "completed") {
      if (!data.videoUrl) {
        throw new Error("Job completed but no video URL was returned.");
      }
      return data;
    }
    if (status === "failed" || status === "cancelled" || status === "error") {
      throw new Error(data.error || `Video generation ${status}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Video generation timed out. Try again or check the API server.");
}

function renderVideoBody(container, exercise) {
  const item = exercise.items?.[0] || {};
  const url = item.videoUrl || "";
  const tracks =
    typeof captionTracksFromExercise === "function"
      ? captionTracksFromExercise({ type: "video", items: [item] })
      : [];
  const primary = tracks[0] || null;
  const captionUrl = primary?.url || item.captionUrl || item.subtitleUrl || "";
  const captionLanguage = primary?.language || item.captionLanguage || "en";
  const trackSummary = tracks.length
    ? tracks.map((track) => `${track.label}: ${track.url}`).join("\n")
    : "";

  container.innerHTML = `<div class="cms-video-gen-tools">
    <label class="field">
      <span>Generate video (AI)</span>
      <textarea class="cms-video-gen-script" rows="4" placeholder="Paste lesson script or dialogue…"></textarea>
    </label>
    <div class="cms-video-gen-actions">
      <button type="button" class="btn secondary small cms-generate-video">Generate video</button>
      <p class="hint cms-video-gen-status">Calls the video API (POST /api/video), then polls until an MP4 URL is ready.</p>
    </div>
    <pre class="cms-video-gen-log" hidden aria-live="polite"></pre>
  </div>
  <label class="field">
    <span>Video URL</span>
    <input type="url" class="cms-video-url" value="${escapeHtml(url)}" placeholder="https://..." />
  </label>
  ${cmsVideoPreviewMarkup(url)}
  <label class="field">
    <span>字幕 / Caption URL (WebVTT)</span>
    <input type="url" class="cms-video-caption-url" value="${escapeHtml(captionUrl)}" placeholder="https://.../captions.vtt" />
  </label>
  <input type="hidden" class="cms-video-caption-tracks" value="${escapeHtml(JSON.stringify(tracks.map((t) => ({ language: t.language, url: t.url }))))}" />
  <input type="hidden" class="cms-video-caption-language" value="${escapeHtml(captionLanguage)}" />
  <div class="cms-video-caption-tools">
    <label class="field cms-field-inline">
      <span>Caption language</span>
      <select class="cms-video-caption-target-language" aria-label="Caption language">
        <option value="en">English (en)</option>
        <option value="zh">Chinese (zh)</option>
        <option value="yue">Cantonese (yue)</option>
        <option value="ja">Japanese (ja)</option>
        <option value="ko">Korean (ko)</option>
      </select>
    </label>
    <button type="button" class="btn secondary small cms-upload-captions">Upload 字幕 (.vtt)</button>
    <input type="file" class="cms-video-caption-file" accept=".vtt,text/vtt,text/plain" hidden />
    <button type="button" class="btn secondary small cms-generate-captions">Generate 字幕 (STT)</button>
    <button type="button" class="btn secondary small cms-translate-captions">Translate 字幕 (LLM)</button>
    <p class="hint cms-caption-status">${
      tracks.length
        ? `Saved languages: ${tracks.map((t) => t.label).join(", ")}. Upload/generate/translate into another language, then Save Course.`
        : "Upload a .vtt file, generate STT captions, or translate an existing caption for the player language menu."
    }</p>
    ${trackSummary ? `<pre class="hint cms-caption-track-list">${escapeHtml(trackSummary)}</pre>` : ""}
  </div>
  <div class="cms-caption-editor"${tracks.length ? "" : " hidden"}>
    <div class="cms-caption-editor-head">
      <label class="field cms-field-inline">
        <span>Check / edit captions</span>
        <select class="cms-caption-edit-language" aria-label="Caption track to edit"></select>
      </label>
      <button type="button" class="btn secondary small cms-caption-reload">Reload</button>
      <button type="button" class="btn primary small cms-caption-save">Save VTT</button>
    </div>
    <textarea class="cms-caption-vtt-editor" rows="14" spellcheck="false" placeholder="WEBVTT&#10;&#10;00:00:00.000 --> 00:00:02.000&#10;Hello"></textarea>
    <p class="hint cms-caption-editor-status">Load a saved caption track to review or edit the WebVTT text.</p>
  </div>`;

  const languageSelect = container.querySelector(".cms-video-caption-target-language");
  if (languageSelect) languageSelect.value = captionLanguage;

  const readTracks = () => {
    try {
      const raw = container.querySelector(".cms-video-caption-tracks")?.value || "[]";
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeTracks = (nextTracks, activeLanguage) => {
    const normalized = [];
    const seen = new Set();
    for (const track of nextTracks || []) {
      const language = String(track.language || "en").trim().toLowerCase();
      const trackUrl = String(track.url || "").trim();
      if (!language || !trackUrl || seen.has(language)) continue;
      seen.add(language);
      normalized.push({ language, url: trackUrl });
    }
    container.querySelector(".cms-video-caption-tracks").value = JSON.stringify(normalized);
    const active =
      normalized.find((track) => track.language === activeLanguage) || normalized[0] || null;
    const captionInput = container.querySelector(".cms-video-caption-url");
    const languageInput = container.querySelector(".cms-video-caption-language");
    if (captionInput) captionInput.value = active?.url || "";
    if (languageInput) languageInput.value = active?.language || activeLanguage || "en";
    const status = container.querySelector(".cms-caption-status");
    if (status && normalized.length) {
      status.textContent = `Saved languages: ${normalized
        .map((track) =>
          typeof captionLanguageMeta === "function"
            ? captionLanguageMeta(track.language).label
            : track.language.toUpperCase()
        )
        .join(", ")}. Upload/generate/translate into another language, then Save Course.`;
    }
    refreshCaptionEditorTracks(activeLanguage);
  };

  const captionEditor = container.querySelector(".cms-caption-editor");
  const captionEditLanguage = container.querySelector(".cms-caption-edit-language");
  const captionVttEditor = container.querySelector(".cms-caption-vtt-editor");
  const captionEditorStatus = container.querySelector(".cms-caption-editor-status");
  let captionEditorDirty = false;
  let captionEditorLoadedUrl = "";

  const captionTrackLabel = (language) =>
    typeof captionLanguageMeta === "function"
      ? captionLanguageMeta(language).label
      : String(language || "en").toUpperCase();

  const selectedCaptionEditTrack = () => {
    const language = captionEditLanguage?.value || "";
    return readTracks().find((track) => track.language === language) || readTracks()[0] || null;
  };

  const setCaptionEditorDirty = (dirty) => {
    captionEditorDirty = Boolean(dirty);
    const saveBtn = container.querySelector(".cms-caption-save");
    if (saveBtn) saveBtn.disabled = !captionEditorDirty;
  };

  function refreshCaptionEditorTracks(preferredLanguage) {
    const tracks = readTracks();
    if (!captionEditor || !captionEditLanguage) return;

    captionEditor.hidden = !tracks.length;
    if (!tracks.length) {
      if (captionVttEditor) captionVttEditor.value = "";
      captionEditorLoadedUrl = "";
      setCaptionEditorDirty(false);
      if (captionEditorStatus) {
        captionEditorStatus.textContent = "Load a saved caption track to review or edit the WebVTT text.";
      }
      return;
    }

    const previous = captionEditLanguage.value;
    captionEditLanguage.innerHTML = tracks
      .map(
        (track) =>
          `<option value="${escapeHtml(track.language)}">${escapeHtml(captionTrackLabel(track.language))}</option>`
      )
      .join("");

    const nextLanguage =
      tracks.find((track) => track.language === preferredLanguage)?.language ||
      tracks.find((track) => track.language === previous)?.language ||
      tracks[0].language;
    captionEditLanguage.value = nextLanguage;

    if (previous !== nextLanguage || !captionEditorLoadedUrl) {
      void loadCaptionEditorTrack();
    }
  }

  async function loadCaptionEditorTrack() {
    const track = selectedCaptionEditTrack();
    if (!track?.url || !captionVttEditor) return;

    const reloadBtn = container.querySelector(".cms-caption-reload");
    if (reloadBtn) reloadBtn.disabled = true;
    if (captionEditorStatus) captionEditorStatus.textContent = `Loading ${captionTrackLabel(track.language)}…`;

    try {
      const data = await api(
        `/api/cms/video-captions?captionUrl=${encodeURIComponent(track.url)}`
      );
      captionVttEditor.value = data.text || "";
      captionEditorLoadedUrl = track.url;
      setCaptionEditorDirty(false);
      if (captionEditorStatus) {
        const editableNote = data.editable
          ? "Edit the WebVTT below, then Save VTT."
          : "This file is read-only here (external URL). Download, edit locally, then re-upload.";
        captionEditorStatus.textContent = `${captionTrackLabel(track.language)}: ${data.cueCount || 0} cues. ${editableNote}`;
      }
      const saveBtn = container.querySelector(".cms-caption-save");
      if (saveBtn) saveBtn.disabled = !data.editable;
    } catch (err) {
      captionVttEditor.value = "";
      captionEditorLoadedUrl = "";
      setCaptionEditorDirty(false);
      if (captionEditorStatus) captionEditorStatus.textContent = err.message || "Could not load captions.";
    } finally {
      if (reloadBtn) reloadBtn.disabled = false;
    }
  }

  async function saveCaptionEditorTrack() {
    const track = selectedCaptionEditTrack();
    if (!track?.url || !captionVttEditor) return;

    const saveBtn = container.querySelector(".cms-caption-save");
    if (saveBtn) saveBtn.disabled = true;
    if (captionEditorStatus) {
      captionEditorStatus.textContent = `Saving ${captionTrackLabel(track.language)}…`;
    }

    try {
      const data = await api("/api/cms/video-captions", {
        method: "PUT",
        body: { captionUrl: track.url, text: captionVttEditor.value },
      });
      captionEditorLoadedUrl = track.url;
      setCaptionEditorDirty(false);
      if (captionEditorStatus) {
        captionEditorStatus.textContent = `Saved ${captionTrackLabel(track.language)} (${data.cueCount || 0} cues). Changes apply immediately on replay.`;
      }
    } catch (err) {
      if (captionEditorStatus) captionEditorStatus.textContent = err.message || "Could not save captions.";
      setCaptionEditorDirty(true);
    } finally {
      if (saveBtn && captionEditorDirty) saveBtn.disabled = false;
    }
  }

  captionEditLanguage?.addEventListener("change", () => {
    if (captionEditorDirty) {
      const ok = confirm("You have unsaved caption edits. Switch language anyway?");
      if (!ok) {
        const track = readTracks().find((entry) => entry.url === captionEditorLoadedUrl);
        if (track) captionEditLanguage.value = track.language;
        return;
      }
    }
    void loadCaptionEditorTrack();
  });

  captionVttEditor?.addEventListener("input", () => {
    setCaptionEditorDirty(true);
  });

  container.querySelector(".cms-caption-reload")?.addEventListener("click", () => {
    if (captionEditorDirty) {
      const ok = confirm("Discard unsaved caption edits and reload?");
      if (!ok) return;
    }
    void loadCaptionEditorTrack();
  });

  container.querySelector(".cms-caption-save")?.addEventListener("click", () => {
    void saveCaptionEditorTrack();
  });

  refreshCaptionEditorTracks(captionLanguage);

  const videoGenLog = container.querySelector(".cms-video-gen-log");
  const videoGenStatus = container.querySelector(".cms-video-gen-status");
  const videoUrlInput = container.querySelector(".cms-video-url");
  wireCmsVideoPreview(container, videoUrlInput);

  const renderVideoGenLog = (logs) => {
    if (!videoGenLog) return;
    const lines = Array.isArray(logs) ? logs.filter(Boolean) : [];
    if (!lines.length) {
      videoGenLog.hidden = true;
      videoGenLog.textContent = "";
      return;
    }
    videoGenLog.hidden = false;
    videoGenLog.textContent = lines.join("\n");
    videoGenLog.scrollTop = videoGenLog.scrollHeight;
  };

  container.querySelector(".cms-generate-video")?.addEventListener("click", async () => {
    const button = container.querySelector(".cms-generate-video");
    const script = container.querySelector(".cms-video-gen-script")?.value.trim() || "";
    if (!script) {
      if (videoGenStatus) videoGenStatus.textContent = "Paste a script first.";
      return;
    }

    if (button) button.disabled = true;
    if (videoGenStatus) videoGenStatus.textContent = "Starting video job…";
    renderVideoGenLog(["Queued."]);

    try {
      const started = await api("/api/cms/generate-video", {
        method: "POST",
        body: { text: script },
      });
      if (videoGenStatus) {
        videoGenStatus.textContent = `Job ${started.jobId} started. Generating… this can take a few minutes.`;
      }

      const finished = await pollVideoGenerationJob(started.jobId, {
        onUpdate: (data) => {
          renderVideoGenLog(data.logs);
          if (videoGenStatus && data.status) {
            videoGenStatus.textContent = `Status: ${data.status}${
              data.segmentsDone && data.segmentCount
                ? ` (${data.segmentsDone}/${data.segmentCount})`
                : ""
            }`;
          }
        },
      });

      if (finished.videoUrl && videoUrlInput) {
        videoUrlInput.value = finished.videoUrl;
        videoUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (videoGenStatus) {
        videoGenStatus.textContent = finished.videoUrl
          ? "Video ready. URL filled in below — click Save Course."
          : "Video job completed, but no URL was returned.";
      }
    } catch (err) {
      if (videoGenStatus) videoGenStatus.textContent = err.message;
    } finally {
      if (button) button.disabled = false;
    }
  });

  const captionFileInput = container.querySelector(".cms-video-caption-file");
  container.querySelector(".cms-upload-captions")?.addEventListener("click", () => {
    captionFileInput?.click();
  });

  captionFileInput?.addEventListener("change", async () => {
    const file = captionFileInput.files?.[0];
    const status = container.querySelector(".cms-caption-status");
    const button = container.querySelector(".cms-upload-captions");
    const language = container.querySelector(".cms-video-caption-target-language")?.value || "en";
    captionFileInput.value = "";

    if (!file) return;

    if (button) button.disabled = true;
    if (status) status.textContent = `Uploading ${file.name}…`;

    try {
      const formData = new FormData();
      formData.append("caption", file);
      formData.append("language", language);

      const res = await fetch("/api/cms/upload-video-captions", {
        method: "POST",
        headers: uploadAuthHeaders(),
        body: formData,
      });
      const data = parseUploadResponse(await res.text(), res.status);
      if (!res.ok) {
        throw new Error(data?.message || `Upload failed (${res.status})`);
      }

      if (data.captionUrl) {
        const next = readTracks().filter((track) => track.language !== language);
        next.push({ language, url: data.captionUrl });
        writeTracks(next, language);
        captionEditLanguage.value = language;
        void loadCaptionEditorTrack();
      }
      if (status) {
        status.textContent = `Uploaded ${data.cueCount || 0} ${language.toUpperCase()} cues. Click Save Course, then reopen the video.`;
      }
    } catch (err) {
      if (status) status.textContent = err.message || "Caption upload failed.";
    } finally {
      if (button) button.disabled = false;
    }
  });

  container.querySelector(".cms-generate-captions")?.addEventListener("click", async () => {
    const videoUrl = container.querySelector(".cms-video-url")?.value.trim() || "";
    const status = container.querySelector(".cms-caption-status");
    const button = container.querySelector(".cms-generate-captions");
    const language = container.querySelector(".cms-video-caption-target-language")?.value || "en";

    if (!videoUrl) {
      if (status) status.textContent = "Add a video URL first.";
      return;
    }

    if (button) button.disabled = true;
    if (status) status.textContent = "Generating captions… this can take a minute for longer videos.";

    try {
      const data = await api("/api/cms/generate-video-captions", {
        method: "POST",
        body: { videoUrl, language },
      });
      if (data.captionUrl) {
        const next = readTracks().filter((track) => track.language !== language);
        next.push({ language, url: data.captionUrl });
        writeTracks(next, language);
        captionEditLanguage.value = language;
        void loadCaptionEditorTrack();
      }
      if (status) {
        status.textContent = `Generated ${data.cueCount || 0} ${language.toUpperCase()} cues. Click Save Course, then reopen the video.`;
      }
    } catch (err) {
      if (status) status.textContent = err.message || "Caption generation failed.";
    } finally {
      if (button) button.disabled = false;
    }
  });

  container.querySelector(".cms-translate-captions")?.addEventListener("click", async () => {
    const status = container.querySelector(".cms-caption-status");
    const button = container.querySelector(".cms-translate-captions");
    const targetLanguage =
      container.querySelector(".cms-video-caption-target-language")?.value || "zh";
    const sourceUrl =
      container.querySelector(".cms-video-caption-url")?.value.trim() ||
      readTracks()[0]?.url ||
      "";

    if (!sourceUrl) {
      if (status) status.textContent = "Generate or paste a source caption URL first.";
      return;
    }

    if (button) button.disabled = true;
    if (status) status.textContent = `Translating captions to ${targetLanguage.toUpperCase()}…`;

    try {
      const data = await api("/api/cms/translate-video-captions", {
        method: "POST",
        body: { captionUrl: sourceUrl, targetLanguage },
      });
      if (data.captionUrl) {
        const next = readTracks().filter((track) => track.language !== targetLanguage);
        next.push({ language: targetLanguage, url: data.captionUrl });
        writeTracks(next, targetLanguage);
        captionEditLanguage.value = targetLanguage;
        void loadCaptionEditorTrack();
      }
      if (status) {
        status.textContent = `Translated to ${targetLanguage.toUpperCase()}. Click Save Course, then use the language menu on the video page.`;
      }
    } catch (err) {
      if (status) status.textContent = err.message || "Caption translation failed.";
    } finally {
      if (button) button.disabled = false;
    }
  });

  container._collectItems = () => {
    const videoUrl = container.querySelector(".cms-video-url")?.value.trim() || "";
    if (!videoUrl) return [];
    const tracksValue = readTracks();
    const captionUrl = container.querySelector(".cms-video-caption-url")?.value.trim() || "";
    const captionLanguage =
      container.querySelector(".cms-video-caption-language")?.value.trim() ||
      tracksValue[0]?.language ||
      "en";
    if (captionUrl && !tracksValue.some((track) => track.url === captionUrl)) {
      tracksValue.unshift({ language: captionLanguage, url: captionUrl });
    }
    const primary =
      tracksValue.find((track) => track.language === captionLanguage) || tracksValue[0] || null;
    return [
      {
        videoUrl,
        ...(primary ? { captionUrl: primary.url, captionLanguage: primary.language } : {}),
        ...(tracksValue.length ? { captionTracks: tracksValue } : {}),
      },
    ];
  };
}

const MAX_BUZZIN_TOPICS = 15;

function buzzinSttLanguageOptionsHtml(selected = "") {
  const value = String(selected || "").trim().toLowerCase();
  return `
    <option value=""${value ? "" : " selected"}>Server default</option>
    <option value="en"${value === "en" ? " selected" : ""}>English (en)</option>
    <option value="yue"${value === "yue" ? " selected" : ""}>Cantonese (yue)</option>
    <option value="zh"${value === "zh" ? " selected" : ""}>Chinese (zh)</option>
    <option value="ja"${value === "ja" ? " selected" : ""}>Japanese (ja)</option>
    <option value="ko"${value === "ko" ? " selected" : ""}>Korean (ko)</option>
  `;
}

function renderBuzzinBody(container, exercise) {
  const items = (exercise.items?.length ? exercise.items : defaultExercise("buzzin").items).map(
    (item) => ({
      topic: String(item.topic || item.title || "").trim(),
      correctAnswer: String(item.correctAnswer || item.answer || "").trim(),
      sttLanguage: String(item.sttLanguage || "").trim().toLowerCase(),
      image: String(item.image || item.imageUrl || "").trim(),
    })
  );
  if (!items.length) items.push({ topic: "", correctAnswer: "", sttLanguage: "", image: "" });

  container.innerHTML = `<div class="cms-questions-list cms-buzzin-topics-list"></div>
    <button type="button" class="btn secondary small cms-add-buzzin-topic">+ Add question</button>
    <p class="hint">Each question needs a topic and correct answer. AI uses the correct answer to judge Correctness.</p>`;

  const list = container.querySelector(".cms-buzzin-topics-list");

  function syncFromDom() {
    list.querySelectorAll(".cms-buzzin-topic-block").forEach((block, idx) => {
      if (!items[idx]) return;
      items[idx].topic = block.querySelector(".cms-buzzin-topic")?.value.trim() || "";
      items[idx].correctAnswer =
        block.querySelector(".cms-buzzin-correct-answer")?.value.trim() || "";
      items[idx].sttLanguage =
        block.querySelector(".cms-buzzin-stt-language")?.value.trim().toLowerCase() || "";
      items[idx].image = block.querySelector(".cms-q-image-value")?.value.trim() || "";
    });
  }

  function renderTopics() {
    list.innerHTML = items
      .map(
        (item, qIdx) => `<div class="cms-question-block cms-buzzin-topic-block" data-q="${qIdx}">
          <div class="cms-question-head">
            <span>Q${qIdx + 1}</span>
            <button type="button" class="cms-icon-btn cms-remove-buzzin-topic" data-q="${qIdx}"${
              items.length <= 1 ? " disabled" : ""
            }>×</button>
          </div>
          <label class="field">
            <span>Topic</span>
            <input type="text" class="cms-buzzin-topic" data-q="${qIdx}" value="${escapeHtml(
              item.topic || ""
            )}" placeholder="What should students discuss?" />
          </label>
          ${renderQuestionImageFieldMarkup(item.image)}
          <label class="field">
            <span>Correct answer</span>
            <input type="text" class="cms-buzzin-correct-answer" data-q="${qIdx}" value="${escapeHtml(
              item.correctAnswer || ""
            )}" placeholder="Expected answer for AI Correctness scoring" />
          </label>
          <label class="field">
            <span>Speech language</span>
            <select class="cms-buzzin-stt-language" data-q="${qIdx}">
              ${buzzinSttLanguageOptionsHtml(item.sttLanguage)}
            </select>
          </label>
        </div>`
      )
      .join("");

    list.querySelectorAll(".cms-remove-buzzin-topic").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qIdx = Number(btn.dataset.q);
        syncFromDom();
        if (items.length <= 1) return;
        items.splice(qIdx, 1);
        renderTopics();
      });
    });

    list.querySelectorAll(".cms-q-image-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const block = btn.closest(".cms-buzzin-topic-block");
        const qIdx = Number(block?.dataset.q);
        const valueInput = block?.querySelector(".cms-q-image-value");
        if (valueInput) valueInput.value = "";
        updateQuestionImagePreview(block, "");
        if (items[qIdx]) items[qIdx].image = "";
      });
    });

    list.querySelectorAll(".cms-q-image-preview-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openQuestionImagePreview(btn.closest(".cms-buzzin-topic-block"), "cms-q");
      });
    });

    list.querySelectorAll(".cms-q-image-file").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        const block = input.closest(".cms-buzzin-topic-block");
        const qIdx = Number(block?.dataset.q);
        try {
          const url = await uploadQuestionImageForBlock(block, file);
          if (items[qIdx]) items[qIdx].image = url;
        } catch {
          /* status shown on block */
        }
      });
    });

    list.querySelectorAll(".cms-q-image-generate").forEach((btn) => {
      btn.addEventListener("click", () => {
        const block = btn.closest(".cms-buzzin-topic-block");
        showUpcomingAiImageMessage(block?.querySelector(".cms-q-image-status"));
      });
    });
  }

  container.querySelector(".cms-add-buzzin-topic")?.addEventListener("click", () => {
    syncFromDom();
    if (items.length >= MAX_BUZZIN_TOPICS) return;
    items.push({
      topic: "",
      correctAnswer: "",
      sttLanguage: items[items.length - 1]?.sttLanguage || "",
      image: "",
    });
    renderTopics();
  });

  container._collectItems = () => {
    syncFromDom();
    return items
      .map((item) => {
        const topic = String(item.topic || "").trim();
        const correctAnswer = String(item.correctAnswer || "").trim();
        const sttLanguage = String(item.sttLanguage || "").trim().toLowerCase();
        if (!topic) return null;
        return {
          topic,
          ...(correctAnswer ? { correctAnswer } : {}),
          ...(sttLanguage ? { sttLanguage } : {}),
          ...(item.image ? { image: item.image } : {}),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_BUZZIN_TOPICS);
  };

  renderTopics();
}

function renderExerciseBody(card, exercise) {
  const body = card.querySelector(".cms-exercise-body");
  const type = exercise.type || "mcquiz";
  card.dataset.type = type;

  if (type === "video") renderVideoBody(body, exercise);
  else if (type === "buzzin") renderBuzzinBody(body, exercise);
  else if (type === "fastmcquiz" || type === "mcquiz") renderMcQuizBody(body, exercise);
  else renderMcQuizBody(body, exercise);
}

function applyExerciseTypeChange(card, newType) {
  syncExercisesFromDom();

  const sectionIndex = state.editingSectionIndex;
  if (sectionIndex == null) return;

  const exerciseIdRaw = card.dataset.exerciseId;
  const exerciseIndex = Number(card.dataset.exerciseIndex);
  const exercises = state.sections[sectionIndex]?.exercises || [];
  const exercise =
    exerciseIdRaw != null
      ? exercises.find((entry) => String(entry.id) === exerciseIdRaw)
      : exercises[exerciseIndex];
  if (!exercise) return;

  const oldType = exercise.type || "mcquiz";
  exercise.type = newType;
  exercise.subTitle = exerciseSubTitleForType(newType);

  const wasMc = isLiveMcQuizExercise({ type: oldType });
  const isMc = isLiveMcQuizExercise({ type: newType });
  if (isMc && !wasMc) {
    exercise.items = defaultExercise(newType).items;
  } else if (newType === "video" && oldType !== "video") {
    exercise.items = defaultExercise("video").items;
  } else if (newType === "buzzin" && oldType !== "buzzin") {
    exercise.items = defaultExercise("buzzin").items;
  }

  card.dataset.type = newType;
  const subTitleInput = card.querySelector('[data-field="subTitle"]');
  if (subTitleInput) subTitleInput.value = exercise.subTitle;
  const chip = card.querySelector(".cms-type-chip");
  if (chip) chip.textContent = exerciseTypeShortLabel(newType);
  renderExerciseBody(card, exercise);

  const previewLink = card.querySelector(".cms-exercise-preview");
  if (previewLink) {
    previewLink.href = joinPreviewUrl(joinPreviewLayoutForExercise(exercise));
  }
}

function setExerciseExpanded(card, open) {
  const container = card.closest("#cms-exercise-list");
  if (open && container) {
    container.querySelectorAll(".cms-exercise-card.is-open").forEach((other) => {
      if (other !== card) setExerciseExpanded(other, false);
    });
  }

  card.classList.toggle("is-open", open);
  const editor = card.querySelector(".cms-exercise-editor");
  const toggle = card.querySelector(".cms-exercise-toggle");
  if (editor) editor.hidden = !open;
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Done" : "Edit";
  }

  if (open) {
    const nextIndex = Number(card.dataset.exerciseIndex);
    if (state.exerciseAgentCardIndex !== nextIndex) resetExerciseAgent();
    state.expandedExerciseIndex = nextIndex;
    state.exerciseAgentCardIndex = nextIndex;
    syncExerciseAgentPanel(true, card);
  } else if (Number(card.dataset.exerciseIndex) === state.expandedExerciseIndex) {
    state.expandedExerciseIndex = null;
    syncExerciseAgentPanel(false);
  }
}

function refreshExerciseRowChrome(container) {
  const cards = container.querySelectorAll(".cms-exercise-card");
  cards.forEach((card, index) => {
    card.dataset.exerciseIndex = String(index);
    const indexEl = card.querySelector(".cms-playlist-index");
    if (indexEl) indexEl.textContent = String(index + 1);
    const up = card.querySelector(".cms-move-up");
    const down = card.querySelector(".cms-move-down");
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === cards.length - 1;
  });
  const open = container.querySelector(".cms-exercise-card.is-open");
  state.expandedExerciseIndex = open ? Number(open.dataset.exerciseIndex) : null;
}

function updateExercisesViewDurationEstimate() {
  const el = $("#cms-exercises-section-duration");
  if (!el || state.editingSectionIndex == null) return;
  const container = $("#cms-exercise-list");
  const exercises = container?.querySelector(".cms-exercise-card")
    ? [...container.querySelectorAll(".cms-exercise-card")].map((card) => collectExerciseFromCard(card))
    : state.sections[state.editingSectionIndex]?.exercises || [];
  if (!exercises.length) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const seconds = estimateSectionDurationSeconds(exercises);
  el.hidden = false;
  el.textContent = `Estimated class time for this section: ${formatSectionDuration(seconds)}`;
}

function fillSectionOutline(sectionCard, section) {
  const outline = sectionCard.querySelector(".cms-section-outline");
  const countEl = sectionCard.querySelector(".cms-section-exercise-count");
  const durationEl = sectionCard.querySelector(".cms-section-duration-estimate");
  const exercises = section.exercises || [];
  if (countEl) {
    countEl.textContent = exercises.length
      ? `${exercises.length} exercise${exercises.length === 1 ? "" : "s"}`
      : "No exercises";
  }
  if (durationEl) {
    if (exercises.length) {
      durationEl.hidden = false;
      durationEl.textContent = `Est. ${formatSectionDuration(estimateSectionDurationSeconds(exercises))}`;
    } else {
      durationEl.hidden = true;
      durationEl.textContent = "";
    }
  }
  if (!outline) return;

  outline.replaceChildren();
  const max = 6;
  exercises.slice(0, max).forEach((exercise) => {
    const chip = document.createElement("span");
    chip.className = "cms-type-chip cms-type-chip--ghost";
    chip.textContent = exerciseTypeShortLabel(exercise.type);
    outline.appendChild(chip);
  });
  if (exercises.length > max) {
    const more = document.createElement("span");
    more.className = "cms-type-chip cms-type-chip--ghost";
    more.textContent = `+${exercises.length - max}`;
    outline.appendChild(more);
  }
}

function renderExerciseCard(exercise, sectionIndex, exerciseIndex, exercisesContainer) {
  const tpl = document.getElementById("tpl-exercise-editor");
  const card = tpl.content.firstElementChild.cloneNode(true);
  card.dataset.sectionIndex = String(sectionIndex);
  card.dataset.exerciseIndex = String(exerciseIndex);
  card.dataset.type = exercise.type || "mcquiz";
  if (exercise.id != null) card.dataset.exerciseId = String(exercise.id);

  const indexEl = card.querySelector(".cms-playlist-index");
  if (indexEl) indexEl.textContent = String(exerciseIndex + 1);
  const chip = card.querySelector(".cms-type-chip");
  if (chip) chip.textContent = exerciseTypeShortLabel(exercise.type);

  card.querySelector('[data-field="title"]').value = exercise.title || "";
  card.querySelector(".cms-exercise-order").value = String(exercise.order ?? exerciseIndex + 1);
  card.querySelector('[data-field="subTitle"]').value = exercise.subTitle || exerciseSubTitleForType(exercise.type);
  const typeSelect = card.querySelector(".cms-exercise-type-select");
  if (typeSelect) {
    typeSelect.value = exercise.type || "mcquiz";
    typeSelect.addEventListener("change", () => {
      applyExerciseTypeChange(card, typeSelect.value);
    });
  }

  renderExerciseBody(card, exercise);

  const previewLink = card.querySelector(".cms-exercise-preview");
  if (previewLink) {
    previewLink.href = joinPreviewUrl(joinPreviewLayoutForExercise(exercise));
  }

  const shouldOpen = state.expandedExerciseIndex === exerciseIndex;

  card.querySelector(".cms-exercise-toggle")?.addEventListener("click", () => {
    setExerciseExpanded(card, !card.classList.contains("is-open"));
  });

  card.querySelector(".cms-move-up")?.addEventListener("click", () => {
    moveExercise(Number(card.dataset.exerciseIndex), -1);
  });
  card.querySelector(".cms-move-down")?.addEventListener("click", () => {
    moveExercise(Number(card.dataset.exerciseIndex), 1);
  });

  card.querySelector(".cms-remove-exercise").addEventListener("click", () => {
    const exerciseId = card.dataset.exerciseId;
    syncExercisesFromDom();
    const exercises = state.sections[sectionIndex]?.exercises || [];
    let removeIndex =
      exerciseId != null ? exercises.findIndex((ex) => String(ex.id) === exerciseId) : exerciseIndex;
    if (removeIndex >= 0) exercises.splice(removeIndex, 1);
    if (state.expandedExerciseIndex === removeIndex) state.expandedExerciseIndex = null;
    else if (state.expandedExerciseIndex != null && state.expandedExerciseIndex > removeIndex) {
      state.expandedExerciseIndex -= 1;
    }
    renderExerciseEditors({ skipReveal: true });
  });

  setupExerciseDrag(card, exercisesContainer);
  exercisesContainer.appendChild(card);
  if (shouldOpen) setExerciseExpanded(card, true);
}

function renderSectionEditors() {
  const container = $("#cms-section-list");
  container.innerHTML = "";

  state.sections.forEach((section, sectionIndex) => {
    const tpl = document.getElementById("tpl-section-editor");
    const sectionCard = tpl.content.firstElementChild.cloneNode(true);
    sectionCard.dataset.sectionIndex = String(sectionIndex);
    if (section.id != null) sectionCard.dataset.sectionId = String(section.id);

    sectionCard.querySelector(".cms-section-title").value = section.title || "";
    sectionCard.querySelector(".cms-section-order").value = String(section.order ?? sectionIndex + 1);
    sectionCard.querySelector(".cms-section-order").addEventListener("change", applySectionOrderFromDom);
    sectionCard.querySelector(".cms-section-banner-value").value = section.banner || "";
    updateSectionBannerPreview(sectionCard, section.banner || "");

    sectionCard.querySelector(".cms-section-banner-file").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const statusEl = sectionCard.querySelector(".cms-section-banner-status");
      statusEl.textContent = "";

      const sectionId = Number(sectionCard.dataset.sectionId);
      if (!sectionId) {
        statusEl.textContent = "Section needs an ID. Save sections first.";
        e.target.value = "";
        return;
      }

      try {
        statusEl.textContent = "Uploading…";
        const data = await uploadSectionBannerFile(sectionId, file);
        const url = data.url || "";
        sectionCard.querySelector(".cms-section-banner-value").value = url;
        updateSectionBannerPreview(sectionCard, url);
        if (state.sections[sectionIndex]) {
          state.sections[sectionIndex].banner = url;
        }
        statusEl.textContent = "Thumbnail uploaded.";
      } catch (err) {
        statusEl.textContent = "";
        $("#cms-sections-error").textContent = err.message;
      } finally {
        e.target.value = "";
      }
    });

    sectionCard.querySelector(".cms-remove-section-banner").addEventListener("click", () => {
      sectionCard.querySelector(".cms-section-banner-value").value = "";
      updateSectionBannerPreview(sectionCard, "");
      sectionCard.querySelector(".cms-section-banner-status").textContent = "";
      if (state.sections[sectionIndex]) {
        state.sections[sectionIndex].banner = "";
      }
    });

    sectionCard.querySelector(".cms-remove-section").addEventListener("click", () => {
      if (state.sections.length <= 1) {
        alert("A course must have at least one section.");
        return;
      }
      if (!confirm(`Remove section "${section.title || "Untitled"}" and all its exercises?`)) return;
      if (state.editingSectionIndex === sectionIndex) {
        closeSectionExercises({ reRender: false });
      } else if (state.editingSectionIndex != null && state.editingSectionIndex > sectionIndex) {
        state.editingSectionIndex -= 1;
      }
      state.sections.splice(sectionIndex, 1);
      renderSectionEditors();
    });

    fillSectionOutline(sectionCard, section);

    sectionCard.querySelector(".cms-manage-exercises").addEventListener("click", () => {
      openSectionExercises(sectionIndex);
    });

    setupSectionDrag(sectionCard, container);
    container.appendChild(sectionCard);
  });
  renderBatchAiRows();
  cmsMotion()?.playCmsListReveal?.(container);
}

function renderExerciseEditors({ skipReveal = false, insertedIndex = null } = {}) {
  const container = $("#cms-exercise-list");
  if (!container) return;
  container.innerHTML = "";

  const sectionIndex = state.editingSectionIndex;
  if (sectionIndex == null) return;

  const section = state.sections[sectionIndex];
  if (!section) return;

  const exercises = section.exercises || [];
  if (!exercises.length) {
    return;
  }

  exercises.forEach((exercise, exerciseIndex) => {
    renderExerciseCard(exercise, sectionIndex, exerciseIndex, container);
  });
  refreshExerciseRowChrome(container);

  if (insertedIndex != null) {
    const card = container.querySelector(`[data-exercise-index="${insertedIndex}"]`);
    cmsMotion()?.playCmsInsert?.(card);
    requestAnimationFrame(() => {
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      card?.querySelector(".cms-exercise-title")?.focus();
    });
    return;
  }

  if (!skipReveal) cmsMotion()?.playCmsListReveal?.(container);
  updateExercisesViewDurationEstimate();
  if (state.expandedExerciseIndex == null) syncExerciseAgentPanel(false);
}

function setupSectionDrag(sectionCard, container) {
  sectionCard.draggable = false;
  const handle = sectionCard.querySelector(".cms-drag-handle");
  handle?.addEventListener("pointerdown", () => {
    sectionCard.draggable = true;
    const stop = () => {
      if (!sectionCard.classList.contains("dragging-section")) sectionCard.draggable = false;
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointerup", stop);
  });

  sectionCard.addEventListener("dragstart", (e) => {
    if (e.target.closest(".cms-exercise-card")) return;
    if (!sectionCard.draggable) {
      e.preventDefault();
      return;
    }
    sectionCard.classList.add("dragging-section");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sectionCard.dataset.sectionIndex);
  });

  sectionCard.addEventListener("dragend", () => {
    sectionCard.classList.remove("dragging-section");
    sectionCard.draggable = false;
    reorderSectionsFromDom(container);
  });

  sectionCard.addEventListener("dragover", (e) => {
    if (e.target.closest(".cms-exercise-card")) return;
    e.preventDefault();
    const dragging = container.querySelector(".dragging-section");
    if (!dragging || dragging === sectionCard) return;
    const rect = sectionCard.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    container.insertBefore(dragging, after ? sectionCard.nextSibling : sectionCard);
  });
}

function reorderSectionsFromDom(container) {
  container.querySelectorAll(".cms-section-card").forEach((card, index) => {
    const orderInput = card.querySelector(".cms-section-order");
    if (orderInput) orderInput.value = String(index + 1);
  });
  syncSectionsMetadataFromDom();
}

function setupExerciseDrag(card, container) {
  card.draggable = false;
  const handle = card.querySelector(".cms-drag-handle");
  handle?.addEventListener("pointerdown", () => {
    card.draggable = true;
    const stop = () => {
      if (!card.classList.contains("dragging")) card.draggable = false;
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointerup", stop);
  });

  card.addEventListener("dragstart", (e) => {
    if (!card.draggable) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.exerciseIndex);
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    card.draggable = false;
    reorderExercisesFromDom(container);
  });

  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dragging = container.querySelector(".dragging");
    if (!dragging || dragging === card) return;
    const rect = card.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    container.insertBefore(dragging, after ? card.nextSibling : card);
  });
}

function reorderExercisesFromDom(exercisesContainer) {
  exercisesContainer.querySelectorAll(".cms-exercise-card").forEach((card, index) => {
    const orderInput = card.querySelector(".cms-exercise-order");
    if (orderInput) orderInput.value = String(index + 1);
  });
  refreshExerciseRowChrome(exercisesContainer);
  syncExercisesFromDom();
}

function moveExercise(index, delta) {
  const container = $("#cms-exercise-list");
  if (!container) return;

  const cards = [...container.querySelectorAll(".cms-exercise-card")];
  const card = cards[index];
  const target = cards[index + delta];
  if (!card || !target) return;

  const mutate = () => {
    if (delta < 0) container.insertBefore(card, target);
    else container.insertBefore(card, target.nextSibling);
  };

  if (cmsMotion()?.playCmsReorder) {
    cmsMotion().playCmsReorder(container, mutate);
  } else {
    mutate();
  }
  reorderExercisesFromDom(container);
}

function buildSectionsPayload() {
  syncAllFromDom();
  return state.sections.map((section, sectionOrder) => ({
    id: section.id,
    title: section.title || `Section ${sectionOrder + 1}`,
    banner: section.banner || "",
    order: sectionOrder + 1,
    exercises: (section.exercises || []).map((exercise, exerciseOrder) => ({
      ...exercise,
      order: exerciseOrder + 1,
    })),
  }));
}

async function saveCourseStructure({ errorEl, statusEl, btn, successMessage }) {
  if (!state.editingCourse) return;
  setCmsError(errorEl, "");
  statusEl.textContent = "";
  state.cmsAutosaving = true;
  updateCmsAutosaveStatus();

  btn.disabled = true;
  try {
    const sections = buildSectionsPayload();
    // #region agent log
    fetch('http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'365eeb'},body:JSON.stringify({sessionId:'365eeb',location:'cms.js:saveCourseStructure',message:'saving sections payload',data:{sectionCount:sections.length,exerciseCounts:sections.map((section)=>section.exercises?.length||0),domCards:document.querySelectorAll('#cms-exercise-list .cms-exercise-card').length},timestamp:Date.now(),hypothesisId:'H2',runId:'publish-fix'})}).catch(()=>{});
    // #endregion
    const data = await api(`/api/cms/courses/${state.editingCourse.id}/sections`, {
      method: "PUT",
      body: { sections },
    });
    const stayInExercises = isExercisesSubpageOpen();
    const sectionId =
      stayInExercises && state.sections[state.editingSectionIndex]
        ? state.sections[state.editingSectionIndex].id
        : null;
    const expandedIndex = state.expandedExerciseIndex;

    state.sections = sortSectionsByOrder(
      (data.sections || []).map((section) => ({
        ...section,
        exercises: (section.exercises || []).map((exercise) => ({ ...exercise })),
      }))
    );

    if (stayInExercises) {
      const nextIndex =
        sectionId != null
          ? state.sections.findIndex((section) => section.id === sectionId)
          : 0;
      state.editingSectionIndex = nextIndex >= 0 ? nextIndex : 0;
      state.expandedExerciseIndex = expandedIndex;
      const activeSection = state.sections[state.editingSectionIndex];
      const titleEl = $("#cms-exercises-section-title");
      if (titleEl) {
        titleEl.textContent =
          activeSection?.title?.trim() || `Section ${state.editingSectionIndex + 1}`;
      }
      $("#cms-sections-view").hidden = true;
      $("#cms-exercises-view").hidden = false;
      renderExerciseEditors({ skipReveal: true });
    } else {
      state.editingSectionIndex = null;
      state.expandedExerciseIndex = null;
      $("#cms-sections-view").hidden = false;
      $("#cms-exercises-view").hidden = true;
      renderSectionEditors();
    }
    statusEl.textContent = successMessage;
    clearCmsDirty();
    cmsMotion()?.playCmsSavePulse?.(btn);
  } catch (err) {
    setCmsError(errorEl, err.message);
  } finally {
    btn.disabled = false;
    state.cmsAutosaving = false;
    updateCmsAutosaveStatus();
  }
}

async function saveSections() {
  await saveCourseStructure({
    errorEl: $("#cms-sections-error"),
    statusEl: $("#cms-sections-status"),
    btn: $("#btn-save-sections"),
    successMessage: "Sections saved.",
  });
}

async function saveExercises() {
  await saveCourseStructure({
    errorEl: $("#cms-exercises-error"),
    statusEl: $("#cms-exercises-status"),
    btn: $("#btn-save-exercises"),
    successMessage: "Exercises saved.",
  });
}

function addSection() {
  if (getActiveTabId() === "sections" && !isExercisesSubpageOpen()) syncSectionsMetadataFromDom();
  const nextOrder = state.sections.reduce((max, section) => Math.max(max, section.order || 0), 0) + 1;
  state.sections.push(defaultSection());
  state.sections[state.sections.length - 1].order = nextOrder;
  markCmsDirty();
  if (getActiveTabId() === "sections") {
    renderSectionEditors();
  } else {
    switchTab("sections");
  }
}

function addExercise(type = "mcquiz") {
  const sectionIndex = state.editingSectionIndex;
  if (sectionIndex == null) return;

  syncExercisesFromDom();
  const section = state.sections[sectionIndex];
  if (!section) return;

  if (!section.exercises) section.exercises = [];
  const exercise = defaultExercise(type);
  exercise.order = section.exercises.length + 1;
  section.exercises.push(exercise);
  state.expandedExerciseIndex = section.exercises.length - 1;
  markCmsDirty();
  renderExerciseEditors({ insertedIndex: state.expandedExerciseIndex });
}

const CMS_TOUR_STEPS = [
  {
    title: "Build your course",
    copy: "Use the Sections tab to add lesson units, covers, and exercise lists.",
    onShow: () => switchTab("sections"),
  },
  {
    title: "Generate with AI",
    copy: "Open a section, then use Generate from material. Enable full course mode on Step 2 if you want a whole course from one document.",
    onShow: () => {},
  },
  {
    title: "Host it live",
    copy: "When your course is ready, open Host in the top bar to run the class with students.",
    onShow: () => {},
  },
];

function renderCmsTourStep() {
  const step = CMS_TOUR_STEPS[state.cmsTourStep];
  const overlay = $("#cms-onboarding");
  if (!overlay || !step) {
    overlay?.setAttribute("hidden", "");
    return;
  }
  overlay.hidden = false;
  $("#cms-onboarding-kicker").textContent = `Step ${state.cmsTourStep + 1} of ${CMS_TOUR_STEPS.length}`;
  $("#cms-onboarding-title").textContent = step.title;
  $("#cms-onboarding-copy").textContent = step.copy;
  const nextBtn = $("#btn-cms-onboarding-next");
  if (nextBtn) {
    nextBtn.textContent = state.cmsTourStep >= CMS_TOUR_STEPS.length - 1 ? "Done" : "Next";
  }
  step.onShow?.();
}

function maybeStartCmsTour() {
  try {
    if (localStorage.getItem(CMS_TOUR_KEY)) return;
  } catch {
    return;
  }
  state.cmsTourStep = 0;
  renderCmsTourStep();
}

function finishCmsTour() {
  try {
    localStorage.setItem(CMS_TOUR_KEY, "1");
  } catch {
    /* ignore */
  }
  const overlay = $("#cms-onboarding");
  if (overlay) overlay.hidden = true;
}

function advanceCmsTour() {
  if (state.cmsTourStep >= CMS_TOUR_STEPS.length - 1) {
    finishCmsTour();
    return;
  }
  state.cmsTourStep += 1;
  renderCmsTourStep();
}


$("#nav-cms-home")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!state.token || !state.user) return;
  enterHome();
});
$("#cms-home-grid")?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-home-action]");
  if (!card) return;
  handleHomeAction(card.dataset.homeAction);
});
$("#nav-cms-courses")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!state.token || !state.user) return;
  enterCourseList();
});
$("#nav-cms-community")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!state.token || !state.user) return;
  enterCommunity();
});
let communitySearchTimer = 0;
$("#cms-community-search")?.addEventListener("input", () => {
  state.communityQuery = $("#cms-community-search").value.trim();
  clearTimeout(communitySearchTimer);
  communitySearchTimer = setTimeout(() => loadCommunityCourses(), 250);
});
$("#cms-community-lang")?.addEventListener("change", () => {
  state.communityLang = $("#cms-community-lang").value || "all";
  loadCommunityCourses();
});
$("#cms-community-sort")?.addEventListener("change", () => {
  state.communitySort = $("#cms-community-sort").value || "featured";
  loadCommunityCourses();
});
$("#cms-community-list")?.addEventListener("click", (event) => {
  const card = event.target.closest(".cms-community-card");
  if (!card) return;
  const listingId = Number(card.dataset.id);
  if (!Number.isFinite(listingId)) return;
  if (event.target.closest(".cms-community-preview-btn")) {
    openCommunityPreview(listingId);
    return;
  }
  if (event.target.closest(".cms-community-add-btn")) {
    addCommunityCourse(listingId);
    return;
  }
  if (event.target.closest(".cms-community-report-btn")) {
    reportCommunityCourse(listingId);
    return;
  }
  if (event.target.closest(".cms-community-unshare-btn")) {
    unshareCommunityListing(listingId);
  }
});
$("#btn-community-preview-close")?.addEventListener("click", closeCommunityPreview);
$("#cms-community-preview-backdrop")?.addEventListener("click", closeCommunityPreview);
$("#btn-community-preview-add")?.addEventListener("click", () => {
  if (state.communityPreviewId) addCommunityCourse(state.communityPreviewId, { fromPreview: true });
});
$("#btn-community-preview-report")?.addEventListener("click", () => {
  if (state.communityPreviewId) reportCommunityCourse(state.communityPreviewId);
});
$("#btn-cms-asset-preview-close")?.addEventListener("click", closeMaterialAssetPreview);
$("#cms-asset-preview-backdrop")?.addEventListener("click", closeMaterialAssetPreview);
$("#btn-cms-asset-preview-attach")?.addEventListener("click", attachMaterialAssetFromPreview);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#cms-asset-preview")?.hidden) closeMaterialAssetPreview();
});
$("#cms-dashboard-class")?.addEventListener("change", async (event) => {
  const nextId = Number(event.target.value);
  state.dashboardClassId = Number.isFinite(nextId) && nextId > 0 ? nextId : null;
  savePrefs();
  $("#cms-dashboard-list").innerHTML = `
    <div class="cms-list-loading" aria-hidden="true">
      <div class="cms-skeleton-card"></div>
      <div class="cms-skeleton-card"></div>
    </div>`;
  try {
    await loadDashboardProgress();
  } catch (err) {
    $("#cms-dashboard-list").innerHTML = "";
    $("#cms-dashboard-error").textContent = err.message;
  }
});

$("#btn-cms-login").addEventListener("click", handleLogin);
$("#cms-login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});
$("#btn-cms-logout").addEventListener("click", handleLogout);
$("#btn-new-course").addEventListener("click", createNewCourse);
$("#btn-import-all-courses").addEventListener("click", triggerImportAllCourses);
$("#import-all-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) await importAllCourses(file);
});
$("#btn-export-all-courses").addEventListener("click", exportAllCourses);
$("#btn-back-list").addEventListener("click", () => enterCourseList());
$("#btn-save-details").addEventListener("click", saveDetails);
$("#btn-community-share")?.addEventListener("click", shareEditingCourseToCommunity);
$("#btn-community-unshare")?.addEventListener("click", unshareEditingCourseFromCommunity);
$("#btn-export-course").addEventListener("click", exportCurrentCourse);
$("#btn-delete-course").addEventListener("click", deleteCourse);
$("#course-banner-file").addEventListener("change", handleBannerFileChange);
$("#btn-remove-banner").addEventListener("click", handleRemoveBanner);
$("#btn-add-section").addEventListener("click", addSection);
$("#btn-save-sections").addEventListener("click", saveSections);
$("#btn-save-exercises").addEventListener("click", saveExercises);
$("#cms-ai-file")?.addEventListener("change", (event) => {
  const added = addAiSelectedFiles(event.target.files);
  event.target.value = "";
  syncAiFileNameLabel();
  const statusEl = $("#cms-ai-extract-status");
  const files = getAiSelectedFiles();
  if (statusEl && added) {
    statusEl.hidden = false;
    statusEl.textContent =
      files.length === 1
        ? `${files[0].name} selected — press Next below.`
        : `${files.length} file(s) selected — press Next below.`;
  }
  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "365eeb" },
    body: JSON.stringify({
      sessionId: "365eeb",
      runId: "multi-upload",
      hypothesisId: "H2",
      location: "cms.js:cms-ai-file-change",
      message: "files added to selection",
      data: { added, total: files.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
});
$("#cms-ai-file-list")?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-ai-file-index]");
  if (!btn) return;
  removeAiSelectedFile(Number(btn.dataset.aiFileIndex));
  syncAiFileNameLabel();
  const statusEl = $("#cms-ai-extract-status");
  const files = getAiSelectedFiles();
  if (statusEl) {
    if (!files.length) {
      statusEl.hidden = true;
      statusEl.textContent = "";
    } else {
      statusEl.hidden = false;
      statusEl.textContent =
        files.length === 1
          ? `${files[0].name} selected — press Next below.`
          : `${files.length} file(s) selected — press Next below.`;
    }
  }
});
const cmsAiFileDrop = $("#cms-ai-file-drop");
if (cmsAiFileDrop) {
  cmsAiFileDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  cmsAiFileDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    const added = addAiSelectedFiles(event.dataTransfer?.files);
    syncAiFileNameLabel();
    const statusEl = $("#cms-ai-extract-status");
    const files = getAiSelectedFiles();
    if (statusEl && added) {
      statusEl.hidden = false;
      statusEl.textContent =
        files.length === 1
          ? `${files[0].name} selected — press Next below.`
          : `${files.length} file(s) selected — press Next below.`;
    }
  });
}
$("#btn-cms-ai-path-section")?.addEventListener("click", () => openAiGeneratePath("section"));
$("#btn-cms-ai-path-course")?.addEventListener("click", () => openAiGeneratePath("course"));
$("#btn-cms-ai-change-path")?.addEventListener("click", () => {
  if (state.aiWizardBusy) return;
  resetAiGeneratePanel();
});
$("#btn-cms-onboarding-next")?.addEventListener("click", advanceCmsTour);
$("#btn-cms-onboarding-skip")?.addEventListener("click", finishCmsTour);
$("#cms-onboarding-backdrop")?.addEventListener("click", finishCmsTour);
$("#cms-ai-paste")?.addEventListener("input", syncAiMaterialState);
$("#cms-ai-instructions")?.addEventListener("input", updateAiWizardSummary);
$("#cms-ai-video-url")?.addEventListener("input", syncAiMaterialState);
$("#screen-cms-edit")?.addEventListener("input", (event) => {
  if (!state.editingCourse) return;
  if (event.target.closest("#cms-ai-wizard, #cms-ai-entry-chooser")) return;
  markCmsDirty();
});
$("#screen-cms-edit")?.addEventListener("change", (event) => {
  if (!state.editingCourse) return;
  if (event.target.closest("#cms-ai-wizard, #cms-ai-entry-chooser")) return;
  markCmsDirty();
});
$("#btn-cms-ai-next")?.addEventListener("click", handleAiWizardNext);
$("#btn-cms-ai-back")?.addEventListener("click", handleAiWizardBack);
$("#btn-cms-ai-publish")?.addEventListener("click", publishAiExercises);
$("#cms-ai-wizard")?.addEventListener("change", (event) => {
  if (event.target.matches("#cms-ai-speak-lang")) {
    updateAiWizardSummary();
    return;
  }
  if (event.target.matches("#cms-ai-type-mcquiz, #cms-ai-type-fastmcquiz, #cms-ai-type-buzzin, #cms-ai-type-video")) {
    if (state.aiTemplate !== "custom") {
      state.aiTemplate = "custom";
      document.querySelectorAll(".cms-ai-template").forEach((btn) => {
        btn.classList.toggle("is-selected", btn.dataset.template === "custom");
      });
      const custom = $("#cms-ai-custom-settings");
      if (custom) custom.hidden = false;
    }
    syncCustomTypeCountInputs();
    syncAiWizardCopy();
    if (state.aiWizardStep === 2) {
      const nextBtn = $("#btn-cms-ai-next");
      if (nextBtn && !hasAiPreviewReady()) nextBtn.textContent = "Next";
    }
  }
});
$("#cms-ai-wizard")?.addEventListener("click", (event) => {
  const thumb = event.target.closest(".cms-ai-asset-thumb");
  if (thumb) {
    const url = thumb.dataset.assetUrl || "";
    const label = thumb.dataset.assetLabel || thumb.title || "";
    if (!url) return;
    const target = document.querySelector(".cms-ai-item-block.is-asset-pick-target");
    openMaterialAssetPreview({ url, label, attachTarget: target || null });
    return;
  }
  const template = event.target.closest(".cms-ai-template");
  if (template?.dataset.template) {
    applyAiTemplate(template.dataset.template);
    return;
  }
  const stepBtn = event.target.closest(".cms-ai-step");
  if (stepBtn) {
    const target = Number(stepBtn.dataset.step);
    if (stepBtn.disabled || target > state.aiWizardMaxStep || state.aiWizardBusy) return;
    setAiWizardStep(target);
    return;
  }
  const groupToggle = event.target.closest(".cms-ai-preview-group-toggle");
  if (groupToggle) {
    const body = groupToggle.nextElementSibling;
    if (body) {
      const expanded = groupToggle.getAttribute("aria-expanded") === "true";
      groupToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      body.hidden = expanded;
    }
    return;
  }
  handleAiPreviewClick(event);
});
$("#cms-ai-wizard")?.addEventListener("change", async (event) => {
  const input = event.target.closest(".cms-ai-q-image-file");
  if (!input) return;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const block = input.closest(".cms-ai-item-block");
  if (!block) return;
  try {
    await uploadQuestionImageForBlock(block, file, "cms-ai-q");
  } catch {
    /* status shown on block */
  }
});
$("#btn-cms-ai-export-plan")?.addEventListener("click", () => {
  try {
    const plan = collectAiCoursePlanFromDom() || state.aiCoursePlan;
    if (!plan) throw new Error("No course plan to export.");
    downloadJsonFile(`course-plan-${Date.now()}.json`, plan);
  } catch (err) {
    $("#cms-ai-error").textContent = err.message;
  }
});
$("#cms-ai-import-plan")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const settings = getAiGenerationSettings();
    const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
    if (!sections.length) throw new Error("Plan JSON has no sections.");
    state.aiCourseMode = true;
    state.aiCoursePlan = {
      formatSource: "step1",
      appliedTemplate: settings.template,
      appliedTypes: { ...settings.types },
      appliedDifficulty: settings.difficulty,
      appliedSpeakLangCode: settings.speakLangCode,
      formatLabel: aiFormatLabel(settings.types, settings.difficulty, settings.speakLangCode),
      courseTitle: parsed.courseTitle || "Course",
      planner: parsed.planner || "import",
      notes: parsed.notes || "",
      sections: sections.map((section, index) => ({
        key: String(section.key ?? index),
        title: section.title || `Section ${index + 1}`,
        summary: section.summary || "",
        materialExcerpt: section.materialExcerpt || section.material || "",
        types: { ...settings.types },
        difficulty: settings.difficulty,
        included: section.included !== false,
        warning: section.warning || "",
      })),
    };
    const generated = await generateCourseFromPlan();
    if (generated) {
      setAiWizardStep(3);
      $("#cms-ai-generate-status").textContent = "Imported course plan and generated exercises.";
    }
  } catch (err) {
    $("#cms-ai-error").textContent = err.message;
  }
});
$("#cms-ai-plan-list")?.addEventListener("change", (event) => {
  if (!event.target.matches(".cms-ai-plan-include")) return;
  const card = event.target.closest(".cms-ai-plan-card");
  if (card) card.classList.toggle("is-excluded", !event.target.checked);
});
$("#btn-cms-ai-export-json")?.addEventListener("click", async () => {
  try {
    collectAiDraftFromDom();
    await exportExercisesJson({ mode: "section" });
  } catch (err) {
    $("#cms-ai-error").textContent = err.message;
  }
});
$("#cms-ai-import-json")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    await importExercisesJsonFromFile(file, { applyTarget: "preview" });
  } catch (err) {
    $("#cms-ai-error").textContent = err.message;
  }
});
$("#btn-cms-batch-generate")?.addEventListener("click", batchGenerateAllSections);
$("#btn-cms-batch-apply")?.addEventListener("click", applyBatchResultsToSections);
$("#btn-cms-batch-export-json")?.addEventListener("click", async () => {
  try {
    await exportExercisesJson({ mode: "batch", batchResults: state.batchDraftResults });
  } catch (err) {
    $("#cms-batch-error").textContent = err.message;
  }
});
$("#cms-batch-import-json")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    await importExercisesJsonFromFile(file, { applyTarget: "sections" });
  } catch (err) {
    $("#cms-batch-error").textContent = err.message;
  }
});
$("#cms-batch-ai-panel")?.addEventListener("click", async (event) => {
  const prepareBtn = event.target.closest(".cms-batch-prepare");
  if (!prepareBtn) return;
  const sectionIndex = Number(prepareBtn.dataset.sectionIndex);
  if (!Number.isFinite(sectionIndex)) return;
  const errorEl = $("#cms-batch-error");
  if (errorEl) errorEl.textContent = "";
  try {
    await prepareBatchRowMaterial(sectionIndex);
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message;
  }
});

document.querySelectorAll(".cms-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

loadPrefs();
initCmsTheme();
initCmsTextSize();
initGlobalAgentSelection();
window.addEventListener("resize", () => {
  if (state.aiWizardActive && state.aiWizardStep === 3) syncAiReviewAgentLayout();
});
updateAuthUi();
applyTeacherLoginDefaults(
  $("#cms-login-username"),
  $("#cms-login-password"),
  state.loginUsername
);

void (async () => {
  await loadCmsAppContext();
  if (state.token && state.user) {
    enterHome();
  } else {
    showCmsScreen("login");
  }
})();
