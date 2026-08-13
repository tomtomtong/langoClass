const STORAGE_KEY = "lango_host_prefs";
const CMS_THEME_KEY = "lango_cms_theme";
const CMS_EMPTY_COVER = "/assets/cms/cover-empty.svg";

const state = {
  token: null,
  user: null,
  loginUsername: "",
  courses: [],
  classes: [],
  editingCourse: null,
  sections: [],
  editingSectionIndex: null,
  expandedExerciseIndex: null,
};

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
    })
  );
}

function systemCmsTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function storedCmsTheme() {
  try {
    const value = localStorage.getItem(CMS_THEME_KEY);
    if (value === "dark" || value === "light") return value;
  } catch {
    /* ignore */
  }
  return null;
}

function currentCmsTheme() {
  return document.documentElement.dataset.cmsTheme === "dark" ? "dark" : "light";
}

function syncCmsThemeButton(theme) {
  const btn = $("#btn-cms-theme");
  if (!btn) return;
  const dark = theme === "dark";
  btn.setAttribute("aria-pressed", dark ? "true" : "false");
  btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

function applyCmsTheme(theme, { persist = false } = {}) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.cmsTheme = next;
  syncCmsThemeButton(next);
  if (persist) {
    try {
      localStorage.setItem(CMS_THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }
  window.LangoGsap?.playCmsTabGlider?.();
}

function toggleCmsTheme() {
  applyCmsTheme(currentCmsTheme() === "dark" ? "light" : "dark", { persist: true });
  const btn = $("#btn-cms-theme");
  window.LangoGsap?.playCmsSavePulse?.(btn);
}

function initCmsTheme() {
  applyCmsTheme(storedCmsTheme() || systemCmsTheme());
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", () => {
    if (!storedCmsTheme()) applyCmsTheme(systemCmsTheme());
  });
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

function showCmsScreen(id) {
  document.querySelectorAll(".cms-app .screen").forEach((s) => s.classList.remove("active"));
  const screen = document.querySelector(`#screen-cms-${id}`);
  if (!screen) return;
  screen.classList.add("active");
  cmsMotion()?.playCmsScreenEnter?.(screen);
}

function updateAuthUi() {
  const loggedIn = !!(state.token && state.user);
  $("#cms-teacher-label").hidden = !loggedIn;
  $("#btn-cms-logout").hidden = !loggedIn;
  if (loggedIn) {
    $("#cms-teacher-label").textContent = `Logged in as ${teacherDisplayName()}`;
  }
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
    await enterCourseList();
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

async function enterCourseList() {
  showCmsScreen("list");
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
            <span class="cms-course-card-meta">${course.exerciseCount || 0} exercise${course.exerciseCount === 1 ? "" : "s"} · ${escapeHtml(assignedClassesLabel(course))}</span>
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
    $("#cms-edit-title").textContent = state.editingCourse.name || "Edit course";
    showCmsScreen("edit");
    switchTab("details");
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
  if (type === "buzzin") return "Buzz In";
  if (type === "fastmcquiz") return "Fast MC Quiz";
  return "MC Quiz";
}

function exerciseTypeShortLabel(type) {
  if (type === "video") return "Video";
  if (type === "buzzin") return "Buzz In";
  if (type === "fastmcquiz") return "Fast";
  return "Quiz";
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
}

function syncSectionsFromDom() {
  if (state.editingSectionIndex != null) {
    syncExercisesFromDom();
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

function openSectionExercises(sectionIndex, { focusComposer = false } = {}) {
  syncSectionsMetadataFromDom();
  const section = state.sections[sectionIndex];
  if (!section) return;

  const resolvedIndex =
    section.id != null ? state.sections.findIndex((s) => s.id === section.id) : sectionIndex;
  state.editingSectionIndex = resolvedIndex >= 0 ? resolvedIndex : sectionIndex;
  state.expandedExerciseIndex = null;

  const activeSection = state.sections[state.editingSectionIndex];
  $("#cms-exercises-section-title").textContent =
    activeSection?.title?.trim() || `Section ${state.editingSectionIndex + 1}`;
  $("#cms-sections-view").hidden = true;
  $("#cms-exercises-view").hidden = false;
  $("#cms-exercises-error").textContent = "";
  $("#cms-exercises-status").textContent = "";
  renderExerciseEditors({ skipReveal: true });
  cmsMotion()?.playCmsTabEnter?.($("#cms-exercises-view"));
  if (focusComposer) {
    requestAnimationFrame(() => {
      const composer = $("#cms-exercise-composer");
      composer?.scrollIntoView({ block: "end", behavior: "smooth" });
      composer?.querySelector(".cms-type-tile")?.focus();
    });
  }
}

function closeSectionExercises({ reRender = true } = {}) {
  if (state.editingSectionIndex != null) syncExercisesFromDom();
  state.editingSectionIndex = null;
  state.expandedExerciseIndex = null;
  $("#cms-sections-view").hidden = false;
  $("#cms-exercises-view").hidden = true;
  if (reRender) renderSectionEditors();
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
      title: "Buzz In",
      subTitle: "Buzz In",
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
    title: "Quiz",
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
      subTitle: "Buzz In",
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
  const bannerUrl = (url || "").trim();
  if (!preview || !img) return;

  if (bannerUrl) {
    img.src = bannerUrl;
    preview.hidden = false;
  } else {
    img.src = CMS_EMPTY_COVER;
    preview.hidden = true;
  }
}

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

function updateQuestionImagePreview(block, url) {
  const preview = block?.querySelector(".cms-q-image-preview");
  const img = block?.querySelector(".cms-q-image-img");
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
          <div class="cms-q-image-field">
            <span class="cms-q-image-label">Question image (optional)</span>
            <div class="cms-q-image-preview"${item.image ? "" : " hidden"}>
              <img class="cms-q-image-img" src="${escapeHtml(item.image || "")}" alt="" />
              <button type="button" class="cms-icon-btn cms-q-image-remove" data-q="${qIdx}">×</button>
            </div>
            <label class="cms-thumbnail-upload btn secondary small">
              <input type="file" class="cms-q-image-file" data-q="${qIdx}" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
              Upload image
            </label>
            <input type="hidden" class="cms-q-image-value" data-q="${qIdx}" value="${escapeHtml(item.image || "")}" />
            <span class="hint cms-q-image-status" data-q="${qIdx}"></span>
          </div>
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
        const qIdx = Number(btn.dataset.q);
        const block = list.querySelector(`.cms-question-block[data-q="${qIdx}"]`);
        const valueInput = block?.querySelector(".cms-q-image-value");
        if (valueInput) valueInput.value = "";
        updateQuestionImagePreview(block, "");
        if (items[qIdx]) items[qIdx].image = "";
      });
    });

    list.querySelectorAll(".cms-q-image-file").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;

        const qIdx = Number(input.dataset.q);
        const block = list.querySelector(`.cms-question-block[data-q="${qIdx}"]`);
        const statusEl = block?.querySelector(".cms-q-image-status");
        const valueInput = block?.querySelector(".cms-q-image-value");

        if (statusEl) statusEl.textContent = "Uploading…";
        try {
          const data = await uploadQuestionImageFile(file);
          const url = data?.url || "";
          if (valueInput) valueInput.value = url;
          updateQuestionImagePreview(block, url);
          if (items[qIdx]) items[qIdx].image = url;
          if (statusEl) statusEl.textContent = "Image uploaded.";
        } catch (err) {
          if (statusEl) statusEl.textContent = err.message;
        }
      });
    });
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

  container.innerHTML = `<label class="field">
    <span>Video URL</span>
    <input type="url" class="cms-video-url" value="${escapeHtml(url)}" placeholder="https://..." />
  </label>
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
    <button type="button" class="btn secondary small cms-generate-captions">Generate 字幕 (STT)</button>
    <button type="button" class="btn secondary small cms-translate-captions">Translate 字幕 (LLM)</button>
    <p class="hint cms-caption-status">${
      tracks.length
        ? `Saved languages: ${tracks.map((t) => t.label).join(", ")}. Generate/translate into another language, then Save Course.`
        : "Generate STT captions, or translate an existing caption file into another language for the player language menu."
    }</p>
    ${trackSummary ? `<pre class="hint cms-caption-track-list">${escapeHtml(trackSummary)}</pre>` : ""}
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
        .map((track) => track.language.toUpperCase())
        .join(", ")}. Click Save Course to keep them.`;
    }
  };

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
    })
  );
  if (!items.length) items.push({ topic: "", correctAnswer: "", sttLanguage: "" });

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
  }

  container.querySelector(".cms-add-buzzin-topic")?.addEventListener("click", () => {
    syncFromDom();
    if (items.length >= MAX_BUZZIN_TOPICS) return;
    items.push({
      topic: "",
      correctAnswer: "",
      sttLanguage: items[items.length - 1]?.sttLanguage || "",
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
    state.expandedExerciseIndex = Number(card.dataset.exerciseIndex);
  } else if (Number(card.dataset.exerciseIndex) === state.expandedExerciseIndex) {
    state.expandedExerciseIndex = null;
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

function fillSectionOutline(sectionCard, section) {
  const outline = sectionCard.querySelector(".cms-section-outline");
  const countEl = sectionCard.querySelector(".cms-section-exercise-count");
  const exercises = section.exercises || [];
  if (countEl) {
    countEl.textContent = exercises.length
      ? `${exercises.length} exercise${exercises.length === 1 ? "" : "s"}`
      : "No exercises";
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
    sectionCard.querySelector(".cms-add-section-exercise")?.addEventListener("click", () => {
      openSectionExercises(sectionIndex, { focusComposer: true });
    });

    setupSectionDrag(sectionCard, container);
    container.appendChild(sectionCard);
  });
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
    container.innerHTML = `
      <div class="cms-empty">
        <p class="cms-empty-title">No exercises yet</p>
        <p class="cms-empty-copy">Pick a type below to add the first one.</p>
      </div>`;
    if (!skipReveal) cmsMotion()?.playCmsListReveal?.(container);
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
  errorEl.textContent = "";
  statusEl.textContent = "";

  btn.disabled = true;
  try {
    const sections = buildSectionsPayload();
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
    cmsMotion()?.playCmsSavePulse?.(btn);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
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
  const demo = Boolean($("#cms-add-demo")?.checked);
  const section = state.sections[sectionIndex];
  if (!section) return;

  if (!section.exercises) section.exercises = [];
  const exercise = demo ? demoExercise(type) : defaultExercise(type);
  exercise.order = section.exercises.length + 1;
  section.exercises.push(exercise);
  state.expandedExerciseIndex = section.exercises.length - 1;
  renderExerciseEditors({ insertedIndex: state.expandedExerciseIndex });
}

$("#btn-cms-login").addEventListener("click", handleLogin);
$("#cms-login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});
$("#btn-cms-logout").addEventListener("click", handleLogout);
$("#btn-cms-theme")?.addEventListener("click", toggleCmsTheme);
$("#btn-new-course").addEventListener("click", createNewCourse);
$("#btn-import-all-courses").addEventListener("click", triggerImportAllCourses);
$("#import-all-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) await importAllCourses(file);
});
$("#btn-export-all-courses").addEventListener("click", exportAllCourses);
$("#btn-back-list").addEventListener("click", () => enterCourseList());
$("#btn-save-details").addEventListener("click", saveDetails);
$("#btn-export-course").addEventListener("click", exportCurrentCourse);
$("#btn-delete-course").addEventListener("click", deleteCourse);
$("#course-banner-file").addEventListener("change", handleBannerFileChange);
$("#btn-remove-banner").addEventListener("click", handleRemoveBanner);
$("#btn-add-section").addEventListener("click", addSection);
$("#cms-exercise-composer")?.addEventListener("click", (event) => {
  const tile = event.target.closest(".cms-type-tile");
  if (!tile) return;
  cmsMotion()?.playCmsTypePress?.(tile);
  addExercise(tile.dataset.type || "mcquiz");
});
$("#btn-back-sections").addEventListener("click", () => closeSectionExercises());
$("#btn-save-sections").addEventListener("click", saveSections);
$("#btn-save-exercises").addEventListener("click", saveExercises);

document.querySelectorAll(".cms-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

loadPrefs();
initCmsTheme();
updateAuthUi();
applyTeacherLoginDefaults(
  $("#cms-login-username"),
  $("#cms-login-password"),
  state.loginUsername
);

if (state.token && state.user) {
  enterCourseList();
} else {
  showCmsScreen("login");
}
