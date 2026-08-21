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
  aiMaterialText: "",
  aiDraftExercises: [],
  aiWizardStep: 1,
  aiTemplate: "vocab",
  batchDraftResults: [],
  batchPreparedMaterials: {},
  dashboardClassId: null,
  dashboardCourses: [],
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
    await enterDashboard();
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
    await enterDashboard();
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
    resetBatchAiPanel();
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

const AI_TEMPLATES = {
  vocab: { types: { mcquiz: 5, fastmcquiz: 3 }, difficulty: "easy" },
  reading: { types: { mcquiz: 4, buzzin: 2 }, difficulty: "medium" },
  speaking: { types: { buzzin: 4 }, difficulty: "medium" },
  mixed: { types: { mcquiz: 3, fastmcquiz: 2, buzzin: 2 }, difficulty: "medium" },
  video: { types: { video: 1 }, difficulty: "medium" },
};

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
  if (materialIntro) {
    materialIntro.textContent = isAiVideoOnly()
      ? "Paste or upload a lesson script. The video API will generate an avatar MP4 you can publish as a Video exercise."
      : "Upload a file, video, audio, or image, paste text, or provide a video URL. Images convert to markdown; audio and video are transcribed.";
  }
}

function resetAiGeneratePanel() {
  state.aiMaterialText = "";
  state.aiDraftExercises = [];
  state.aiWizardStep = 1;
  state.aiTemplate = "vocab";
  const preview = $("#cms-ai-material-preview");
  if (preview) {
    preview.value = "";
    preview.hidden = true;
  }
  if ($("#cms-ai-paste")) $("#cms-ai-paste").value = "";
  if ($("#cms-ai-video-url")) $("#cms-ai-video-url").value = "";
  $("#cms-ai-extract-status") && ($("#cms-ai-extract-status").textContent = "");
  $("#cms-ai-generate-status") && ($("#cms-ai-generate-status").textContent = "");
  $("#cms-ai-error") && ($("#cms-ai-error").textContent = "");
  $("#cms-ai-preview") && ($("#cms-ai-preview").innerHTML = "");
  const videoLog = $("#cms-ai-video-log");
  if (videoLog) {
    videoLog.textContent = "";
    videoLog.hidden = true;
  }
  const fileInput = $("#cms-ai-file");
  if (fileInput) fileInput.value = "";
  applyAiTemplate("vocab");
  setAiWizardStep(1);
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
    syncAiWizardCopy();
    return;
  }
  $("#cms-ai-type-mcquiz") && ($("#cms-ai-type-mcquiz").checked = preset.types.mcquiz > 0);
  $("#cms-ai-type-fastmcquiz") && ($("#cms-ai-type-fastmcquiz").checked = preset.types.fastmcquiz > 0);
  $("#cms-ai-type-buzzin") && ($("#cms-ai-type-buzzin").checked = preset.types.buzzin > 0);
  $("#cms-ai-type-video") && ($("#cms-ai-type-video").checked = preset.types.video > 0);
  const counts = Object.values(preset.types).filter((count) => count > 0);
  if ($("#cms-ai-count") && counts.length) $("#cms-ai-count").value = String(Math.max(...counts));
  if ($("#cms-ai-difficulty")) $("#cms-ai-difficulty").value = preset.difficulty;
  syncAiWizardCopy();
}

