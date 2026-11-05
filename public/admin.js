// School admin portal. The Worker decides who is an admin (newcms role); this page
// only keeps the token and asks /api/lango/admin/me whether it is still valid.
(() => {
  const TOKEN_KEY = "lango_admin_token";
  const state = { token: sessionStorage.getItem(TOKEN_KEY) || "", user: null };
  const $ = (sel) => document.querySelector(sel);

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const err = new Error(data?.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function show(loggedIn) {
    const loginScreen = $("#screen-cms-login");
    loginScreen.classList.toggle("active", !loggedIn);
    loginScreen.hidden = loggedIn;
    $("#app-shell").hidden = !loggedIn;
    if (!loggedIn) return;
    const u = state.user || {};
    const name = [u.firstName || u.first_name, u.lastName || u.last_name].filter(Boolean).join(" ") || u.username || "Admin";
    $("#admin-label").textContent = name;
    $("#admin-name").textContent = `Hi, ${name}`;
    $("#admin-school").textContent = u.schoolName || u.school_name || (u.school_id ? `School ${u.school_id}` : "");
  }

  function go(screen) {
    document.querySelectorAll(".app-main > .screen").forEach((el) => el.classList.toggle("active", el.id === `screen-${screen}`));
    document.querySelectorAll(".sidebar-nav .nav-link").forEach((el) => el.classList.toggle("active", el.dataset.nav === screen));
  }

  function signOut() {
    state.token = "";
    state.user = null;
    sessionStorage.removeItem(TOKEN_KEY);
    show(false);
  }

  async function login() {
    const username = $("#login-username").value.trim();
    const password = $("#login-password").value;
    $("#login-error").textContent = "";
    if (!username || !password) {
      $("#login-error").textContent = "Enter username and password.";
      return;
    }
    const btn = $("#btn-login");
    btn.disabled = true;
    try {
      const data = await api("/api/lango/admin/login", {
        method: "POST",
        headers: await window.LangoTurnstile?.headers?.(),
        body: JSON.stringify({ login: username, password }),
      });
      state.token = data.token;
      state.user = data.user;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      $("#login-password").value = "";
      show(true);
    } catch (err) {
      $("#login-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function restore() {
    if (!state.token) return show(false);
    try {
      const data = await api("/api/lango/admin/me");
      state.user = data.user;
      show(true);
    } catch {
      signOut();
    }
  }

  $("#btn-login").addEventListener("click", login);
  $("#signin-form").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("#btn-logout").addEventListener("click", signOut);
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (!nav) return;
    e.preventDefault();
    go(nav.dataset.nav);
  });
  restore();
})();
