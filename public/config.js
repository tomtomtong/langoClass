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
}

function clearInworldTestResult() {
  $("#config-inworld-test-wrap").hidden = true;
  $("#config-inworld-test-result").textContent = "";
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
  const btn = $("#btn-config-test-inworld");
  btn.disabled = true;
  try {
    const data = await api("/api/config/test-inworld", {
      method: "POST",
      body: inputKey ? { inworldApiKey: inputKey } : {},
    });
    $("#config-inworld-test-wrap").hidden = false;
    $("#config-inworld-test-result").textContent = JSON.stringify(data, null, 2);
    $("#config-inworld-save-status").textContent = `API test succeeded (${data.latencyMs} ms).`;
  } catch (err) {
    $("#config-inworld-error").textContent = err.message;
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
  $("#config-login-password").value = "";
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

  if (state.loginUsername) {
    $("#config-login-username").value = state.loginUsername;
  }

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
  $("#btn-config-test-inworld").addEventListener("click", testInworldKey);
  $("#btn-config-clear-inworld").addEventListener("click", () => {
    $("#config-inworld-key").value = "";
    saveInworldKey("");
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
