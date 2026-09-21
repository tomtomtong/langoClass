(() => {
  const TOKEN_KEY = "lango_system_logs_token";
  const USER_KEY = "lango_system_logs_user";
  const PAGE_SIZE = 100;

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    username: localStorage.getItem(USER_KEY) || "",
    category: "",
    q: "",
    level: "",
    offset: 0,
    total: 0,
    autoRefresh: true,
    timer: null,
  };

  const $ = (sel) => document.querySelector(sel);

  const CATEGORY_LABELS = {
    "": "All",
    login: "Login",
    school: "School",
    class: "Class / session",
    ai: "AI tasks",
    student: "Student",
    presence: "Online / offline",
    server: "Server debug",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "—";
    return d.toLocaleString();
  }

  function showLogin() {
    $("#screen-login")?.classList.add("active");
    $("#app-shell").hidden = true;
  }

  function showApp() {
    $("#screen-login")?.classList.remove("active");
    $("#app-shell").hidden = false;
    $("#admin-label").textContent = state.username || "Admin";
  }

  async function api(path, options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(path, { ...options, headers });
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

  function renderCategoryTabs() {
    const wrap = $("#category-tabs");
    if (!wrap) return;
    wrap.innerHTML = Object.entries(CATEGORY_LABELS)
      .map(
        ([value, label]) =>
          `<button type="button" class="cat-tab${state.category === value ? " is-active" : ""}" data-category="${escapeHtml(value)}" role="tab" aria-selected="${state.category === value}">${escapeHtml(label)}</button>`
      )
      .join("");
  }

  function renderStats(stats) {
    const row = $("#stats-row");
    if (!row || !stats) return;
    const cards = [
      ["Total", stats.total],
      ["Login", stats.byCategory?.login || 0],
      ["School", stats.byCategory?.school || 0],
      ["Class", stats.byCategory?.class || 0],
      ["AI", stats.byCategory?.ai || 0],
      ["Student", stats.byCategory?.student || 0],
      ["Presence", stats.byCategory?.presence || 0],
      ["Server", stats.byCategory?.server || 0],
    ];
    row.innerHTML = cards
      .map(
        ([label, value]) =>
          `<div class="stat-card"><span class="label">${escapeHtml(label)}</span><div class="value">${escapeHtml(value)}</div></div>`
      )
      .join("");
  }

  function renderRows(entries) {
    const tbody = $("#log-tbody");
    if (!tbody) return;
    if (!entries?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">No matching log entries.</td></tr>`;
      return;
    }
    tbody.innerHTML = entries
      .map((entry) => {
        const meta = entry.meta && Object.keys(entry.meta).length
          ? escapeHtml(JSON.stringify(entry.meta, null, 0))
          : "—";
        return `<tr>
          <td class="time">${escapeHtml(formatTime(entry.ts))}</td>
          <td><span class="badge ${escapeHtml(entry.category)}">${escapeHtml(entry.category)}</span></td>
          <td><span class="badge ${escapeHtml(entry.level)}">${escapeHtml(entry.level)}</span></td>
          <td class="action">${escapeHtml(entry.action)}</td>
          <td class="message">${escapeHtml(entry.message)}</td>
          <td class="details">${meta}</td>
        </tr>`;
      })
      .join("");
  }

  function updatePager() {
    const page = Math.floor(state.offset / PAGE_SIZE) + 1;
    const maxPage = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    $("#page-label").textContent = `Page ${page} / ${maxPage}`;
    $("#result-count").textContent = `${state.total} matching`;
    $("#btn-prev").disabled = state.offset <= 0;
    $("#btn-next").disabled = state.offset + PAGE_SIZE >= state.total;
  }

  async function loadLogs() {
    if (!state.token) return;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(state.offset),
    });
    if (state.category) params.set("category", state.category);
    if (state.q) params.set("q", state.q);
    if (state.level) params.set("level", state.level);

    const [list, stats] = await Promise.all([
      api(`/api/logs?${params.toString()}`),
      api("/api/logs/stats"),
    ]);
    state.total = list.total || 0;
    renderStats(stats);
    renderRows(list.entries || []);
    updatePager();
    $("#last-updated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  async function loadDebugFiles() {
    if (!state.token) return;
    try {
      const data = await api("/api/logs/debug-files");
      const blocks = (data.files || [])
        .map((file) => {
          const header = `=== ${file.name} (${file.lineCount} lines) ===`;
          return `${header}\n${file.tail || "(empty)"}`;
        })
        .join("\n\n");
      $("#debug-files").textContent = blocks || "No debug log files found.";
    } catch (err) {
      $("#debug-files").textContent = err.message || "Failed to load debug files.";
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (!state.autoRefresh || !state.token) return;
    state.timer = setInterval(() => {
      loadLogs().catch(() => {});
    }, 5000);
  }

  function stopAutoRefresh() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  async function handleLogin() {
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
      const data = await api("/api/logs/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      state.token = data.token;
      state.username = data.username || username;
      localStorage.setItem(TOKEN_KEY, state.token);
      localStorage.setItem(USER_KEY, state.username);
      showApp();
      renderCategoryTabs();
      await Promise.all([loadLogs(), loadDebugFiles()]);
      startAutoRefresh();
    } catch (err) {
      $("#login-error").textContent = err.message || "Login failed.";
    } finally {
      btn.disabled = false;
    }
  }

  async function handleLogout() {
    try {
      if (state.token) {
        await api("/api/logs/logout", { method: "POST" });
      }
    } catch {
      // ignore
    }
    stopAutoRefresh();
    state.token = "";
    state.username = "";
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    showLogin();
  }

  async function bootstrap() {
    renderCategoryTabs();
    $("#auto-refresh").checked = state.autoRefresh;

    if (!state.token) {
      showLogin();
      return;
    }

    try {
      await api("/api/logs/stats");
      showApp();
      await Promise.all([loadLogs(), loadDebugFiles()]);
      startAutoRefresh();
    } catch {
      await handleLogout();
    }
  }

  $("#btn-login")?.addEventListener("click", handleLogin);
  $("#login-password")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleLogin();
  });
  $("#login-username")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleLogin();
  });
  $("#btn-logout")?.addEventListener("click", handleLogout);
  $("#btn-refresh")?.addEventListener("click", () => {
    loadLogs().catch((err) => {
      if (err.status === 401) handleLogout();
    });
  });
  $("#btn-debug-refresh")?.addEventListener("click", () => {
    loadDebugFiles().catch(() => {});
  });
  $("#auto-refresh")?.addEventListener("change", (event) => {
    state.autoRefresh = Boolean(event.target.checked);
    startAutoRefresh();
  });
  $("#category-tabs")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-category]");
    if (!btn) return;
    state.category = btn.getAttribute("data-category") || "";
    state.offset = 0;
    renderCategoryTabs();
    loadLogs().catch(() => {});
  });
  $("#search-input")?.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.q = $("#search-input").value.trim();
      state.offset = 0;
      loadLogs().catch(() => {});
    }, 250);
  });
  $("#level-filter")?.addEventListener("change", () => {
    state.level = $("#level-filter").value;
    state.offset = 0;
    loadLogs().catch(() => {});
  });
  $("#btn-clear-filters")?.addEventListener("click", () => {
    state.category = "";
    state.q = "";
    state.level = "";
    state.offset = 0;
    $("#search-input").value = "";
    $("#level-filter").value = "";
    renderCategoryTabs();
    loadLogs().catch(() => {});
  });
  $("#btn-prev")?.addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    loadLogs().catch(() => {});
  });
  $("#btn-next")?.addEventListener("click", () => {
    state.offset += PAGE_SIZE;
    loadLogs().catch(() => {});
  });

  bootstrap();
})();