function setAiWizardStep(step) {
  const next = Math.max(1, Math.min(4, Number(step) || 1));
  state.aiWizardStep = next;
  document.querySelectorAll(".cms-ai-step").forEach((btn) => {
    const n = Number(btn.dataset.step);
    const isCurrent = n === next;
    const isDone = n < next;
    const isUpcoming = n > next;
    btn.classList.toggle("is-current", isCurrent);
    btn.classList.toggle("is-done", isDone);
    btn.classList.toggle("is-upcoming", isUpcoming);
    btn.disabled = isUpcoming;
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
  if (back) back.hidden = next === 1;
  if (publish) publish.hidden = next !== 4;
  if (nextBtn) {
    nextBtn.hidden = next === 4;
    nextBtn.textContent =
      next === 2
        ? isAiVideoOnly()
          ? "Generate video"
          : "Generate"
        : next === 3
          ? "Continue"
          : "Next";
  }
  if (next === 1) syncAiWizardCopy();
  if (next === 4) renderAiPublishSummary();
}

function getAiMaterialText() {
  return (
    state.aiMaterialText ||
    $("#cms-ai-material-preview")?.value.trim() ||
    $("#cms-ai-paste")?.value.trim() ||
    ""
  );
}

function getAiTypeCounts(prefix = "cms-ai") {
  if (prefix === "cms-ai" && state.aiTemplate && AI_TEMPLATES[state.aiTemplate]) {
    return { ...AI_TEMPLATES[state.aiTemplate].types };
  }
  const count = Math.max(1, Math.min(10, Number($(`#${prefix}-count`)?.value) || 3));
  const types = {};
  if ($(`#${prefix}-type-mcquiz`)?.checked) types.mcquiz = count;
  if ($(`#${prefix}-type-fastmcquiz`)?.checked) types.fastmcquiz = count;
  if ($(`#${prefix}-type-buzzin`)?.checked) types.buzzin = count;
  if ($(`#${prefix}-type-video`)?.checked) types.video = 1;
  return types;
}

function getAiGenerationSettings(prefix = "cms-ai") {
  const preset = prefix === "cms-ai" ? AI_TEMPLATES[state.aiTemplate] : null;
  return {
    langCode: state.editingCourse?.langCode || "en",
    difficulty: preset?.difficulty || $(`#${prefix}-difficulty`)?.value || "medium",
    types: getAiTypeCounts(prefix),
  };
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

async function extractMaterialRequest({ file, pasted, videoUrl, language }) {
  if (file) {
    const form = new FormData();
    form.append("file", file);
    form.append("language", language || state.editingCourse?.langCode || "en");
    const headers = { Accept: "application/json" };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    headers["X-Teacher-Id"] = String(state.user?.id || "");
    const res = await fetch("/api/cms/extract-material", { method: "POST", headers, body: form });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    if (!res.ok) throw new Error(parsed?.message || `Request failed (${res.status})`);
    return parsed;
  }

  return api("/api/cms/extract-material", {
    method: "POST",
    body: {
      text: pasted || undefined,
      videoUrl: videoUrl || undefined,
      language: language || state.editingCourse?.langCode || "en",
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
  const container = $("#cms-ai-preview");
  if (!container) return;

  if (!exercises?.length) {
    container.innerHTML = `<div class="cms-empty"><p class="cms-empty-title">No exercises yet</p><p class="cms-empty-copy">Go back and generate from your material.</p></div>`;
    return;
  }

  container.innerHTML = exercises
    .map((exercise, index) => renderAiEditableCard(exercise, index))
    .join("");
  wireAiVideoPreviews();
}

function renderAiEditableCard(exercise, index) {
  const type = exercise.type || "mcquiz";
  if (type === "video") {
    const videoUrl = exercise.items?.[0]?.videoUrl || "";
    return `
    <article class="cms-ai-preview-card cms-ai-edit-card" data-ai-index="${index}" data-type="video">
      <div class="cms-ai-preview-head">
        <input type="checkbox" class="cms-ai-select" data-ai-index="${index}" ${exercise.included === false ? "" : "checked"} aria-label="Include ${escapeHtml(exercise.title || "exercise")}" />
        <div class="cms-ai-preview-meta">
          <input type="text" class="cms-ai-edit-title" value="${escapeHtml(exercise.title || "")}" placeholder="Exercise title" />
          <p class="cms-ai-preview-sub">${escapeHtml(exercise.subTitle || exerciseTypeShortLabel("video"))}</p>
        </div>
        <button type="button" class="cms-row-btn cms-row-btn-quiet cms-ai-remove-exercise">Remove</button>
      </div>
      <label class="field">
        <span>Video URL</span>
        <input type="url" class="cms-ai-video-url" value="${escapeHtml(videoUrl)}" placeholder="https://..." />
      </label>
      ${cmsVideoPreviewMarkup(videoUrl)}
    </article>`;
  }

  const items = (exercise.items || [])
    .map((item, itemIndex) => renderAiEditableItem(type, item, index, itemIndex))
    .join("");
  return `
    <article class="cms-ai-preview-card cms-ai-edit-card" data-ai-index="${index}" data-type="${escapeHtml(type)}">
      <div class="cms-ai-preview-head">
        <input type="checkbox" class="cms-ai-select" data-ai-index="${index}" ${exercise.included === false ? "" : "checked"} aria-label="Include ${escapeHtml(exercise.title || "exercise")}" />
        <div class="cms-ai-preview-meta">
          <input type="text" class="cms-ai-edit-title" value="${escapeHtml(exercise.title || "")}" placeholder="Exercise title" />
          <p class="cms-ai-preview-sub">${escapeHtml(exercise.subTitle || type)}</p>
        </div>
        <button type="button" class="cms-row-btn cms-ai-regen-exercise">Regenerate</button>
        <button type="button" class="cms-row-btn cms-row-btn-quiet cms-ai-remove-exercise">Remove</button>
      </div>
      ${items}
      <button type="button" class="btn secondary small cms-ai-add-item">Add ${type === "buzzin" ? "prompt" : "question"}</button>
    </article>`;
}

function renderAiEditableItem(type, item, exerciseIndex, itemIndex) {
  if (type === "buzzin") {
    return `
      <div class="cms-ai-item-block" data-item-index="${itemIndex}">
        <input type="text" class="cms-ai-item-input" data-field="topic" value="${escapeHtml(item.topic || "")}" placeholder="Speaking prompt" />
        <input type="text" class="cms-ai-item-input" data-field="correctAnswer" value="${escapeHtml(item.correctAnswer || "")}" placeholder="Acceptable answer rubric" />
        <div class="cms-ai-item-toolbar">
          <button type="button" class="cms-row-btn cms-row-btn-quiet cms-ai-remove-item">Remove</button>
        </div>
      </div>`;
  }

  const options = (item.options || [])
    .map(
      (opt, optIndex) => `
        <div class="cms-ai-option-row">
          <input type="radio" name="cms-ai-correct-${exerciseIndex}-${itemIndex}" ${opt.isCorrect ? "checked" : ""} aria-label="Correct option" />
          <input type="text" class="cms-ai-opt-text" value="${escapeHtml(opt.text || "")}" placeholder="Option ${optIndex + 1}" />
        </div>`
    )
    .join("");

  return `
    <div class="cms-ai-item-block" data-item-index="${itemIndex}">
      <input type="text" class="cms-ai-item-input" data-field="title" value="${escapeHtml(item.title || "")}" placeholder="Question" />
      <label class="cms-ai-field field">
        <span>Seconds</span>
        <input type="number" class="cms-ai-item-time" min="5" max="60" value="${escapeHtml(String(item.timeLimit || (type === "fastmcquiz" ? 10 : 15)))}" />
      </label>
      ${options}
      <div class="cms-ai-item-toolbar">
        <button type="button" class="btn secondary small cms-ai-add-option">Add option</button>
        <button type="button" class="cms-row-btn cms-row-btn-quiet cms-ai-remove-item">Remove</button>
      </div>
    </div>`;
}

function collectAiDraftFromDom() {
  const container = $("#cms-ai-preview");
  if (!container) return state.aiDraftExercises || [];

  const exercises = [];
  container.querySelectorAll(".cms-ai-edit-card").forEach((card) => {
    const type = card.dataset.type || "mcquiz";
    const included = Boolean(card.querySelector(".cms-ai-select")?.checked);
    const title = card.querySelector(".cms-ai-edit-title")?.value.trim() || exerciseTypeShortLabel(type);
    const items = [];
    card.querySelectorAll(".cms-ai-item-block").forEach((block) => {
      if (type === "video") return;
      if (type === "buzzin") {
        const topic = block.querySelector('[data-field="topic"]')?.value.trim() || "";
        items.push({
          topic,
          correctAnswer:
            block.querySelector('[data-field="correctAnswer"]')?.value.trim() ||
            "Any clear, relevant spoken answer is acceptable.",
        });
        return;
      }
      const question = block.querySelector('[data-field="title"]')?.value.trim() || "";
      const options = [...block.querySelectorAll(".cms-ai-option-row")]
        .map((row) => ({
          text: row.querySelector(".cms-ai-opt-text")?.value.trim() || "",
          isCorrect: Boolean(row.querySelector('input[type="radio"]')?.checked),
        }))
        .filter((opt) => opt.text);
      items.push({
        title: question,
        options: ensureSingleCorrectOption(options),
        timeLimit: Number(block.querySelector(".cms-ai-item-time")?.value) || 15,
        image: null,
      });
    });
    if (type === "video") {
      const videoUrl = card.querySelector(".cms-ai-video-url")?.value.trim() || "";
      items.push({ videoUrl });
    }
    exercises.push({
      type,
      title,
      subTitle: exerciseSubTitleForType(type),
      items,
      included,
    });
  });
  state.aiDraftExercises = exercises;
  return exercises;
}

function renderAiPublishSummary() {
  const summary = $("#cms-ai-publish-summary");
  if (!summary) return;
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

async function extractAiMaterial() {
  const statusEl = $("#cms-ai-extract-status");
  const errorEl = $("#cms-ai-error");
  const previewEl = $("#cms-ai-material-preview");
  const btn = $("#btn-cms-ai-extract");
  if (!statusEl || !errorEl || !previewEl || !btn) return false;

  errorEl.textContent = "";
  statusEl.textContent = "Preparing material…";
  btn.disabled = true;

  try {
    const file = $("#cms-ai-file")?.files?.[0];
    const pasted = $("#cms-ai-paste")?.value.trim();
    const videoUrl = $("#cms-ai-video-url")?.value.trim();

    if (!file && !pasted && !videoUrl) {
      throw new Error("Paste text, upload a file, or provide a video URL.");
    }

    const data = await extractMaterialRequest({
      file,
      pasted,
      videoUrl,
      language: state.editingCourse?.langCode || "en",
    });

    state.aiMaterialText = data.text || "";
    previewEl.value = state.aiMaterialText;
    previewEl.hidden = !state.aiMaterialText;
    statusEl.textContent = data.truncated
      ? `Ready (${data.originalLength} chars, truncated for generation).`
      : `Ready (${state.aiMaterialText.length} chars).`;
    if (data.source === "video") {
      statusEl.textContent += data.captionUrl ? " Video transcribed." : " Video uploaded.";
    } else if (data.source === "audio") {
      statusEl.textContent += " Audio transcribed.";
    } else if (data.source === "image") {
      statusEl.textContent += " Image converted to markdown.";
    }
    return true;
  } catch (err) {
    statusEl.textContent = "";
    errorEl.textContent = err.message;
    return false;
  } finally {
    btn.disabled = false;
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

async function generateAiExercises() {
  const statusEl = $("#cms-ai-generate-status");
  const errorEl = $("#cms-ai-error");
  const btn = $("#btn-cms-ai-next");
  if (!statusEl || !errorEl) return false;

  let material = getAiMaterialText();
  const llmTypes = aiLlmTypeCounts();
  const wantsVideo = aiWantsVideo();
  const settings = getAiGenerationSettings();

  errorEl.textContent = "";
  if (!material) {
    const file = $("#cms-ai-file")?.files?.[0];
    const pasted = $("#cms-ai-paste")?.value.trim();
    const videoUrl = $("#cms-ai-video-url")?.value.trim();
    if (file || pasted || videoUrl) {
      const prepared = await extractAiMaterial();
      if (!prepared) return false;
      material = getAiMaterialText();
    }
  }
  if (!material) {
    errorEl.textContent = isAiVideoOnly()
      ? "Paste or upload a lesson script first."
      : "Prepare or paste source material first.";
    return false;
  }
  if (!Object.keys(llmTypes).length && !wantsVideo) {
    errorEl.textContent = "Select at least one exercise type.";
    return false;
  }

  statusEl.textContent =
    wantsVideo && !Object.keys(llmTypes).length ? "Generating video…" : "Generating exercises…";
  if (btn) btn.disabled = true;

  try {
    let exercises = [];

    if (Object.keys(llmTypes).length) {
      const data = await api("/api/cms/generate-exercises", {
        method: "POST",
        body: {
          material,
          langCode: settings.langCode,
          difficulty: settings.difficulty,
          types: llmTypes,
        },
      });
      exercises = data.exercises || [];
      const stats = data.stats || {};
      if (stats.partial) {
        statusEl.textContent = `Generated ${stats.generated || exercises.length} item(s) (partial).`;
      }
    }

    if (wantsVideo) {
      statusEl.textContent = "Generating video… this can take a few minutes.";
      const videoExercise = await createAiVideoExercise(material, {
        onUpdate: (data) => {
          if (data.status) {
            statusEl.textContent = `Video: ${data.status}${
              data.segmentsDone && data.segmentCount
                ? ` (${data.segmentsDone}/${data.segmentCount})`
                : ""
            }`;
          }
        },
      });
      exercises.push(videoExercise);
    }

    state.aiDraftExercises = exercises;
    renderAiPreview(state.aiDraftExercises);
    statusEl.textContent = exercises.length
      ? `Ready with ${exercises.length} exercise(s). Edit, then continue.`
      : "Nothing was generated.";
    return exercises.length > 0;
  } catch (err) {
    statusEl.textContent = "";
    errorEl.textContent = err.message;
    return false;
  } finally {
    if (btn) btn.disabled = false;
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

  syncExercisesFromDom();
  const section = state.sections[sectionIndex];
  if (!section) return 0;

  const picks = selectedAiExercises();
  if (!picks.length) {
    $("#cms-ai-error").textContent = "Select at least one generated exercise.";
    return 0;
  }

  if (!section.exercises) section.exercises = [];
  picks.forEach((exercise) => {
    const { included: _included, ...rest } = exercise;
    section.exercises.push({
      ...rest,
      order: section.exercises.length + 1,
    });
  });

  state.expandedExerciseIndex = section.exercises.length - 1;
  renderExerciseEditors({ insertedIndex: state.expandedExerciseIndex });
  return picks.length;
}

async function publishAiExercises() {
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
  if (!errorEl.textContent) {
    $("#cms-exercises-status").textContent = `Published ${added} exercise(s). Ready to host.`;
    resetAiGeneratePanel();
  }
}

async function handleAiWizardNext() {
  const errorEl = $("#cms-ai-error");
  if (errorEl) errorEl.textContent = "";
  const step = state.aiWizardStep;

  if (step === 1) {
    const types = getAiTypeCounts();
    if (!Object.keys(types).length) {
      errorEl.textContent = "Pick a template or at least one custom exercise type.";
      return;
    }
    setAiWizardStep(2);
    return;
  }

  if (step === 2) {
    const ok = await generateAiExercises();
    if (ok) setAiWizardStep(3);
    return;
  }

  if (step === 3) {
    const picks = selectedAiExercises();
    if (!picks.length) {
      errorEl.textContent = "Keep at least one exercise, or go back and generate again.";
      return;
    }
    setAiWizardStep(4);
  }
}

function handleAiWizardBack() {
  $("#cms-ai-error").textContent = "";
  setAiWizardStep(state.aiWizardStep - 1);
}

function defaultAiItem(type) {
  if (type === "buzzin") {
    return {
      topic: "Talk about this topic using words from the lesson.",
      correctAnswer: "Any clear, relevant spoken answer is acceptable.",
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
  const card = event.target.closest(".cms-ai-edit-card");
  if (!card) return;
  const index = Number(card.dataset.aiIndex);
  if (!Number.isFinite(index)) return;

  collectAiDraftFromDom();

  if (event.target.closest(".cms-ai-remove-exercise")) {
    state.aiDraftExercises.splice(index, 1);
    renderAiPreview(state.aiDraftExercises);
    return;
  }

  if (event.target.closest(".cms-ai-add-item")) {
    const exercise = state.aiDraftExercises[index];
    if (!exercise) return;
    exercise.items = exercise.items || [];
    exercise.items.push(defaultAiItem(exercise.type));
    renderAiPreview(state.aiDraftExercises);
    return;
  }

  if (event.target.closest(".cms-ai-remove-item")) {
    const block = event.target.closest(".cms-ai-item-block");
    const itemIndex = Number(block?.dataset.itemIndex);
    const exercise = state.aiDraftExercises[index];
    if (!exercise || !Number.isFinite(itemIndex)) return;
    exercise.items.splice(itemIndex, 1);
    if (!exercise.items.length) exercise.items.push(defaultAiItem(exercise.type));
    renderAiPreview(state.aiDraftExercises);
    return;
  }

  if (event.target.closest(".cms-ai-add-option")) {
    const block = event.target.closest(".cms-ai-item-block");
    const itemIndex = Number(block?.dataset.itemIndex);
    const item = state.aiDraftExercises[index]?.items?.[itemIndex];
    if (!item) return;
    item.options = item.options || [];
    if (item.options.length >= 6) return;
    item.options.push({ text: `Option ${item.options.length + 1}`, isCorrect: false });
    renderAiPreview(state.aiDraftExercises);
    return;
  }

  if (event.target.closest(".cms-ai-regen-exercise")) {
    regenerateAiExercise(index);
  }
}

async function regenerateAiExercise(index) {
  const errorEl = $("#cms-ai-error");
  const statusEl = $("#cms-ai-generate-status");
  collectAiDraftFromDom();
  const exercise = state.aiDraftExercises[index];
  const material = getAiMaterialText();
  if (!exercise || !material) {
    errorEl.textContent = "Need source material to regenerate this exercise.";
    return;
  }

  statusEl.textContent = "Regenerating…";
  try {
    const data = await api("/api/cms/generate-exercises", {
      method: "POST",
      body: {
        material,
        langCode: state.editingCourse?.langCode || "en",
        difficulty: getAiGenerationSettings().difficulty,
        types: { [exercise.type]: Math.max(1, exercise.items?.length || 1) },
      },
    });
    const next = data.exercises?.find((entry) => entry.type === exercise.type) || data.exercises?.[0];
    if (!next) throw new Error("Regeneration returned no exercise.");
    state.aiDraftExercises[index] = next;
    renderAiPreview(state.aiDraftExercises);
    statusEl.textContent = "Exercise regenerated.";
    errorEl.textContent = "";
  } catch (err) {
    statusEl.textContent = "";
    errorEl.textContent = err.message;
  }
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
  resetAiGeneratePanel();
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


$("#nav-cms-dashboard")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!state.token || !state.user) return;
  enterDashboard();
});
$("#nav-cms-courses")?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!state.token || !state.user) return;
  enterCourseList();
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
$("#btn-cms-ai-extract")?.addEventListener("click", extractAiMaterial);
$("#btn-cms-ai-next")?.addEventListener("click", handleAiWizardNext);
$("#btn-cms-ai-back")?.addEventListener("click", handleAiWizardBack);
$("#btn-cms-ai-publish")?.addEventListener("click", publishAiExercises);
$("#cms-ai-wizard")?.addEventListener("change", (event) => {
  if (event.target.matches("#cms-ai-type-mcquiz, #cms-ai-type-fastmcquiz, #cms-ai-type-buzzin, #cms-ai-type-video")) {
    if (state.aiTemplate !== "custom") {
      state.aiTemplate = "custom";
      document.querySelectorAll(".cms-ai-template").forEach((btn) => {
        btn.classList.toggle("is-selected", btn.dataset.template === "custom");
      });
      const custom = $("#cms-ai-custom-settings");
      if (custom) custom.hidden = false;
    }
    syncAiWizardCopy();
    if (state.aiWizardStep === 2) {
      const nextBtn = $("#btn-cms-ai-next");
      if (nextBtn) nextBtn.textContent = isAiVideoOnly() ? "Generate video" : "Generate";
    }
  }
});
$("#cms-ai-wizard")?.addEventListener("click", (event) => {
  const template = event.target.closest(".cms-ai-template");
  if (template?.dataset.template) {
    applyAiTemplate(template.dataset.template);
    return;
  }
  const stepBtn = event.target.closest(".cms-ai-step");
  if (stepBtn) {
    const target = Number(stepBtn.dataset.step);
    if (stepBtn.disabled || target > state.aiWizardStep) return;
    setAiWizardStep(target);
    return;
  }
  handleAiPreviewClick(event);
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
updateAuthUi();
applyTeacherLoginDefaults(
  $("#cms-login-username"),
  $("#cms-login-password"),
  state.loginUsername
);

if (state.token && state.user) {
  enterDashboard();
} else {
  showCmsScreen("login");
}
