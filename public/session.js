(() => {
  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(location.search);
  const code = (params.get("code") || "").toUpperCase();
  const LOBBY_DEFAULT = 15;

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function loadRegistry() {
    const base = { ...(window.LANGO_SESSIONS || {}) };
    try {
      const stored = JSON.parse(localStorage.getItem("lango-session-registry") || "{}");
      return { ...base, ...stored };
    } catch {
      return base;
    }
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatWhen(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function sessionPhase(session, now = new Date()) {
    const start = session.scheduledStartAt ? new Date(session.scheduledStartAt) : null;
    if (!start) return "lobby";
    const lobbyMin = session.lobbyOpensMinutes ?? LOBBY_DEFAULT;
    const lobbyOpen = new Date(start.getTime() - lobbyMin * 60 * 1000);
    const end = new Date(start.getTime() + 50 * 60 * 1000);
    if (now < lobbyOpen) return "waiting";
    if (now < start) return "lobby";
    if (now < end) return "live";
    return "ended";
  }

  function renderPrep(session) {
    const list = $("#prep-list");
    list.innerHTML = "";
    const steps = session.preSession?.prepSteps || [];
    const doneKey = `lango-prep-${code}`;
    let done = {};
    try {
      done = JSON.parse(localStorage.getItem(doneKey) || "{}");
    } catch {
      done = {};
    }
    steps.forEach((step) => {
      const li = document.createElement("li");
      li.className = "prep-item";
      const checked = !!done[step.id];
      li.innerHTML = `
        <label>
          <input type="checkbox" data-prep="${step.id}" ${checked ? "checked" : ""} />
          <span>${step.label}</span>
        </label>`;
      li.querySelector("input").addEventListener("change", (e) => {
        done[step.id] = e.target.checked;
        localStorage.setItem(doneKey, JSON.stringify(done));
        if (step.id === "trailer" && e.target.checked) {
          $("#trailer-watched").hidden = false;
        }
      });
      list.appendChild(li);
    });
  }

  function renderTrailer(session) {
    const pre = session.preSession || {};
    $("#trailer-title").textContent = pre.trailerTitle || session.sectionTitle || session.courseName;
    $("#trailer-text").textContent = pre.trailerText || "";
    const img = pre.trailerImage || session.cover;
    $("#trailer-frame").innerHTML = img
      ? `<img alt="" src="${img}" /><div class="trailer-play-overlay">▶</div>`
      : `<div class="trailer-placeholder">Trailer</div>`;
    $("#trailer-play").addEventListener("click", () => {
      $("#trailer-watched").hidden = false;
      const box = document.querySelector('[data-prep="trailer"]');
      if (box) {
        box.checked = true;
        box.dispatchEvent(new Event("change"));
      }
      toast("Trailer playing (mock)");
    });
  }

  function tickCountdown(start, lobbyMin) {
    const now = new Date();
    const diff = start - now;
    if (diff <= 0) {
      $("#countdown-digits").textContent = "00:00:00";
      return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    $("#countdown-digits").textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    $("#countdown-note").textContent = `Lobby opened ${lobbyMin} minutes before start · ${formatWhen(start.toISOString())}`;
  }

  function showPhase(phase) {
    ["sess-trailer", "sess-prep", "sess-countdown", "sess-live", "sess-ended", "sess-wait"].forEach((id) => {
      $(`#${id}`).hidden = true;
    });
    const labels = { waiting: "Scheduled", lobby: "Lobby open", live: "Live", ended: "Ended" };
    $("#sess-phase").textContent = labels[phase] || phase;
    $("#sess-phase").className = `badge phase-${phase}`;
    if (phase === "waiting") $("#sess-wait").hidden = false;
    if (phase === "lobby") {
      $("#sess-trailer").hidden = false;
      $("#sess-prep").hidden = false;
      $("#sess-countdown").hidden = false;
    }
    if (phase === "live") $("#sess-live").hidden = false;
    if (phase === "ended") $("#sess-ended").hidden = false;
  }

  function init() {
    const registry = loadRegistry();
    const session = registry[code];
    const link = `${location.origin}${location.pathname}?code=${encodeURIComponent(code)}`;
    $("#sess-link").textContent = link;
    $("#copy-link").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast("Link copied");
      } catch {
        toast(link);
      }
    });

    if (!code || !session) {
      $("#sess-title").textContent = "Session not found";
      $("#sess-sub").textContent = code ? `Unknown code: ${code}` : "Add ?code=GREET-2 to the URL";
      showPhase("ended");
      return;
    }

    document.title = `${session.sectionTitle || session.courseName} · Lango Class`;
    $("#sess-title").textContent = session.sectionTitle || session.courseName;
    $("#sess-sub").textContent = `${session.courseName}${session.className ? ` · ${session.className}` : ""}`;
    $("#sess-schedule").innerHTML = `
      <div class="schedule-row">
        <span class="hint">Scheduled start</span>
        <strong>${formatWhen(session.scheduledStartAt)}</strong>
      </div>`;

    const start = session.scheduledStartAt ? new Date(session.scheduledStartAt) : null;
    const lobbyMin = session.lobbyOpensMinutes ?? LOBBY_DEFAULT;
    if (start) {
      $("#wait-body").textContent = `Lobby opens ${lobbyMin} minutes before start (${formatWhen(new Date(start.getTime() - lobbyMin * 60000).toISOString())}).`;
    }

    renderTrailer(session);
    renderPrep(session);

    const course = session.courseId || "";
    const section = session.sectionId || "";
    $("#join-live").href = `join.html?preview=1&course=${encodeURIComponent(course)}&section=${encodeURIComponent(section)}`;
    $("#host-live").href = `host.html?course=${encodeURIComponent(course)}&section=${encodeURIComponent(section)}`;

    const nameKey = "lango-display-name";
    const nameInput = $("#display-name");
    nameInput.value = localStorage.getItem(nameKey) || "";
    nameInput.addEventListener("input", () => localStorage.setItem(nameKey, nameInput.value.slice(0, 40)));

    function refresh() {
      const phase = sessionPhase(session);
      showPhase(phase);
      if (phase === "lobby" && start) tickCountdown(start, lobbyMin);
    }

    refresh();
    setInterval(refresh, 1000);
  }

  init();
})();
