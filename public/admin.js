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

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let directory = null;

  async function loadDirectory() {
    $("#directory-error").textContent = "";
    try {
      directory = (await api("/api/lango/admin/directory")).schools || [];
    } catch (err) {
      if (err.status === 401 || err.status === 403) return signOut();
      directory = [];
      $("#directory-error").textContent = err.message;
    }
    const sel = $("#teachers-school");
    sel.innerHTML = '<option value="">All schools</option>' + directory.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    renderDirectory();
  }

  function teacherName(t) {
    return t.nameZh || t.nameEn || t.username || t.email || "—";
  }

  function renderDirectory() {
    if (!directory) return;
    const sum = (f) => directory.reduce((n, s) => n + f(s), 0);
    $("#stat-schools").textContent = directory.length;
    $("#stat-teachers").textContent = sum((s) => s.teachers.length);
    $("#stat-classes").textContent = sum((s) => s.classes.length);
    $("#stat-students").textContent = sum((s) => s.studentCount);

    const sq = $("#schools-search").value.trim().toLowerCase();
    const schools = directory.filter((s) => !sq || `${s.name} ${s.id}`.toLowerCase().includes(sq));
    $("#schools-body").innerHTML = schools.length
      ? schools
          .map(
            (s) => `<tr class="admin-row" data-school="${esc(s.id)}" tabindex="0"><td><strong>${esc(s.name)}</strong><br><span class="hint">${esc(s.id)}${s.partial ? " · some data missing" : ""}</span></td><td>${s.teachers.length}</td><td>${s.classes.length}</td><td>${s.studentCount}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4" class="empty">No schools found.</td></tr>';

    const tq = $("#teachers-search").value.trim().toLowerCase();
    const schoolFilter = $("#teachers-school").value;
    const rows = [];
    for (const s of directory) {
      if (schoolFilter && s.id !== schoolFilter) continue;
      for (const t of s.teachers) {
        if (tq && !`${teacherName(t)} ${t.username || ""} ${t.email || ""}`.toLowerCase().includes(tq)) continue;
        rows.push(`<tr><td><strong>${esc(teacherName(t))}</strong><br><span class="hint">${esc(t.email || "")}</span></td><td>${esc(t.username || "")}</td><td>${esc(s.name)}</td><td>${esc(t.classIds.join(", ") || "—")}</td></tr>`);
      }
    }
    $("#teachers-body").innerHTML = rows.length ? rows.join("") : '<tr><td colspan="4" class="empty">No teachers found.</td></tr>';
  }

  function openSchool(id) {
    $("#teachers-school").value = id;
    renderDirectory();
    go("teachers");
  }

  $("#schools-search").addEventListener("input", renderDirectory);
  $("#teachers-search").addEventListener("input", renderDirectory);
  $("#teachers-school").addEventListener("change", renderDirectory);
  $("#schools-body").addEventListener("click", (e) => {
    const row = e.target.closest("[data-school]");
    if (row) openSchool(row.dataset.school);
  });
  $("#schools-body").addEventListener("keydown", (e) => {
    const row = e.target.closest("[data-school]");
    if (row && e.key === "Enter") openSchool(row.dataset.school);
  });

  function signOut() {
    directory = null;
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
      loadDirectory();
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
      loadDirectory();
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
