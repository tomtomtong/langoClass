/**
 * Bridges the reference CMS UI to existing cms.js API handlers.
 */
(function cmsUiBridge() {
  const COMING_SOON_MSG = "Coming Soon";

  function showComingSoonToast(feature) {
    const msg = feature ? `${feature} — ${COMING_SOON_MSG}` : COMING_SOON_MSG;
    if (typeof showCmsToast === "function") showCmsToast(msg, { variant: "info" });
    else if (typeof window.alert === "function") window.alert(msg);
  }

  window.cmsComingSoon = showComingSoonToast;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function coverHtml(item) {
    const src = (item?.banner || item?.cover || "").trim();
    if (src) return `<div class="cover"><img alt="" src="${escapeHtml(src)}" /></div>`;
    return `<div class="cover alt"></div>`;
  }

  function courseThumbHtml(course) {
    const src = (course?.banner || course?.cover || "").trim();
    if (src) return `<img class="thumb" alt="" src="${escapeHtml(src)}" />`;
    const altClass = course?.coverClass || "alt";
    return `<div class="thumb cover ${altClass}"></div>`;
  }

  function formatHomeDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-HK", { month: "short", day: "numeric" });
  }

  function formatHomeDateTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("en-HK", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatHomeDateRange(start, end) {
    const s = formatHomeDate(start);
    const e = formatHomeDate(end);
    if (s && e) return `${s} – ${e}`;
    if (s || e) return s || e;
    return null;
  }

  function statusBadgeHtml(status) {
    const labels = {
      scheduled: "Scheduled",
      in_progress: "In progress",
      completed: "Completed",
      overdue: "Overdue",
      not_started: "Not started",
      skipped: "Skipped",
    };
    const key = labels[status] ? status : "in_progress";
    return `<span class="badge status-${key}">${labels[key] || "In progress"}</span>`;
  }

  function hostLinkForCourse(courseId, sectionId) {
    const params = new URLSearchParams({ course: String(courseId) });
    if (sectionId) params.set("section", String(sectionId));
    return `/host.html?${params.toString()}`;
  }

  function courseProgressMeta(courseId, progressMap) {
    return progressMap.get(Number(courseId)) || null;
  }

  function isCourseComplete(course, progressMap) {
    const p = courseProgressMeta(course.id, progressMap);
    if (!p) return false;
    return p.totalExercises > 0 && p.completedCount >= p.totalExercises;
  }

  async function loadHomeCourseProgressMap() {
    const map = new Map();
    const classes = window.state?.classes || [];
    if (typeof api !== "function" || !classes.length) return map;
    await Promise.all(
      classes.map(async (cl) => {
        try {
          const data = await api(`/api/cms/dashboard/progress?classId=${cl.id}`);
          for (const row of data.courses || []) {
            const id = Number(row.courseId);
            const prev = map.get(id);
            if (!prev || (row.percent || 0) > (prev.percent || 0)) {
              map.set(id, { ...row, classId: cl.id });
            }
          }
        } catch {
          /* optional */
        }
      })
    );
    window.state.homeCourseProgress = map;
    return map;
  }

  function renderCourseStatusList(box, courses, progressMap, options = {}) {
    if (!box) return;
    box.innerHTML = "";
    if (!courses.length) {
      box.innerHTML = `<p class="hint">...</p>`;
      return;
    }
    const completedList = !!options.completed;
    courses.forEach((c) => {
      const p = courseProgressMeta(c.id, progressMap);
      const hasProgress = !!p;
      const pct = hasProgress ? p.percent ?? 0 : 0;
      const status = completedList || isCourseComplete(c, progressMap) ? "completed" : "in_progress";
      const sectionTitle = p?.lastSectionTitle?.trim();
      const sectionLine = sectionTitle
        ? `Section · ${escapeHtml(sectionTitle)}${p?.lastExerciseTitle ? ` · ${escapeHtml(p.lastExerciseTitle)}` : ""}`
        : "...";
      const scheduledStart = formatHomeDateTime(c.scheduledStartAt || p?.scheduledStartAt) || "...";
      const planned = formatHomeDateRange(c.plannedStart, c.plannedEnd) || "...";
      const lastHosted =
        formatHomeDateTime(c.lastHostedAt || p?.lastHostedAt || p?.updatedAt) || "...";
      const engagement = "...";
      const accuracy = "...";
      const pctLabel = hasProgress ? `${pct}%` : "...";
      const el = document.createElement("div");
      el.className = "paper progress-item course-card-rich";
      el.innerHTML = `
        ${courseThumbHtml(c)}
        <div class="meta">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <strong>${escapeHtml(c.name || "Untitled")}</strong>
              ${statusBadgeHtml(status)}
            </div>
            <span class="hint">${pctLabel}</span>
          </div>
          <span class="hint">${sectionLine}</span>
          <span class="hint">Scheduled start: ${escapeHtml(scheduledStart)}</span>
          <span class="hint">Planned: ${escapeHtml(planned)}</span>
          <span class="hint">Last Hosted: ${escapeHtml(lastHosted)}</span>
          <div class="eng-row">
            <span class="badge">Engagement ${engagement}%</span>
            <span class="hint">Accuracy ${accuracy}%</span>
          </div>
          <div class="bar"><span style="width:${hasProgress ? pct : 0}%"></span></div>
          <div class="row" style="margin-top:0.25rem">
            <a class="btn small primary" href="${hostLinkForCourse(c.id, p?.lastSectionId)}">Host</a>
            <button class="btn small ghost" type="button" data-copy-link>Copy session link</button>
            <button class="btn small ghost" type="button" data-dash="${c.id}">View dashboard</button>
          </div>
        </div>`;
      el.querySelector("[data-copy-link]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        showComingSoonToast("Copy session link");
      });
      el.querySelector("[data-dash]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (p?.classId && window.state) window.state.dashboardClassId = Number(p.classId);
        if (typeof enterDashboard === "function") enterDashboard();
        else showComingSoonToast("View dashboard");
      });
      el.addEventListener("click", (e) => {
        if (e.target.closest("a,button")) return;
        if (p?.classId && window.state) window.state.dashboardClassId = Number(p.classId);
        if (typeof enterDashboard === "function") enterDashboard();
      });
      box.appendChild(el);
    });
  }

  function renderHomeCommunityGrid(grid, items) {
    if (!grid) return;
    grid.innerHTML = "";
    if (!items.length) {
      grid.innerHTML = `<p class="hint">No templates yet.</p>`;
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "paper community-card";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.innerHTML = `
        ${coverHtml(item)}
        <div class="card-body">
          <h2>${escapeHtml(item.name || item.title || "Template")}</h2>
          <p class="hint">${escapeHtml(item.description || "")}</p>
          <div class="badges">
            <span class="badge">${escapeHtml(typeof communityLangLabel === "function" ? communityLangLabel(item.langCode) : item.langCode || "—")}</span>
            ${item.featured ? `<span class="badge">Featured</span>` : ""}
            <span class="badge">Added ${item.copyCount || item.addedCount || 0}</span>
          </div>
          <div class="card-actions">
            <button class="btn small" type="button" data-act="preview">Preview</button>
            <button class="btn small primary" type="button" data-act="add">Add to My courses</button>
          </div>
        </div>`;
      card.querySelector('[data-act="preview"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof openCommunityPreview === "function") openCommunityPreview(Number(item.id));
      });
      card.querySelector('[data-act="add"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof addCommunityCourse === "function") addCommunityCourse(Number(item.id));
      });
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-act]")) return;
        if (typeof openCommunityPreview === "function") openCommunityPreview(Number(item.id));
      });
      grid.appendChild(card);
    });
  }

  function statDisplay(value) {
    if (value === null || value === undefined || value === "") return "...";
    if (typeof value === "number" && Number.isNaN(value)) return "...";
    return value;
  }

  function renderDashStats(container, stats) {
    if (!container) return;
    container.innerHTML = stats
      .map(
        (s) =>
          `<article class="paper dash-stat"><div class="dash-num">${escapeHtml(String(statDisplay(s.value)))}</div><div class="hint">${escapeHtml(s.label)}</div></article>`
      )
      .join("");
  }

  function renderAdminBlock(inProgress, completed, teacherName, classes, coursesLoaded) {
    const block = document.getElementById("home-admin-block");
    if (!block) return;
    block.hidden = false;
    renderDashStats(document.getElementById("admin-stats"), [
      { label: "Active teachers", value: "..." },
      { label: "Hosts this week", value: "..." },
      { label: "Students reached", value: "..." },
      { label: "Avg. engagement", value: "..." },
      {
        label: "In progress",
        value: coursesLoaded ? inProgress.length : "...",
      },
      {
        label: "Completed",
        value: coursesLoaded ? completed.length : "...",
      },
    ]);
    const tbody = document.querySelector("#admin-teachers tbody");
    if (!tbody) return;
    const classNames = (classes || []).map((c) => c.name).filter(Boolean);
    const hasTeacherRow = teacherName || classNames.length;
    if (!hasTeacherRow) {
      tbody.innerHTML = `<tr>
        <td><strong>...</strong></td>
        <td>...</td>
        <td>...</td>
        <td>...</td>
        <td>...</td>
      </tr>`;
      return;
    }
    tbody.innerHTML = `<tr>
      <td><strong>${escapeHtml(teacherName || "...")}</strong></td>
      <td>${escapeHtml(classNames.length ? classNames.join(", ") : "...")}</td>
      <td>...</td>
      <td>...</td>
      <td>${coursesLoaded ? statDisplay(inProgress.length) : "..."}</td>
    </tr>`;
  }

  window.loadHomeCourseProgressMap = loadHomeCourseProgressMap;

  window.renderCmsHomeWidgets = async function renderCmsHomeWidgets() {
    const courses = window.state?.courses || [];
    const classes = window.state?.classes || [];
    const community = window.state?.communityCourses || [];
    const progressMap = await loadHomeCourseProgressMap();

    const hello = document.getElementById("home-hello");
    const school = document.getElementById("home-school");
    const teacherName = typeof teacherDisplayName === "function" ? teacherDisplayName() : "";
    if (hello) hello.textContent = teacherName ? `Hi, ${teacherName}` : "Hi";
    if (school) school.textContent = "... · ... · ...";

    const inProgress = courses.filter((c) => !isCourseComplete(c, progressMap));
    const completed = courses.filter((c) => isCourseComplete(c, progressMap));

    renderAdminBlock(inProgress, completed, teacherName, classes, true);

    const todayEl = document.getElementById("home-today");
    if (todayEl) todayEl.innerHTML = "";

    let avgProgress = null;
    if (progressMap.size) {
      avgProgress = `${Math.round(
        [...progressMap.values()].reduce((s, p) => s + (p.percent || 0), 0) / progressMap.size
      )}%`;
    }
    renderDashStats(document.getElementById("home-stats"), [
      { label: "Courses", value: statDisplay(courses.length) },
      { label: "In progress", value: statDisplay(inProgress.length) },
      { label: "Completed", value: statDisplay(completed.length) },
      { label: "Classes", value: statDisplay(classes.length) },
      { label: "Students", value: "..." },
      { label: "Avg. progress", value: avgProgress },
      { label: "Hosts this week", value: "..." },
    ]);

    renderCourseStatusList(document.getElementById("home-in-progress"), inProgress, progressMap, {
      completed: false,
    });
    renderCourseStatusList(document.getElementById("home-completed"), completed, progressMap, {
      completed: true,
    });

    const classBox = document.getElementById("home-classes");
    if (classBox) {
      classBox.innerHTML = "";
      if (!classes.length) {
        classBox.innerHTML = `<p class="hint">...</p>`;
      } else {
        classes.forEach((cl) => {
          const el = document.createElement("div");
          el.className = "paper progress-item";
          el.innerHTML = `
            <div class="row" style="justify-content:space-between">
              <strong>${escapeHtml(cl.name)}</strong>
              <span class="hint">Next Host · ...</span>
            </div>
            <span class="hint">... students · ... progress complete</span>
            <div class="bar"><span style="width:0%"></span></div>`;
          el.addEventListener("click", () => {
            if (window.state) window.state.dashboardClassId = Number(cl.id);
            if (typeof enterDashboard === "function") enterDashboard();
          });
          classBox.appendChild(el);
        });
      }
    }

    const storeEl = document.getElementById("home-store");
    if (storeEl) storeEl.innerHTML = "";

    const popular = [...community].sort((a, b) => (b.copyCount || 0) - (a.copyCount || 0)).slice(0, 4);
    const newest = [...community]
      .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")))
      .slice(0, 4);
    renderHomeCommunityGrid(document.getElementById("home-popular"), popular);
    renderHomeCommunityGrid(document.getElementById("home-newest"), newest);
  };

  function wireComingSoonInteractions() {
    document.getElementById("community-main")?.addEventListener("mousedown", (e) => {
      e.preventDefault();
      showComingSoonToast("Category filters");
    });
    document.getElementById("community-sub")?.addEventListener("mousedown", (e) => {
      e.preventDefault();
      showComingSoonToast("Category filters");
    });
  }

  function wireSidebarNav() {
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        if (!window.state?.token) return;
        const nav = btn.dataset.nav;
        if (nav === "home" && typeof enterHome === "function") enterHome();
        else if (nav === "courses" && typeof enterCourseList === "function") enterCourseList();
        else if (nav === "community" && typeof enterCommunity === "function") enterCommunity();
        else if (nav === "progress" && typeof enterDashboard === "function") enterDashboard();
        syncSidebarNav(nav);
      });
    });
  }

  function wireHomeQuickActions() {
    document.querySelectorAll("[data-home]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!window.state?.token) return;
        const map = { create: "new-course", edit: "courses", community: "community", progress: "progress" };
        if (typeof handleHomeAction === "function" && map[btn.dataset.home]) {
          handleHomeAction(map[btn.dataset.home]);
        }
      });
    });
  }

  function wireCoursesTabs() {
    const tabs = document.getElementById("courses-tabs");
    if (!tabs) return;
    tabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-courses-tab]");
      if (!tab) return;
      if (!window.state) return;
      window.state.coursesTab = tab.dataset.coursesTab || "all";
      tabs.querySelectorAll(".courses-tab").forEach((t) => {
        const active = t === tab;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      if (typeof renderCourseList === "function") renderCourseList();
    });
  }

  function wireTemplatesTabs() {
    const tabs = document.getElementById("templates-tabs");
    if (!tabs) return;
    const minePanel = document.getElementById("templates-mine-panel");
    const communityPanel = document.getElementById("templates-community-panel");
    tabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-templates-tab]");
      if (!tab) return;
      const isMine = tab.dataset.templatesTab === "mine";
      tabs.querySelectorAll(".templates-tab").forEach((t) => {
        const active = t === tab;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      if (minePanel) minePanel.hidden = !isMine;
      if (communityPanel) communityPanel.hidden = isMine;
      if (isMine) showComingSoonToast("My templates");
      else if (typeof renderCommunityList === "function") renderCommunityList();
    });
  }

  function wirePreviewsMenu() {
    const menu = document.getElementById("previews-menu");
    if (!menu) return;
    menu.querySelector("[data-menu='previews-menu']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("open");
    });
    document.addEventListener("click", () => menu.classList.remove("open"));
  }

  window.syncSidebarNav = function syncSidebarNav(screenId) {
    const navKey =
      screenId === "list" ? "courses" : screenId === "dashboard" ? "progress" : screenId === "community" ? "community" : screenId;
    document.querySelectorAll(".sidebar-nav .nav-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.nav === navKey);
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    wireSidebarNav();
    wireHomeQuickActions();
    wireComingSoonInteractions();
    wireCoursesTabs();
    wireTemplatesTabs();
    wirePreviewsMenu();
  });
})();
