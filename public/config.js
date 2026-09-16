const STORAGE_KEY = "lango_host_prefs";

const state = {
  token: null,
  user: null,
  loginUsername: "",
  envDefault: "",
  effectivePublicBaseUrl: "",
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

const CONFIG_TABS = ["notifications", "inworld", "azure", "openrouter", "video", "database"];

function setConfigTab(tabId, { updateHash = true } = {}) {
  const tab = CONFIG_TABS.includes(tabId) ? tabId : "notifications";
  document.querySelectorAll(".config-section-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.configTab === tab);
  });
  document.querySelectorAll(".config-section-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.configPanel === tab);
  });
  if (updateHash && window.location.hash !== `#${tab}`) {
    history.replaceState(null, "", `#${tab}`);
  }
}

function initConfigTabs() {
  document.querySelector(".config-section-nav")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".config-section-tab");
    if (!btn) return;
    setConfigTab(btn.dataset.configTab);
  });

  const hashTab = window.location.hash.replace(/^#/, "");
  if (CONFIG_TABS.includes(hashTab)) {
    setConfigTab(hashTab, { updateHash: false });
  }
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
    currentEl.textContent =
      routing.currentVariant === "elderly"
        ? `HK Elderly (${elderly.provider || "OpenRouter"} ${elderly.model || "—"})`
        : `Classroom (${classroom.provider || "Inworld"} ${classroom.model || "—"})`;
  }
}

