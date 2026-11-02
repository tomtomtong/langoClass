const STORAGE_KEY = "lango_host_prefs";

const state = {
  token: null,
  user: null,
  loginUsername: "",
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
    $("#config-login-username")?.value.trim().toLowerCase() || state.loginUsername || "";
  if (loginUsername) state.loginUsername = loginUsername;

  let data = {};
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
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
  if (state.user?.id) headers["X-Teacher-Id"] = String(state.user.id);
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

function showConfigScreen(id) {
  document.querySelectorAll(".config-app .screen").forEach((s) => s.classList.remove("active"));
  document.querySelector(`#screen-config-${id}`).classList.add("active");
}

function updateAuthUi() {
  const loggedIn = !!(state.token && state.user);
  $("#config-teacher-label").hidden = !loggedIn;
  $("#btn-config-logout").hidden = !loggedIn;
  if (loggedIn) {
    $("#config-teacher-label").textContent = `Logged in as ${teacherDisplayName()}`;
  }
}

function renderTtsRouting(data) {
  const routing = data.ttsRouting || {};
  const classroom = routing.classroom || {};
  const elderly = routing.elderly || {};
  const classroomEl = $("#config-tts-classroom");
  const elderlyEl = $("#config-tts-elderly");
  const currentEl = $("#config-tts-current");
  if (classroomEl) {
    classroomEl.textContent = `${classroom.provider || "Inworld"} · ${classroom.model || "—"} · voice ${classroom.voice || "—"}`;
  }
  if (elderlyEl) {
    elderlyEl.textContent = `${elderly.provider || "OpenRouter"} · ${elderly.model || "—"} · voice ${elderly.voice || "—"}`;
  }
  if (currentEl) {
    const current = routing.current || {};
    const app = routing.currentVariant === "elderly" ? "HK Elderly" : "Classroom";
    currentEl.textContent = `${app} (${current.provider || "—"} · ${current.model || "—"} · voice ${current.voice || "—"})`;
  }
}

function renderConfig(data) {
  $("#config-tts-provider").value = data.gameplayTtsProvider || "";
  $("#config-elevenlabs-voice").value = data.elevenlabsVoiceId || "";
  $("#config-elevenlabs-stability").value = data.elevenlabsStability ?? 0.5;

  renderTtsRouting(data);

  $("#config-inworld-stt-model").value = data.inworldSttModelSaved || "";
  $("#config-inworld-stt-model-effective").textContent = data.effectiveInworldSttModel || "—";
  $("#config-inworld-stt-model-env-default").textContent = data.inworldSttModelEnvDefault || "—";
  $("#config-openrouter-generate-model").value = data.openrouterGenerateModelSaved || "";
  $("#config-openrouter-generate-model-effective").textContent =
    data.effectiveOpenRouterGenerateModel || "—";
  $("#config-openrouter-generate-model-env-default").textContent =
    data.openrouterGenerateModelEnvDefault || "—";

  $("#config-openrouter-tts-model").value = data.openrouterTtsModelSaved || "";
  $("#config-openrouter-tts-model-effective").textContent =
    data.effectiveOpenRouterTtsModel || "—";
  $("#config-openrouter-tts-model-env-default").textContent =
    data.openrouterTtsModelEnvDefault || "—";

  $("#config-video-generator-url").value = data.videoGeneratorApiUrlSaved || "";
  $("#config-video-generator-url-effective").textContent =
    data.effectiveVideoGeneratorApiUrl || "—";
  $("#config-video-generator-url-env-default").textContent =
    data.videoGeneratorApiUrlEnvDefault || "—";

  renderStudentDatabaseStats(data.studentDatabase);
}

function renderStudentDatabaseStats(stats) {
  const studentCount = stats?.studentCount ?? 0;
  const recordCount = stats?.recordCount ?? 0;
  $("#config-student-db-count").textContent = String(studentCount);
  $("#config-student-db-records").textContent = String(recordCount);
}

async function saveSpeechSettings() {
  const btn = $("#btn-config-save-tts");
  $("#config-tts-error").textContent = "";
  $("#config-tts-status").textContent = "";
  const stabilityInput = $("#config-elevenlabs-stability");
  stabilityInput.removeAttribute("aria-invalid");
  if (!stabilityInput.value.trim() || !stabilityInput.reportValidity()) {
    stabilityInput.setAttribute("aria-invalid", "true");
    $("#config-tts-error").textContent = "Enter stability between 0 and 1.";
    return;
  }
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: {
        gameplayTtsProvider: $("#config-tts-provider").value,
        elevenlabsVoiceId: $("#config-elevenlabs-voice").value.trim(),
        elevenlabsStability: Number(stabilityInput.value),
      },
    });
    renderConfig(data);
    $("#config-tts-preview").pause();
    $("#config-tts-preview").hidden = true;
    $("#config-tts-status").textContent = `Speech settings saved: ${data.effectiveGameplayTtsProvider}.`;
  } catch (err) {
    $("#config-tts-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function testSpeechSettings() {
  const btn = $("#btn-config-test-tts");
  const preview = $("#config-tts-preview");
  preview.pause();
  preview.hidden = true;
  $("#config-tts-error").textContent = "";
  $("#config-tts-status").textContent = "Generating speech sample…";
  btn.disabled = true;
  try {
    const data = await api("/api/config/test-gameplay-tts", { method: "POST", body: {} });
    preview.src = `data:audio/mpeg;base64,${data.audioContent}`;
    preview.hidden = false;
    $("#config-tts-status").textContent = `Speech test succeeded (${data.provider}, ${data.latencyMs} ms). Press play to listen.`;
  } catch (err) {
    $("#config-tts-status").textContent = "";
    $("#config-tts-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveVideoGeneratorApiUrl(videoGeneratorApiUrl) {
  $("#config-video-generator-error").textContent = "";
  $("#config-video-generator-save-status").textContent = "";

  const btn = $("#btn-config-save-video-generator-url");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { videoGeneratorApiUrl },
    });
    renderConfig(data);
    $("#config-video-generator-save-status").textContent = videoGeneratorApiUrl
      ? `Video API URL saved: ${data.effectiveVideoGeneratorApiUrl}`
      : "Saved URL cleared. Using environment default.";
  } catch (err) {
    $("#config-video-generator-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

const MODEL_FIELDS = {
  openrouterGenerateModel: "#config-openrouter-generate-model",
  inworldSttModel: "#config-inworld-stt-model",
  openrouterTtsModel: "#config-openrouter-tts-model",
};

async function saveModels({ reset = false } = {}) {
  $("#config-models-error").textContent = "";
  $("#config-models-status").textContent = "";
  const body = {};
  for (const [name, selector] of Object.entries(MODEL_FIELDS)) {
    if (reset) $(selector).value = "";
    body[name] = $(selector).value.trim();
  }

  const btn = $(reset ? "#btn-config-reset-models" : "#btn-config-save-models");
  btn.disabled = true;
  try {
    const data = await api("/api/config", { method: "PUT", body });
    renderConfig(data);
    $("#config-models-status").textContent = reset ? "Models reset to defaults." : "Models saved.";
  } catch (err) {
    $("#config-models-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function loadConfig() {
  $("#config-error").textContent = "";
  const data = await api("/api/config");
  renderConfig(data);
}

async function handleLogin() {
  const username = $("#config-login-username").value.trim().toLowerCase();
  const password = $("#config-login-password").value;
  $("#config-login-error").textContent = "";

  if (!username || !password) {
    $("#config-login-error").textContent = "Enter username and password.";
    return;
  }

  const btn = $("#btn-config-login");
  btn.disabled = true;
  try {
    const data = await api("/api/lango/login", {
      method: "POST",
      body: { login: username, username, password },
    });
    const token = data.token || data.user?.token;
    if (!token || !data.user?.id) throw new Error("Login succeeded but no token returned.");

    state.token = token;
    state.user = { ...data.user, token };
    state.loginUsername = username;
    savePrefs();
    updateAuthUi();
    showConfigScreen("main");
    await loadConfig();
  } catch (err) {
    $("#config-login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function handleLogout() {
  state.token = null;
  state.user = null;
  savePrefs();
  updateAuthUi();
  showConfigScreen("login");
  applyTeacherLoginDefaults(
    $("#config-login-username"),
    $("#config-login-password"),
    state.loginUsername
  );
}

async function clearStudentDatabase() {
  const stats = {
    studentCount: Number($("#config-student-db-count").textContent) || 0,
    recordCount: Number($("#config-student-db-records").textContent) || 0,
  };

  if (!stats.studentCount && !stats.recordCount) {
    $("#config-student-db-status").textContent = "Student database is already empty.";
    $("#config-student-db-error").textContent = "";
    return;
  }

  const message =
    `Delete all ${stats.studentCount} student profile${stats.studentCount === 1 ? "" : "s"} ` +
    `and ${stats.recordCount} score record${stats.recordCount === 1 ? "" : "s"}? ` +
    "This cannot be undone.";
  if (!confirm(message)) return;

  $("#config-student-db-error").textContent = "";
  $("#config-student-db-status").textContent = "";

  const btn = $("#btn-config-clear-student-db");
  btn.disabled = true;
  try {
    const data = await api("/api/config/clear-student-database", { method: "POST" });
    renderStudentDatabaseStats(data.studentDatabase);
    const cleared = data.cleared || {};
    $("#config-student-db-status").textContent =
      `Cleared ${cleared.students ?? 0} student profile${cleared.students === 1 ? "" : "s"} ` +
      `and ${cleared.records ?? 0} score record${cleared.records === 1 ? "" : "s"}.`;
  } catch (err) {
    $("#config-student-db-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  loadPrefs();
  updateAuthUi();

  applyTeacherLoginDefaults(
    $("#config-login-username"),
    $("#config-login-password"),
    state.loginUsername
  );

  $("#btn-config-login").addEventListener("click", handleLogin);
  $("#btn-config-logout").addEventListener("click", handleLogout);
  $("#btn-config-save-models").addEventListener("click", () => saveModels());
  $("#btn-config-reset-models").addEventListener("click", () => saveModels({ reset: true }));
  $("#btn-config-save-tts").addEventListener("click", saveSpeechSettings);
  $("#btn-config-test-tts").addEventListener("click", testSpeechSettings);
  $("#btn-config-save-video-generator-url").addEventListener("click", () => {
    saveVideoGeneratorApiUrl($("#config-video-generator-url").value.trim());
  });
  $("#btn-config-reset-video-generator-url").addEventListener("click", () => {
    $("#config-video-generator-url").value = "";
    saveVideoGeneratorApiUrl("");
  });
  $("#btn-config-clear-student-db").addEventListener("click", clearStudentDatabase);

  if (state.token && state.user) {
    showConfigScreen("main");
    try {
      await loadConfig();
    } catch (err) {
      $("#config-error").textContent = err.message;
    }
  } else {
    showConfigScreen("login");
  }
}

init();
