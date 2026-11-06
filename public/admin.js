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
    $("#assign-school").innerHTML = '<option value="">Choose a school</option>' + directory.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
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
        rows.push(`<tr><td><strong>${esc(teacherName(t))}</strong><br><span class="hint">${esc(t.email || "")}</span></td><td>${esc(t.username || "")}</td><td>${esc(s.name)}</td><td>${esc(t.classIds.join(", ") || "—")}</td><td><button type="button" class="btn small" data-view-as="${esc(t.id)}" data-school="${esc(s.id)}">View</button></td></tr>`);
      }
    }
    $("#teachers-body").innerHTML = rows.length ? rows.join("") : '<tr><td colspan="5" class="empty">No teachers found.</td></tr>';
  }

  function openSchool(id) {
    $("#teachers-school").value = id;
    renderDirectory();
    go("teachers");
  }

  $("#teachers-body").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-view-as]");
    if (!btn) return;
    btn.disabled = true;
    try {
      const data = await api("/api/lango/admin/view-as", {
        method: "POST",
        body: JSON.stringify({ schoolId: btn.dataset.school, teacherId: btn.dataset.viewAs }),
      });
      sessionStorage.setItem("lango_view_as", JSON.stringify({ token: data.token, user: data.user, adminName: $("#admin-label").textContent }));
      location.href = "/cms.html";
    } catch (err) {
      btn.disabled = false;
      $("#directory-error").textContent = err.message;
      go("schools");
    }
  });
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

  // ── Course assignment: one community course → chosen teachers (one request each) ──
  const assign = { courses: null, listingId: null, picked: new Map() };

  async function loadAssignCourses() {
    if (assign.courses) return renderAssign();
    try {
      assign.courses = (await api("/api/lango/admin/community")).courses || [];
    } catch (err) {
      assign.courses = [];
      $("#assign-error").textContent = err.message;
    }
    renderAssign();
  }

  function renderAssign() {
    const q = $("#assign-course-search").value.trim().toLowerCase();
    const courses = (assign.courses || []).filter((c) => !q || `${c.name} ${c.description}`.toLowerCase().includes(q));
    $("#assign-courses").innerHTML = courses.length
      ? courses
          .map(
            (c) => `<label class="assign-item"><input type="radio" name="assign-course" value="${esc(c.id)}"${String(assign.listingId) === String(c.id) ? " checked" : ""}><span><strong>${esc(c.name)}</strong><br><span class="hint">${esc(c.exerciseCount)} exercises · by ${esc(c.authorName)}</span></span></label>`,
          )
          .join("")
      : '<p class="empty">No community courses found.</p>';

    const schoolId = $("#assign-school").value;
    const school = (directory || []).find((s) => s.id === schoolId);
    $("#assign-teachers").innerHTML = school
      ? school.teachers.length
        ? school.teachers
            .map(
              (t) => `<label class="assign-item"><input type="checkbox" data-teacher="${esc(t.id)}" data-name="${esc(teacherName(t))}"${assign.picked.has(String(t.id)) ? " checked" : ""}><span><strong>${esc(teacherName(t))}</strong><br><span class="hint">${esc(t.username || "")}</span></span></label>`,
            )
            .join("")
        : '<p class="empty">This school has no teachers.</p>'
      : '<p class="empty">Choose a school first.</p>';

    const n = assign.picked.size;
    const course = (assign.courses || []).find((c) => String(c.id) === String(assign.listingId));
    $("#assign-summary").textContent = course && n ? `Give “${course.name}” to ${n} teacher${n === 1 ? "" : "s"}.` : "Pick a course and at least one teacher.";
    $("#assign-go").disabled = !(course && n);
  }

  async function runAssign() {
    const btn = $("#assign-go");
    const list = $("#assign-results");
    const course = (assign.courses || []).find((c) => String(c.id) === String(assign.listingId));
    if (!course || !assign.picked.size) return;
    btn.disabled = true;
    list.innerHTML = "";
    let done = 0;
    for (const [id, name] of [...assign.picked]) {
      const li = document.createElement("li");
      li.textContent = `${name}: …`;
      list.appendChild(li);
      try {
        const res = await api("/api/lango/admin/assign", { method: "POST", body: JSON.stringify({ listingId: course.id, teacherId: id }) });
        li.textContent = `${name}: ${res.alreadyCopied ? "already had it" : "done"}`;
        done += 1;
      } catch (err) {
        li.textContent = `${name}: failed — ${err.message}`;
        li.className = "error";
      }
    }
    $("#assign-summary").textContent = `Finished: ${done} of ${assign.picked.size} teachers.`;
    btn.disabled = false;
  }

  $("#assign-course-search").addEventListener("input", renderAssign);
  $("#assign-courses").addEventListener("change", (e) => {
    assign.listingId = e.target.value;
    renderAssign();
  });
  $("#assign-school").addEventListener("change", renderAssign);
  $("#assign-teachers").addEventListener("change", (e) => {
    const box = e.target.closest("[data-teacher]");
    if (!box) return;
    if (box.checked) assign.picked.set(box.dataset.teacher, box.dataset.name);
    else assign.picked.delete(box.dataset.teacher);
    renderAssign();
  });
  $("#assign-all").addEventListener("click", () => {
    document.querySelectorAll("#assign-teachers [data-teacher]").forEach((b) => assign.picked.set(b.dataset.teacher, b.dataset.name));
    renderAssign();
  });
  $("#assign-go").addEventListener("click", runAssign);

  function signOut() {
    assign.courses = null;
    assign.picked.clear();
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
    if (nav.dataset.nav === "assignments") loadAssignCourses();
  });
  restore();
})();