function renderConfig(data) {
  state.envDefault = data.envDefault || "";
  state.effectivePublicBaseUrl = data.effectivePublicBaseUrl || "";
  $("#config-public-base-url").value = data.publicBaseUrl || "";
  $("#config-effective-url").textContent = state.effectivePublicBaseUrl || "—";
  $("#config-env-default").textContent = state.envDefault || "—";
  $("#config-preview-json").textContent = JSON.stringify(
    data.notificationPreview || { base_endpoint: state.effectivePublicBaseUrl },
    null,
    2
  );
  renderTtsRouting(data);

  const inworldConfigured = !!data.inworldApiKeyConfigured;
  const inworldSaved = !!data.inworldApiKeySaved;
  $("#config-inworld-status-label").textContent = inworldConfigured
    ? "Configured"
    : "Not configured";
  $("#config-inworld-masked").textContent = inworldConfigured
    ? data.inworldApiKeyMasked || "—"
    : "—";
  $("#config-inworld-env-hint").hidden =
    !data.inworldEnvDefaultConfigured || inworldSaved;

  if (inworldSaved) {
    $("#config-inworld-key").placeholder = "Key saved — paste to replace";
  } else {
    $("#config-inworld-key").placeholder = "Paste key here";
  }

  $("#config-inworld-llm-model").value = data.inworldLlmModelSaved || "";
  $("#config-inworld-llm-effective").textContent = data.effectiveInworldLlmModel || "—";
  $("#config-inworld-llm-env-default").textContent = data.inworldLlmModelEnvDefault || "—";

  $("#config-inworld-stt-model").value = data.inworldSttModelSaved || "";
  $("#config-inworld-stt-model-effective").textContent = data.effectiveInworldSttModel || "—";
  $("#config-inworld-stt-model-env-default").textContent = data.inworldSttModelEnvDefault || "—";
  $("#config-inworld-stt-language").value = data.inworldSttLanguageSaved || "";
  $("#config-inworld-stt-language-effective").textContent = data.effectiveInworldSttLanguage || "—";
  $("#config-inworld-stt-language-env-default").textContent = data.inworldSttLanguageEnvDefault || "—";

  const azureConfigured = !!data.azureConfigured;
  const azureSaved = !!data.azureApiKeySaved;
  $("#config-azure-status-label").textContent = azureConfigured ? "Configured" : "Not configured";
  $("#config-azure-masked").textContent = data.azureApiKeyConfigured
    ? data.azureApiKeyMasked || "—"
    : "—";
  $("#config-azure-env-hint").hidden = !data.azureEnvDefaultConfigured || azureSaved;

  if (azureSaved) {
    $("#config-azure-key").placeholder = "Key saved — paste to replace";
  } else {
    $("#config-azure-key").placeholder = "Paste key here";
  }

  $("#config-azure-endpoint").value = data.azureEndpointSaved || "";
  $("#config-azure-endpoint-effective").textContent = data.effectiveAzureEndpoint || "—";
  $("#config-azure-endpoint-env-default").textContent = data.azureEndpointEnvDefault || "—";

  $("#config-azure-deployment").value = data.azureDeploymentSaved || "";
  $("#config-azure-deployment-effective").textContent = data.effectiveAzureDeployment || "—";
  $("#config-azure-deployment-env-default").textContent = data.azureDeploymentEnvDefault || "—";

  $("#config-azure-api-version").value = data.azureApiVersionSaved || "";
  $("#config-azure-api-version-effective").textContent = data.effectiveAzureApiVersion || "—";
  $("#config-azure-api-version-env-default").textContent = data.azureApiVersionEnvDefault || "—";

  // #region agent log
  fetch("http://127.0.0.1:7494/ingest/d3173f1c-308f-4084-8487-8b236a140c93", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d0607f" },
    body: JSON.stringify({
      sessionId: "d0607f",
      location: "config.js:renderConfig",
      message: "Azure config rendered",
      data: { azureConfigured, azureSaved, hasEndpoint: !!data.effectiveAzureEndpoint },
      timestamp: Date.now(),
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion

  const openrouterConfigured = !!data.openrouterApiKeyConfigured;
  const openrouterSaved = !!data.openrouterApiKeySaved;
  $("#config-openrouter-status-label").textContent = openrouterConfigured
    ? "Configured"
    : "Not configured";
  $("#config-openrouter-masked").textContent = openrouterConfigured
    ? data.openrouterApiKeyMasked || "—"
    : "—";
  $("#config-openrouter-env-hint").hidden =
    !data.openrouterEnvDefaultConfigured || openrouterSaved;

  if (openrouterSaved) {
    $("#config-openrouter-key").placeholder = "Key saved — paste to replace";
  } else {
    $("#config-openrouter-key").placeholder = "Paste key here";
  }

  $("#config-openrouter-buzzin-model").value = data.openrouterBuzzinModelSaved || "";
  $("#config-openrouter-buzzin-model-effective").textContent =
    data.effectiveOpenRouterBuzzinModel || "—";
  $("#config-openrouter-buzzin-model-env-default").textContent =
    data.openrouterBuzzinModelEnvDefault || "—";

  $("#config-openrouter-generate-model").value = data.openrouterGenerateModelSaved || "";
  $("#config-openrouter-generate-model-effective").textContent =
    data.effectiveOpenRouterGenerateModel || "—";
  $("#config-openrouter-generate-model-env-default").textContent =
    data.openrouterGenerateModelEnvDefault || "—";

  $("#config-openrouter-vision-model").value = data.openrouterVisionModelSaved || "";
  $("#config-openrouter-vision-model-effective").textContent =
    data.effectiveOpenRouterVisionModel || "—";
  $("#config-openrouter-vision-model-env-default").textContent =
    data.openrouterVisionModelEnvDefault || "—";

  const visionModelSaved = !!(data.openrouterVisionModelSaved || "").trim();
  const visionNeedsKeyHint = $("#config-openrouter-vision-needs-key");
  if (visionNeedsKeyHint) {
    visionNeedsKeyHint.hidden = !(visionModelSaved && !openrouterConfigured);
    if (!visionNeedsKeyHint.hidden) {
      visionNeedsKeyHint.textContent = `Vision model ${data.effectiveOpenRouterVisionModel || data.openrouterVisionModelSaved} is saved, but no OpenRouter API key is stored yet. Scanned PDFs and images need both — click Save key above.`;
    }
  }

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

function clearInworldTestResult() {
  $("#config-inworld-test-wrap").hidden = true;
  $("#config-inworld-test-result").textContent = "";
}

function clearAzureTestResult() {
  $("#config-azure-test-wrap").hidden = true;
  $("#config-azure-test-result").textContent = "";
}

function clearOpenRouterTestResult() {
  $("#config-openrouter-test-wrap").hidden = true;
  $("#config-openrouter-test-result").textContent = "";
}

async function saveInworldLlmModel(inworldLlmModel) {
  $("#config-inworld-error").textContent = "";
  $("#config-inworld-save-status").textContent = "";
  clearInworldTestResult();

  const btn = $("#btn-config-save-inworld-model");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { inworldLlmModel },
    });
    renderConfig(data);
    $("#config-inworld-save-status").textContent = inworldLlmModel
      ? `LLM model saved: ${data.effectiveInworldLlmModel}`
      : "Saved LLM model cleared. Using environment default.";
  } catch (err) {
    $("#config-inworld-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveInworldSttSettings(inworldSttModel, inworldSttLanguage) {
  $("#config-inworld-error").textContent = "";
  $("#config-inworld-save-status").textContent = "";
  clearInworldTestResult();

  const btn = $("#btn-config-save-inworld-stt");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { inworldSttModel, inworldSttLanguage },
    });
    renderConfig(data);
    $("#config-inworld-save-status").textContent =
      `STT settings saved: ${data.effectiveInworldSttModel} (${data.effectiveInworldSttLanguage})`;
  } catch (err) {
    $("#config-inworld-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveInworldKey(inworldApiKey) {
  $("#config-inworld-error").textContent = "";
  $("#config-inworld-save-status").textContent = "";
  clearInworldTestResult();

  const btn = $("#btn-config-save-inworld");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { inworldApiKey },
    });
    renderConfig(data);
    $("#config-inworld-key").value = "";
    $("#config-inworld-save-status").textContent = inworldApiKey
      ? "Inworld key saved."
      : "Saved key cleared. Using environment default if set.";
  } catch (err) {
    $("#config-inworld-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function testInworldKey() {
  $("#config-inworld-error").textContent = "";
  $("#config-inworld-save-status").textContent = "";
  clearInworldTestResult();

  const inputKey = $("#config-inworld-key").value.trim();
  const inputModel = $("#config-inworld-llm-model").value.trim();
  const btn = $("#btn-config-test-inworld");
  btn.disabled = true;
  try {
    const body = {};
    if (inputKey) body.inworldApiKey = inputKey;
    if (inputModel) body.inworldLlmModel = inputModel;
    const data = await api("/api/config/test-inworld", {
      method: "POST",
      body,
    });
    $("#config-inworld-test-wrap").hidden = false;
    $("#config-inworld-test-result").textContent = JSON.stringify(data, null, 2);
    const ttsMs = data.tts?.latencyMs ?? "—";
    const llmMs = data.llm?.latencyMs ?? "—";
    const sttMs = data.stt?.latencyMs ?? "—";
    $("#config-inworld-save-status").textContent =
      `API test succeeded (TTS ${ttsMs} ms, STT ${sttMs} ms, LLM ${llmMs} ms).`;
  } catch (err) {
    $("#config-inworld-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveAzureSettings({ azureEndpoint, azureDeployment, azureApiVersion }) {
  $("#config-azure-error").textContent = "";
  $("#config-azure-save-status").textContent = "";
  clearAzureTestResult();

  const btn = $("#btn-config-save-azure-settings");
  btn.disabled = true;
  try {
    const body = {};
    if (azureEndpoint !== undefined) body.azureEndpoint = azureEndpoint;
    if (azureDeployment !== undefined) body.azureDeployment = azureDeployment;
    if (azureApiVersion !== undefined) body.azureApiVersion = azureApiVersion;
    const data = await api("/api/config", {
      method: "PUT",
      body,
    });
    renderConfig(data);
    $("#config-azure-save-status").textContent = "Azure settings saved.";
  } catch (err) {
    $("#config-azure-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveAzureKey(azureApiKey) {
  $("#config-azure-error").textContent = "";
  $("#config-azure-save-status").textContent = "";
  clearAzureTestResult();

  const btn = $("#btn-config-save-azure");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { azureApiKey },
    });
    renderConfig(data);
    $("#config-azure-key").value = "";
    $("#config-azure-save-status").textContent = azureApiKey
      ? "Azure key saved."
      : "Saved key cleared. Using environment default if set.";
  } catch (err) {
    $("#config-azure-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function testAzureKey() {
  $("#config-azure-error").textContent = "";
  $("#config-azure-save-status").textContent = "";
  clearAzureTestResult();

  const inputKey = $("#config-azure-key").value.trim();
  const inputEndpoint = $("#config-azure-endpoint").value.trim();
  const inputDeployment = $("#config-azure-deployment").value.trim();
  const inputApiVersion = $("#config-azure-api-version").value.trim();
  const btn = $("#btn-config-test-azure");
  btn.disabled = true;
  try {
    const body = {};
    if (inputKey) body.azureApiKey = inputKey;
    if (inputEndpoint) body.azureEndpoint = inputEndpoint;
    if (inputDeployment) body.azureDeployment = inputDeployment;
    if (inputApiVersion) body.azureApiVersion = inputApiVersion;
    const data = await api("/api/config/test-azure", {
      method: "POST",
      body,
    });
    $("#config-azure-test-wrap").hidden = false;
    $("#config-azure-test-result").textContent = JSON.stringify(data, null, 2);
    const llmMs = data.llm?.latencyMs ?? "—";
    $("#config-azure-save-status").textContent = `API test succeeded (LLM ${llmMs} ms).`;
  } catch (err) {
    $("#config-azure-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveOpenRouterGenerateModel(openrouterGenerateModel) {
  $("#config-openrouter-error").textContent = "";
  $("#config-openrouter-save-status").textContent = "";
  clearOpenRouterTestResult();

  const btn = $("#btn-config-save-openrouter-generate-model");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { openrouterGenerateModel },
    });
    renderConfig(data);
    $("#config-openrouter-save-status").textContent = openrouterGenerateModel
      ? `Generate model saved: ${data.effectiveOpenRouterGenerateModel}`
      : "Saved generate model cleared. Using environment default.";
  } catch (err) {
    $("#config-openrouter-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveOpenRouterVisionModel(openrouterVisionModel) {
  $("#config-openrouter-error").textContent = "";
  $("#config-openrouter-save-status").textContent = "";
  clearOpenRouterTestResult();

  const btn = $("#btn-config-save-openrouter-vision-model");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { openrouterVisionModel },
    });
    renderConfig(data);
    $("#config-openrouter-save-status").textContent = openrouterVisionModel
      ? `Vision model saved: ${data.effectiveOpenRouterVisionModel}`
      : "Saved vision model cleared. Using environment default.";
  } catch (err) {
    $("#config-openrouter-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveOpenRouterTtsModel(openrouterTtsModel) {
  $("#config-openrouter-error").textContent = "";
  $("#config-openrouter-save-status").textContent = "";
  clearOpenRouterTestResult();

  const btn = $("#btn-config-save-openrouter-tts-model");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { openrouterTtsModel },
    });
    renderConfig(data);
    $("#config-openrouter-save-status").textContent = openrouterTtsModel
      ? `TTS model saved: ${data.effectiveOpenRouterTtsModel}`
      : "Saved TTS model cleared. Using environment default.";
  } catch (err) {
    $("#config-openrouter-error").textContent = err.message;
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

async function saveOpenRouterBuzzinModel(openrouterBuzzinModel) {
  $("#config-openrouter-error").textContent = "";
  $("#config-openrouter-save-status").textContent = "";
  clearOpenRouterTestResult();

  const btn = $("#btn-config-save-openrouter-model");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { openrouterBuzzinModel },
    });
    renderConfig(data);
    $("#config-openrouter-save-status").textContent = openrouterBuzzinModel
      ? `Model saved: ${data.effectiveOpenRouterBuzzinModel}`
      : "Saved model cleared. Using environment default.";
  } catch (err) {
    $("#config-openrouter-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveOpenRouterKey(openrouterApiKey) {
  $("#config-openrouter-error").textContent = "";
  $("#config-openrouter-save-status").textContent = "";
  clearOpenRouterTestResult();

  const btn = $("#btn-config-save-openrouter");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { openrouterApiKey },
    });
    renderConfig(data);
    $("#config-openrouter-key").value = "";
    $("#config-openrouter-save-status").textContent = openrouterApiKey
      ? "OpenRouter key saved."
      : "Saved key cleared. Using environment default if set.";
  } catch (err) {
    $("#config-openrouter-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function testOpenRouterKey() {
  $("#config-openrouter-error").textContent = "";
  $("#config-openrouter-save-status").textContent = "";
  clearOpenRouterTestResult();

  const inputKey = $("#config-openrouter-key").value.trim();
  const inputModel = $("#config-openrouter-buzzin-model").value.trim();
  const btn = $("#btn-config-test-openrouter");
  btn.disabled = true;
  try {
    const body = {};
    if (inputKey) body.openrouterApiKey = inputKey;
    if (inputModel) body.openrouterBuzzinModel = inputModel;
    const data = await api("/api/config/test-openrouter", {
      method: "POST",
      body,
    });
    $("#config-openrouter-test-wrap").hidden = false;
    $("#config-openrouter-test-result").textContent = JSON.stringify(data, null, 2);
    const llmMs = data.latencyMs ?? "—";
    $("#config-openrouter-save-status").textContent = `API test succeeded (LLM ${llmMs} ms).`;
  } catch (err) {
    $("#config-openrouter-error").textContent = err.message;
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
      body: { username, password },
    });
    if (!data.user?.token) throw new Error("Login succeeded but no token returned.");

    state.token = data.user.token;
    state.user = data.user;
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

async function saveConfig(publicBaseUrl) {
  $("#config-error").textContent = "";
  $("#config-status").textContent = "";

  const btn = $("#btn-config-save");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { publicBaseUrl },
    });
    renderConfig(data);
    $("#config-status").textContent = "Saved. New sessions will use the active URL above.";
  } catch (err) {
    $("#config-error").textContent = err.message;
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
  $("#btn-config-save").addEventListener("click", () => {
    saveConfig($("#config-public-base-url").value.trim());
  });
  $("#btn-config-reset").addEventListener("click", () => {
    $("#config-public-base-url").value = "";
    saveConfig("");
  });
  $("#btn-config-use-current").addEventListener("click", () => {
    $("#config-public-base-url").value = window.location.origin;
    saveConfig(window.location.origin);
  });
  $("#btn-config-save-inworld").addEventListener("click", () => {
    saveInworldKey($("#config-inworld-key").value.trim());
  });
  $("#btn-config-save-inworld-model").addEventListener("click", () => {
    saveInworldLlmModel($("#config-inworld-llm-model").value.trim());
  });
  $("#btn-config-save-inworld-stt").addEventListener("click", () => {
    saveInworldSttSettings(
      $("#config-inworld-stt-model").value.trim(),
      $("#config-inworld-stt-language").value.trim()
    );
  });
  $("#btn-config-test-inworld").addEventListener("click", testInworldKey);
  $("#btn-config-clear-inworld").addEventListener("click", () => {
    $("#config-inworld-key").value = "";
    saveInworldKey("");
  });
  $("#btn-config-reset-inworld-model").addEventListener("click", () => {
    $("#config-inworld-llm-model").value = "";
    saveInworldLlmModel("");
  });
  $("#btn-config-reset-inworld-stt").addEventListener("click", () => {
    $("#config-inworld-stt-model").value = "";
    $("#config-inworld-stt-language").value = "";
    saveInworldSttSettings("", "");
  });
  $("#btn-config-save-azure").addEventListener("click", () => {
    saveAzureKey($("#config-azure-key").value.trim());
  });
  $("#btn-config-save-azure-settings").addEventListener("click", () => {
    saveAzureSettings({
      azureEndpoint: $("#config-azure-endpoint").value.trim(),
      azureDeployment: $("#config-azure-deployment").value.trim(),
      azureApiVersion: $("#config-azure-api-version").value.trim(),
    });
  });
  $("#btn-config-test-azure").addEventListener("click", testAzureKey);
  $("#btn-config-clear-azure").addEventListener("click", () => {
    $("#config-azure-key").value = "";
    saveAzureKey("");
  });
  $("#btn-config-reset-azure-settings").addEventListener("click", () => {
    saveAzureSettings({
      azureEndpoint: "",
      azureDeployment: "",
      azureApiVersion: "",
    });
  });
  $("#btn-config-save-openrouter").addEventListener("click", () => {
    saveOpenRouterKey($("#config-openrouter-key").value.trim());
  });
  $("#btn-config-save-openrouter-model").addEventListener("click", () => {
    saveOpenRouterBuzzinModel($("#config-openrouter-buzzin-model").value.trim());
  });
  $("#btn-config-save-openrouter-generate-model").addEventListener("click", () => {
    saveOpenRouterGenerateModel($("#config-openrouter-generate-model").value.trim());
  });
  $("#btn-config-save-openrouter-vision-model").addEventListener("click", () => {
    saveOpenRouterVisionModel($("#config-openrouter-vision-model").value.trim());
  });
  $("#btn-config-save-openrouter-tts-model").addEventListener("click", () => {
    saveOpenRouterTtsModel($("#config-openrouter-tts-model").value.trim());
  });
  $("#btn-config-test-openrouter").addEventListener("click", testOpenRouterKey);
  $("#btn-config-clear-openrouter").addEventListener("click", () => {
    $("#config-openrouter-key").value = "";
    saveOpenRouterKey("");
  });
  $("#btn-config-reset-openrouter-model").addEventListener("click", () => {
    $("#config-openrouter-buzzin-model").value = "";
    saveOpenRouterBuzzinModel("");
  });
  $("#btn-config-reset-openrouter-generate-model").addEventListener("click", () => {
    $("#config-openrouter-generate-model").value = "";
    saveOpenRouterGenerateModel("");
  });
  $("#btn-config-reset-openrouter-vision-model").addEventListener("click", () => {
    $("#config-openrouter-vision-model").value = "";
    saveOpenRouterVisionModel("");
  });
  $("#btn-config-reset-openrouter-tts-model").addEventListener("click", () => {
    $("#config-openrouter-tts-model").value = "";
    saveOpenRouterTtsModel("");
  });
  $("#btn-config-save-video-generator-url").addEventListener("click", () => {
    saveVideoGeneratorApiUrl($("#config-video-generator-url").value.trim());
  });
  $("#btn-config-reset-video-generator-url").addEventListener("click", () => {
    $("#config-video-generator-url").value = "";
    saveVideoGeneratorApiUrl("");
  });
  $("#btn-config-clear-student-db").addEventListener("click", clearStudentDatabase);

  initConfigTabs();

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
