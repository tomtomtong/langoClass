const STORAGE_KEY = "lango_host_prefs";

const state = {
  token: null,
  user: null,
  loginUsername: "",
  courses: [],
  classes: [],
  editingCourse: null,
  sections: [],
  editingSectionIndex: null,
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

function showCmsScreen(id) {
  document.querySelectorAll(".cms-app .screen").forEach((s) => s.classList.remove("active"));
  document.querySelector(`#screen-cms-${id}`).classList.add("active");
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
  const bannerUrl = (url || "").trim();
  if (!preview || !img) return;

  if (bannerUrl) {
    img.src = bannerUrl;
    preview.hidden = false;
  } else {
    img.removeAttribute("src");
    preview.hidden = true;
  }
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
  $("#cms-list-status").textContent = "Loading courses…";
  $("#cms-course-list").innerHTML = "";

  try {
    await loadClasses();
    const data = await api("/api/cms/courses");
    state.courses = data.courses || [];
    renderCourseList();
    $("#cms-list-status").textContent = state.courses.length
      ? `${state.courses.length} course${state.courses.length === 1 ? "" : "s"}`
      : "No courses yet — create your first one.";
  } catch (err) {
    $("#cms-list-status").textContent = "";
    $("#cms-list-error").textContent = err.message;
  }
}

function renderCourseList() {
  const container = $("#cms-course-list");
  if (!state.courses.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = state.courses
    .map((course) => {
      const banner = courseBannerUrl(course);
      const thumb = banner
        ? `<img class="cms-course-card-thumb" src="${escapeHtml(banner)}" alt="" />`
        : `<span class="cms-course-card-thumb cms-course-card-thumb--empty" aria-hidden="true"></span>`;
      return `<button type="button" class="cms-course-card" data-id="${course.id}">
        ${thumb}
        <span class="cms-course-card-body">
          <span class="cms-course-card-title">${escapeHtml(course.name)}</span>
          <span class="cms-course-card-meta">${course.exerciseCount || 0} exercise${course.exerciseCount === 1 ? "" : "s"} · ${escapeHtml(assignedClassesLabel(course))}</span>
          ${course.description ? `<span class="cms-course-card-desc">${escapeHtml(course.description)}</span>` : ""}
        </span>
      </button>`;
    })
    .join("");

  container.querySelectorAll(".cms-course-card").forEach((btn) => {
    btn.addEventListener("click", () => openCourseEditor(Number(btn.dataset.id)));
  });
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

function collectExerciseFromCard(card) {
  const type = card.dataset.type || "mcquiz";
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

function openSectionExercises(sectionIndex) {
  syncSectionsMetadataFromDom();
  const section = state.sections[sectionIndex];
  if (!section) return;

  const resolvedIndex =
    section.id != null ? state.sections.findIndex((s) => s.id === section.id) : sectionIndex;
  state.editingSectionIndex = resolvedIndex >= 0 ? resolvedIndex : sectionIndex;

  const activeSection = state.sections[state.editingSectionIndex];
  $("#cms-exercises-section-title").textContent =
    activeSection?.title?.trim() || `Section ${state.editingSectionIndex + 1}`;
  $("#cms-sections-view").hidden = true;
  $("#cms-exercises-view").hidden = false;
  $("#cms-exercises-error").textContent = "";
  $("#cms-exercises-status").textContent = "";
  renderExerciseEditors();
}

function closeSectionExercises({ reRender = true } = {}) {
  if (state.editingSectionIndex != null) syncExercisesFromDom();
  state.editingSectionIndex = null;
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
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });
  document.querySelectorAll(".cms-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `cms-tab-${tabId}`);
  });

  if (tabId === "sections") renderSectionEditors();
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
      items: [{ topic: "What is your favorite animal?" }],
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
      items: [{ topic: "Name an animal that lives in the ocean and say why you like it." }],
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
    img.removeAttribute("src");
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
            ${(item.options || [])
              .map(
                (opt, oIdx) => `<label class="cms-option-row">
                  <input type="radio" name="correct-${qIdx}" data-q="${qIdx}" data-o="${oIdx}" ${opt.isCorrect ? "checked" : ""} />
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
      if (!options.some((o) => o.isCorrect) && options.length) options[0].isCorrect = true;
      return { title, image: image || null, options, timeLimit };
    });
}

function renderVideoBody(container, exercise) {
  const url = exercise.items?.[0]?.videoUrl || "";
  container.innerHTML = `<label class="field">
    <span>Video URL</span>
    <input type="url" class="cms-video-url" value="${escapeHtml(url)}" placeholder="https://..." />
  </label>`;
  container._collectItems = () => {
    const videoUrl = container.querySelector(".cms-video-url")?.value.trim() || "";
    return videoUrl ? [{ videoUrl }] : [];
  };
}

function renderBuzzinBody(container, exercise) {
  const item = exercise.items?.[0] || {};
  const topic =
    item.topic || collectBuzzinQuestions(exercise)[0] || item.title || exercise.title || "";
  container.innerHTML = `
    <label class="field">
      <span>Topic</span>
      <input type="text" class="cms-buzzin-topic" value="${escapeHtml(topic)}" placeholder="What should students discuss?" />
    </label>`;

  container._collectItems = () => {
    const nextTopic = container.querySelector(".cms-buzzin-topic")?.value.trim() || "";
    return nextTopic ? [{ topic: nextTopic }] : [];
  };
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

function renderExerciseCard(exercise, sectionIndex, exerciseIndex, exercisesContainer) {
  const tpl = document.getElementById("tpl-exercise-editor");
  const card = tpl.content.firstElementChild.cloneNode(true);
  card.dataset.sectionIndex = String(sectionIndex);
  card.dataset.exerciseIndex = String(exerciseIndex);
  if (exercise.id != null) card.dataset.exerciseId = String(exercise.id);

  card.querySelector('[data-field="title"]').value = exercise.title || "";
  card.querySelector(".cms-exercise-order").value = String(exercise.order ?? exerciseIndex + 1);
  card.querySelector('[data-field="subTitle"]').value = exercise.subTitle || "";
  card.querySelector(".cms-exercise-order").addEventListener("change", () => {
    syncExercisesFromDom();
    renderExerciseEditors();
  });

  renderExerciseBody(card, exercise);

  const previewLink = card.querySelector(".cms-exercise-preview");
  if (previewLink) {
    previewLink.href = joinPreviewUrl(joinPreviewLayoutForExercise(exercise));
  }

  card.querySelector(".cms-remove-exercise").addEventListener("click", () => {
    const exerciseId = card.dataset.exerciseId;
    syncExercisesFromDom();
    const exercises = state.sections[sectionIndex]?.exercises || [];
    let removeIndex =
      exerciseId != null ? exercises.findIndex((ex) => String(ex.id) === exerciseId) : exerciseIndex;
    if (removeIndex >= 0) exercises.splice(removeIndex, 1);
    renderExerciseEditors();
  });

  setupExerciseDrag(card, exercisesContainer);
  exercisesContainer.appendChild(card);
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
        statusEl.textContent = "Section needs an ID — save sections first.";
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

    const exerciseCount = (section.exercises || []).length;
    sectionCard.querySelector(".cms-section-exercise-count").textContent =
      `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"}`;

    sectionCard.querySelector(".cms-manage-exercises").addEventListener("click", () => {
      openSectionExercises(sectionIndex);
    });

    setupSectionDrag(sectionCard, container);
    container.appendChild(sectionCard);
  });
}

function renderExerciseEditors() {
  const container = $("#cms-exercise-list");
  if (!container) return;
  container.innerHTML = "";

  const sectionIndex = state.editingSectionIndex;
  if (sectionIndex == null) return;

  const section = state.sections[sectionIndex];
  if (!section) return;

  const exercises = section.exercises || [];
  if (!exercises.length) {
    container.innerHTML = `<p class="hint">No exercises yet. Choose a type and click “Add exercise”.</p>`;
    return;
  }

  exercises.forEach((exercise, exerciseIndex) => {
    renderExerciseCard(exercise, sectionIndex, exerciseIndex, container);
  });
}

function setupSectionDrag(sectionCard, container) {
  sectionCard.addEventListener("dragstart", (e) => {
    if (e.target.closest(".cms-exercise-card")) return;
    sectionCard.classList.add("dragging-section");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sectionCard.dataset.sectionIndex);
  });

  sectionCard.addEventListener("dragend", () => {
    sectionCard.classList.remove("dragging-section");
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
  card.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.exerciseIndex);
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
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
  syncExercisesFromDom();
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
    state.sections = sortSectionsByOrder(
      (data.sections || []).map((section) => ({
        ...section,
        exercises: (section.exercises || []).map((exercise) => ({ ...exercise })),
      }))
    );
    closeSectionExercises({ reRender: false });
    renderSectionEditors();
    statusEl.textContent = successMessage;
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

function addExercise() {
  const sectionIndex = state.editingSectionIndex;
  if (sectionIndex == null) return;

  syncExercisesFromDom();
  const { type, demo } = parseNewExerciseSelection($("#cms-new-exercise-type")?.value);
  const section = state.sections[sectionIndex];
  if (!section) return;

  if (!section.exercises) section.exercises = [];
  const exercise = demo ? demoExercise(type) : defaultExercise(type);
  exercise.order = section.exercises.length + 1;
  section.exercises.push(exercise);
  renderExerciseEditors();
}

$("#btn-cms-login").addEventListener("click", handleLogin);
$("#cms-login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});
$("#btn-cms-logout").addEventListener("click", handleLogout);
$("#btn-new-course").addEventListener("click", createNewCourse);
$("#btn-back-list").addEventListener("click", () => enterCourseList());
$("#btn-save-details").addEventListener("click", saveDetails);
$("#btn-delete-course").addEventListener("click", deleteCourse);
$("#course-banner-file").addEventListener("change", handleBannerFileChange);
$("#btn-remove-banner").addEventListener("click", handleRemoveBanner);
$("#btn-add-section").addEventListener("click", addSection);
$("#btn-add-exercise").addEventListener("click", addExercise);
$("#btn-back-sections").addEventListener("click", () => closeSectionExercises());
$("#btn-save-sections").addEventListener("click", saveSections);
$("#btn-save-exercises").addEventListener("click", saveExercises);

document.querySelectorAll(".cms-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

loadPrefs();
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
