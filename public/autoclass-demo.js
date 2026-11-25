// Autoclass demo page: autoclass on the left, timetable top right, promo videos bottom right.
// Edit SCHEDULE and PROMOS below. Times are 24h "HH:MM", every day (the demo has no dates).
// ?now=10:20 pretends it is 10:20 (the clock keeps ticking from there), for trying it out.
(function () {
  "use strict";

  // The three autoclass lessons (autoclass-video/lessons/<id>.json), run in turn.
  const LESSONS = [
    { lesson: "hk-nostalgia", title: "香港老友記：估估佢係乜", sub: "Hong Kong nostalgia" },
    { lesson: "dont-get-fooled-by-ai", title: "唔好俾 AI 呃到你", sub: "Don't get fooled by AI" },
    { lesson: "animal-homes", title: "Animal Homes", sub: "English" },
  ];
  // The timetable: from START every LENGTH minutes with a GAP between, until a lesson would end after END.
  const LOBBY_LEAD = 90; // seconds before a lesson starts that its waiting room (QR code, who has joined) goes up
  const LOBBY_MIN = 30; // the shortest wait, when the page is opened late or in the middle of a lesson
  const START = "10:00", END = "17:00", LENGTH = 30, GAP = 10;
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const SCHEDULE = [];
  {
    const [sh, sm] = START.split(":").map(Number);
    const [eh, em] = END.split(":").map(Number);
    for (let t = sh * 60 + sm, i = 0; t + LENGTH <= eh * 60 + em; t += LENGTH + GAP, i++) {
      SCHEDULE.push({ ...LESSONS[i % LESSONS.length], from: hhmm(t), to: hhmm(t + LENGTH) });
    }
  }
  // Files in public/demo-media/, played in order and then round again.
  const PROMOS = [
    { src: "/demo-media/promo-video-1121.mp4", label: "Promo" },
    { src: "/demo-media/lango-reels-60s.mp4", label: "Reels 60s" },
    { src: "/demo-media/lango-parent-student-guide.mp4", label: "家長學生教學" },
    { src: "/demo-media/eiken-pre2-internship.mp4", label: "Eiken Pre2" },
    { src: "/demo-media/ai-smart-life.mp4", label: "AI智慧生活" },
    { src: "/demo-media/video-2026-10-14.mp4", label: "Video 10/14" },
  ];

  const el = (id) => document.getElementById(id);
  const frame = el("class-frame");
  const list = el("schedule");
  const autoBox = el("auto");
  const promo = el("promo");
  const tabs = el("promo-tabs");

  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return h * 60 + m;
  };
  const pad = (n) => String(n).padStart(2, "0");

  // "Now" in seconds since midnight, honouring ?now=HH:MM.
  const fake = new URLSearchParams(location.search).get("now");
  const fakeOffset = fake && /^\d{1,2}:\d{2}$/.test(fake) ? (toMin(fake) * 60 - nowRealSeconds() + 86400) % 86400 : 0;
  function nowRealSeconds() {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }
  function nowSeconds() {
    return (nowRealSeconds() + fakeOffset) % 86400;
  }

  function statusAt(slot, sec) {
    if (sec >= toMin(slot.from) * 60 && sec < toMin(slot.to) * 60) return "live";
    if (sec >= toMin(slot.to) * 60) return "done";
    return "upcoming";
  }

  const countdown = el("countdown");
  const ENDED_HOLD_MS = 25000; // the class's final board stays up this long before the countdown
  let selected = -1; // the slot shown in the frame, -1 when the countdown is up
  let autoSlot = -1; // the live slot the frame was last switched to automatically
  let endedTimer = null;

  // lobbySeconds: how long the class waits for people to scan in before it starts by itself.
  function openLesson(index, lobbySeconds = LOBBY_MIN) {
    if (index === selected && countdown.hidden) return; // do not restart a class that is running
    clearTimeout(endedTimer);
    selected = index;
    countdown.hidden = true;
    frame.src = `/autoclass.html?autostart=1&lobby=${Math.round(lobbySeconds)}&lesson=${encodeURIComponent(SCHEDULE[index].lesson)}`;
    render();
  }

  // The lesson to have open now: one whose waiting room should be up (LOBBY_LEAD seconds before it
  // starts) or that is already on. Not while another class is still running (a few minutes' grace).
  function dueLesson(sec) {
    const i = SCHEDULE.findIndex((s) => sec < toMin(s.to) * 60 && toMin(s.from) * 60 - sec <= LOBBY_LEAD);
    if (i < 0 || i === autoSlot) return -1;
    const busy = selected >= 0 && sec < toMin(SCHEDULE[selected].to) * 60 + 300;
    return busy && selected !== i ? -1 : i;
  }

  // The left pane as a countdown to the next lesson (a blank frame stops the old class and its sound).
  function showCountdown() {
    clearTimeout(endedTimer);
    selected = -1;
    frame.src = "about:blank";
    countdown.hidden = false;
    updateCountdown();
    render();
  }

  function updateCountdown() {
    const sec = nowSeconds();
    const next = SCHEDULE.find((s) => statusAt(s, sec) === "upcoming");
    el("cd-hint").hidden = !next;
    if (!next) {
      el("cd-label").textContent = "今日嘅課堂完咗";
      el("cd-title").textContent = "多謝大家，下次見！";
      el("cd-time").textContent = "";
      el("cd-at").textContent = "";
      return;
    }
    const left = toMin(next.from) * 60 - sec;
    const h = Math.floor(left / 3600);
    el("cd-label").textContent = "下一堂";
    el("cd-title").textContent = next.title;
    el("cd-time").textContent = `${h ? h + ":" : ""}${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
    el("cd-at").textContent = `${next.from} 開始`;
  }

  // The class page says when its class is over (final board up): hold it a while, then count down.
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type !== "autoclass-ended" || selected < 0) return;
    const ended = selected;
    clearTimeout(endedTimer);
    endedTimer = setTimeout(() => {
      if (selected === ended) showCountdown();
    }, ENDED_HOLD_MS);
  });

  let lastMinute = -1;
  function render() {
    const sec = nowSeconds();
    const now = Math.floor(sec / 60);
    lastMinute = now;
    const nextIndex = SCHEDULE.findIndex((s) => statusAt(s, sec) === "upcoming");
    el("clock").textContent = `${pad(Math.floor(now / 60))}:${pad(now % 60)}`;
    const keepScroll = list.scrollTop;
    list.textContent = "";
    SCHEDULE.forEach((slot, i) => {
      const status = statusAt(slot, sec);
      const isNext = status === "upcoming" && i === nextIndex;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `slot ${status === "upcoming" ? "" : status} ${isNext ? "next" : ""} ${i === selected ? "selected" : ""}`.replace(/\s+/g, " ").trim();
      const badge = status === "live" ? "上課中" : status === "done" ? "已完" : isNext ? `${Math.ceil((toMin(slot.from) * 60 - sec) / 60)} 分鐘後` : "未開始";
      btn.innerHTML = `<span class="time"></span><span class="name"></span><span class="badge"></span>`;
      btn.querySelector(".time").textContent = `${slot.from}–${slot.to}`;
      btn.querySelector(".name").innerHTML = `${escapeHtml(slot.title)}<span class="sub">${escapeHtml(slot.sub || "")}</span>`;
      btn.querySelector(".badge").textContent = badge;
      if (i === selected) btn.setAttribute("aria-current", "true");
      btn.addEventListener("click", () => openLesson(i));
      li.appendChild(btn);
      list.appendChild(li);
    });
    list.scrollTop = keepScroll;
    // Keep the open (or next) lesson in view, only when that changed, so a scroll by hand is left alone.
    const focus = selected >= 0 ? selected : nextIndex;
    if (scrolledTo !== focus) {
      scrolledTo = focus;
      const row = list.children[focus]?.firstElementChild;
      if (row) list.scrollTop = row.offsetTop - list.offsetTop - 8;
    }
  }
  let scrolledTo = -2;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  // Every second: open the next lesson when its waiting room is due (a click on the timetable wins
  // until then), keep the countdown running, and redraw the timetable each minute.
  function tick() {
    const sec = nowSeconds();
    if (autoBox.checked) {
      const due = dueLesson(sec);
      if (due >= 0) {
        autoSlot = due;
        openLesson(due, Math.max(LOBBY_MIN, toMin(SCHEDULE[due].from) * 60 - sec));
      }
    }
    if (!countdown.hidden) updateCountdown();
    if (Math.floor(sec / 60) !== lastMinute) render();
  }

  // Promo videos: one at a time, next one when it ends.
  let promoIndex = 0;
  function playPromo(index, autoplay) {
    promoIndex = index;
    promo.src = PROMOS[index].src;
    if (autoplay) promo.play().catch(() => {});
    [...tabs.children].forEach((b, i) => b.setAttribute("aria-selected", String(i === index)));
  }
  PROMOS.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.textContent = p.label;
    b.addEventListener("click", () => playPromo(i, true));
    tabs.appendChild(b);
  });
  promo.addEventListener("ended", () => playPromo((promoIndex + 1) % PROMOS.length, true));
  playPromo(0, true); // muted, so the browser allows autoplay; the lesson keeps the sound

  // Start: the lesson that is due (waiting room or on), else count down to the next one.
  const due0 = dueLesson(nowSeconds());
  if (due0 >= 0) {
    autoSlot = due0;
    openLesson(due0, Math.max(LOBBY_MIN, toMin(SCHEDULE[due0].from) * 60 - nowSeconds()));
  } else showCountdown();
  setInterval(tick, 1000);
})();
