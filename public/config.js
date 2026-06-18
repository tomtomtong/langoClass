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

function updateAuthUi() {
  const loggedIn = !!(state.token && state.user);
  $("#config-teacher-label").hidden = !loggedIn;
  $("#btn-config-logout").hidden = !loggedIn;
  if (loggedIn) {
    $("#config-teacher-label").textContent = `Logged in as ${teacherDisplayName()}`;
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

  const qwenConfigured = !!data.qwenApiKeyConfigured;
  const qwenSaved = !!data.qwenApiKeySaved;
  $("#config-qwen-status-label").textContent = qwenConfigured ? "Configured" : "Not configured";
  $("#config-qwen-masked").textContent = qwenConfigured ? data.qwenApiKeyMasked || "—" : "—";
  $("#config-qwen-env-hint").hidden = !data.qwenEnvDefaultConfigured || qwenSaved;

  if (qwenSaved) {
    $("#config-qwen-key").placeholder = "Key saved — paste to replace";
  } else {
    $("#config-qwen-key").placeholder = "Paste key here";
  }

  $("#config-qwen-model").value = data.qwenModelSaved || "";
  $("#config-qwen-model-effective").textContent = data.effectiveQwenModel || "—";
  $("#config-qwen-model-env-default").textContent = data.qwenModelEnvDefault || "—";
}

function clearInworldTestResult() {
  $("#config-inworld-test-wrap").hidden = true;
  $("#config-inworld-test-result").textContent = "";
}

function clearQwenTestResult() {
  $("#config-qwen-test-wrap").hidden = true;
  $("#config-qwen-test-result").textContent = "";
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
      : "Saved model cleared. Using environment default.";
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
    $("#config-inworld-save-status").textContent =
      `API test succeeded (TTS ${ttsMs} ms, LLM ${llmMs} ms).`;
  } catch (err) {
    $("#config-inworld-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveQwenModel(qwenModel) {
  $("#config-qwen-error").textContent = "";
  $("#config-qwen-save-status").textContent = "";
  clearQwenTestResult();

  const btn = $("#btn-config-save-qwen-model");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { qwenModel },
    });
    renderConfig(data);
    $("#config-qwen-save-status").textContent = qwenModel
      ? `Model saved: ${data.effectiveQwenModel}`
      : "Saved model cleared. Using environment default.";
  } catch (err) {
    $("#config-qwen-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveQwenKey(qwenApiKey) {
  $("#config-qwen-error").textContent = "";
  $("#config-qwen-save-status").textContent = "";
  clearQwenTestResult();

  const btn = $("#btn-config-save-qwen");
  btn.disabled = true;
  try {
    const data = await api("/api/config", {
      method: "PUT",
      body: { qwenApiKey },
    });
    renderConfig(data);
    $("#config-qwen-key").value = "";
    $("#config-qwen-save-status").textContent = qwenApiKey
      ? "Qwen key saved."
      : "Saved key cleared. Using environment default if set.";
  } catch (err) {
    $("#config-qwen-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function testQwenKey() {
  $("#config-qwen-error").textContent = "";
  $("#config-qwen-save-status").textContent = "";
  clearQwenTestResult();

  const inputKey = $("#config-qwen-key").value.trim();
  const inputModel = $("#config-qwen-model").value.trim();
  const btn = $("#btn-config-test-qwen");
  btn.disabled = true;
  try {
    const body = {};
    if (inputKey) body.qwenApiKey = inputKey;
    if (inputModel) body.qwenModel = inputModel;
    const data = await api("/api/config/test-qwen", {
      method: "POST",
      body,
    });
    $("#config-qwen-test-wrap").hidden = false;
    $("#config-qwen-test-result").textContent = JSON.stringify(data, null, 2);
    const llmMs = data.llm?.latencyMs ?? "—";
    $("#config-qwen-save-status").textContent = `API test succeeded (LLM ${llmMs} ms).`;
  } catch (err) {
    $("#config-qwen-error").textContent = err.message;
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
  $("#btn-config-test-inworld").addEventListener("click", testInworldKey);
  $("#btn-config-clear-inworld").addEventListener("click", () => {
    $("#config-inworld-key").value = "";
    saveInworldKey("");
  });
  $("#btn-config-reset-inworld-model").addEventListener("click", () => {
    $("#config-inworld-llm-model").value = "";
    saveInworldLlmModel("");
  });
  $("#btn-config-save-qwen").addEventListener("click", () => {
    saveQwenKey($("#config-qwen-key").value.trim());
  });
  $("#btn-config-save-qwen-model").addEventListener("click", () => {
    saveQwenModel($("#config-qwen-model").value.trim());
  });
  $("#btn-config-test-qwen").addEventListener("click", testQwenKey);
  $("#btn-config-clear-qwen").addEventListener("click", () => {
    $("#config-qwen-key").value = "";
    saveQwenKey("");
  });
  $("#btn-config-reset-qwen-model").addEventListener("click", () => {
    $("#config-qwen-model").value = "";
    saveQwenModel("");
  });

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
