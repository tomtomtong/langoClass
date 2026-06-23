const OPTION_LABELS = ["▲", "◆", "●", "■", "★", "⬡"];

const PLAYER_SOUND_EFFECTS = Object.freeze({
  click: "/assets/soundeffect/user_click.mp3",
  correct: "/assets/soundeffect/user_correct_answer.mp3",
  wrong: "/assets/soundeffect/user_wrong_answer.mp3",
});

const playerSoundBank = new Map();

function playPlayerSound(name, volume = 0.8) {
  const src = PLAYER_SOUND_EFFECTS[name];
  if (!src) return;

  let audio = playerSoundBank.get(name);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    playerSoundBank.set(name, audio);
  }

  audio.pause();
  audio.currentTime = 0;
  audio.volume = volume;
  const playPromise = audio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      /* Audio can be blocked until the first user gesture; fail silently. */
    });
  }
}

if (document.body?.classList.contains("join-page")) {
  document.addEventListener(
    "click",
    (event) => {
      if (event.target.closest("button:not(:disabled)")) {
        playPlayerSound("click", 0.65);
      }
    },
    { capture: true }
  );
}

const DEFAULT_TEACHER_LOGIN_USERNAME = "lango-developer-alex";
const DEFAULT_TEACHER_LOGIN_PASSWORD = "lango123";

function applyTeacherLoginDefaults(usernameInput, passwordInput, savedUsername) {
  if (usernameInput) {
    usernameInput.value = savedUsername || DEFAULT_TEACHER_LOGIN_USERNAME;
  }
  if (passwordInput) {
    passwordInput.value = DEFAULT_TEACHER_LOGIN_PASSWORD;
  }
}

function setQuestionImage(imgEl, wrapperEl, url) {
  const imageUrl = (url || "").trim();
  if (wrapperEl) wrapperEl.hidden = !imageUrl;
  if (!imgEl) return;
  if (imageUrl) {
    imgEl.src = imageUrl;
    imgEl.alt = "Question illustration";
  } else {
    imgEl.removeAttribute("src");
    imgEl.alt = "";
  }
}

function $(sel) {
  return document.querySelector(sel);
}

function normalizePin(pin) {
  return String(pin || "").replace(/\D/g, "").slice(0, 6);
}

let screenTransitionPromise = Promise.resolve();
let screenTransitionToken = 0;

function getScreenTransitionLayer() {
  const app = document.querySelector("#app.lango-host, body.join-page #app");
  if (!app) return null;
  let layer = app.querySelector(".host-page-transition");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "host-page-transition";
    layer.setAttribute("aria-hidden", "true");
    app.appendChild(layer);
  }

  if (document.body.classList.contains("join-page") && !layer.querySelector(".join-transition-cast")) {
    const cast = document.createElement("div");
    cast.className = "join-transition-cast";

    [1, 2, 3, 4].forEach((pose) => {
      const image = document.createElement("img");
      image.className = "join-transition-tommy";
      image.src = `/assets/transitions/user_uncletommy_${pose}.png`;
      image.alt = "";
      image.decoding = "async";
      image.loading = "eager";
      cast.appendChild(image);
    });

    layer.appendChild(cast);
  }
  return layer;
}

if (document.body?.classList.contains("join-page")) {
  getScreenTransitionLayer();
}

function selectJoinTransitionCharacter(layer) {
  const characters = [...(layer?.querySelectorAll(".join-transition-tommy") || [])];
  if (!characters.length) return;

  const previous = Number(layer.dataset.tommyPose ?? -1);
  let next = Math.floor(Math.random() * characters.length);
  if (characters.length > 1 && next === previous) {
    next = (next + 1 + Math.floor(Math.random() * (characters.length - 1))) % characters.length;
  }

  layer.dataset.tommyPose = String(next);
  characters.forEach((character, index) => {
    character.classList.toggle("is-active", index === next);
  });
}

function activateScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.querySelector(`#screen-${id}`)?.classList.add("active");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showScreen(id) {
  const next = document.querySelector(`#screen-${id}`);
  if (!next) return Promise.resolve();

  const current = document.querySelector(".screen.active");
  const layer = getScreenTransitionLayer();
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  if (!layer || !current || current === next || reduceMotion) {
    activateScreen(id);
    return Promise.resolve();
  }

  const token = ++screenTransitionToken;
  screenTransitionPromise = screenTransitionPromise
    .catch(() => {})
    .then(async () => {
      layer.classList.remove("is-playing");
      selectJoinTransitionCharacter(layer);
      void layer.offsetWidth;
      layer.classList.add("is-playing");
      await wait(920);
      if (token !== screenTransitionToken) return;
      activateScreen(id);
      await wait(260);
      if (token === screenTransitionToken) {
        layer.classList.remove("is-playing");
      }
    });

  return screenTransitionPromise;
}

function renderLeaderboard(listEl, entries, highlightId) {
  if (!listEl) return;
  const rows = (entries || []).map((p) => ({
    id: p.id ?? p.studentUserId,
    name: p.name ?? p.displayName ?? "Player",
    score: p.score ?? p.totalScore ?? 0,
  }));

  if (!rows.length) {
    listEl.innerHTML = `<li class="leaderboard-empty"><span>No scores yet</span></li>`;
    return;
  }

  listEl.innerHTML = rows
    .map(
      (p) =>
        `<li${p.id === highlightId ? ' class="me"' : ""}><span>${escapeHtml(p.name)}</span><span class="score">${p.score}</span></li>`
    )
    .join("");
}

function showExerciseLeaderboards({
  exerciseLeaderboard,
  semesterLeaderboard,
  highlightId,
  exerciseListEl,
  semesterListEl,
  semesterWrapEl,
  exerciseWrapEl,
}) {
  const hasExercise = (exerciseLeaderboard || []).length > 0;
  const hasSemester = (semesterLeaderboard || []).length > 0;

  const normalizeRows = (entries) =>
    (entries || []).map((p) => ({
      id: p.id ?? p.studentUserId,
      name: String(p.name ?? p.displayName ?? "Player"),
      score: p.score ?? p.totalScore ?? 0,
    }));

  const exerciseRows = normalizeRows(exerciseLeaderboard);
  const semesterRows = normalizeRows(semesterLeaderboard);
  const hostScreen = exerciseListEl?.closest(".host-leaderboard");

  if (hostScreen) {
    const tabs = [...hostScreen.querySelectorAll("[data-host-leaderboard-view]")];
    const title = hostScreen.querySelector("#host-leaderboard-title");

    const ordinal = (rank) => {
      const teen = rank % 100;
      if (teen >= 11 && teen <= 13) return `${rank}th`;
      if (rank % 10 === 1) return `${rank}st`;
      if (rank % 10 === 2) return `${rank}nd`;
      if (rank % 10 === 3) return `${rank}rd`;
      return `${rank}th`;
    };

    const renderHostBoard = (container, rows, overall) => {
      if (!container) return;
      if (!rows.length) {
        container.innerHTML = `<p class="host-leaderboard__empty">No scores yet</p>`;
        return;
      }

      const podium = rows.slice(0, 3)
        .map((row, index) => {
          const rank = index + 1;
          const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
          const initial = escapeHtml((row.name.trim()[0] || "?").toUpperCase());
          return `<li class="host-leaderboard__podium-row host-leaderboard__podium-row--${rank}">
            <div class="host-leaderboard__profile" aria-hidden="true">
              <span class="host-leaderboard__medal">${medal}</span>
              <span class="host-leaderboard__avatar">${initial}</span>
            </div>
            <span class="host-leaderboard__rank">${ordinal(rank)}</span>
            <span class="host-leaderboard__player">
              <span class="host-leaderboard__name">${escapeHtml(row.name)}</span>
              <span class="host-leaderboard__score">${Number(row.score).toLocaleString()} pts</span>
            </span>
          </li>`;
        })
        .join("");

      const rankings = rows.slice(3)
        .map((row, index) => {
          const rank = index + 4;
          const initial = escapeHtml((row.name.trim()[0] || "?").toUpperCase());
          return `<li class="host-leaderboard__ranking-row">
            <span class="host-leaderboard__ranking-rank">${rank}.</span>
            <span class="host-leaderboard__ranking-avatar" aria-hidden="true">${initial}</span>
            <span class="host-leaderboard__ranking-name">${escapeHtml(row.name)}</span>
            <span class="host-leaderboard__ranking-result">
              <strong>${Number(row.score).toLocaleString()} pts</strong>
              <small>${overall ? "Overall Score" : "Section Scores"}</small>
            </span>
          </li>`;
        })
        .join("");

      container.innerHTML = `<div class="host-leaderboard__columns">
        <ol class="host-leaderboard__podium">${podium}</ol>
        <ol class="host-leaderboard__rankings" start="4">${rankings || '<li class="host-leaderboard__empty host-leaderboard__empty--small">No other scores yet</li>'}</ol>
      </div>`;
    };

    const setHostView = (view) => {
      const overall = view === "overall" && hasSemester;
      exerciseWrapEl.hidden = overall;
      semesterWrapEl.hidden = !overall;
      if (title) title.textContent = overall ? "Overall Results" : "Leaderboard - Session 1";
      tabs.forEach((tab) => {
        const active = tab.dataset.hostLeaderboardView === (overall ? "overall" : "current");
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
    };

    renderHostBoard(exerciseListEl, exerciseRows, false);
    renderHostBoard(semesterListEl, semesterRows, true);
    tabs.forEach((tab) => {
      tab.hidden = tab.dataset.hostLeaderboardView === "overall" && !hasSemester;
      tab.onclick = () => setHostView(tab.dataset.hostLeaderboardView);
      tab.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const available = tabs.filter((item) => !item.hidden);
        const next = available[(available.indexOf(tab) + 1) % available.length];
        next.focus();
        next.click();
      };
    });
    setHostView("current");
    return;
  }

  const finishedScreen = exerciseListEl?.closest(".player-leaderboard");

  if (finishedScreen) {
    const tabs = [...finishedScreen.querySelectorAll("[data-leaderboard-view]")];
    const pointsEl = finishedScreen.querySelector("#player-current-points");

    const renderCards = (listEl, rows) => {
      if (!listEl) return;
      if (!rows.length) {
        listEl.innerHTML = `<li class="player-leaderboard__empty">No scores yet</li>`;
        return;
      }

      listEl.innerHTML = rows
        .slice(0, 3)
        .map((p, index) => {
          const rank = index + 1;
          const ordinal = rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd";
          const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
          const initial = escapeHtml((p.name.trim()[0] || "?").toUpperCase());
          return `<li class="player-leaderboard__row player-leaderboard__row--${rank}${p.id === highlightId ? " is-me" : ""}">
            <div class="player-leaderboard__profile" aria-hidden="true">
              <span class="player-leaderboard__medal">${medal}</span>
              <span class="player-leaderboard__avatar">${initial}</span>
            </div>
            <span class="player-leaderboard__rank">${ordinal}</span>
            <span class="player-leaderboard__player">
              <span class="player-leaderboard__name">${escapeHtml(p.name)}</span>
              <span class="player-leaderboard__score">${Number(p.score).toLocaleString()} pts</span>
            </span>
          </li>`;
        })
        .join("");
    };

    const setView = (view) => {
      const overall = view === "overall" && hasSemester;
      exerciseWrapEl.hidden = overall;
      semesterWrapEl.hidden = !overall;
      tabs.forEach((tab) => {
        const active = tab.dataset.leaderboardView === (overall ? "overall" : "current");
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });

      const rows = overall ? semesterRows : exerciseRows;
      const ownRow = rows.find((row) => row.id === highlightId);
      if (pointsEl) pointsEl.textContent = `${Number(ownRow?.score || 0).toLocaleString()} pts`;
    };

    renderCards(exerciseListEl, exerciseRows);
    renderCards(semesterListEl, semesterRows);
    tabs.forEach((tab) => {
      tab.hidden = tab.dataset.leaderboardView === "overall" && !hasSemester;
      tab.onclick = () => setView(tab.dataset.leaderboardView);
      tab.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const available = tabs.filter((item) => !item.hidden);
        const next = available[(available.indexOf(tab) + 1) % available.length];
        next.focus();
        next.click();
      };
    });
    setView("current");
    return;
  }

  if (exerciseWrapEl) exerciseWrapEl.hidden = !hasExercise;
  if (semesterWrapEl) semesterWrapEl.hidden = !hasSemester;

  if (hasExercise) {
    renderLeaderboard(exerciseListEl, exerciseLeaderboard, highlightId);
  } else if (exerciseListEl) {
    exerciseListEl.innerHTML = "";
  }

  if (hasSemester) {
    renderLeaderboard(semesterListEl, semesterLeaderboard, highlightId);
  } else if (semesterListEl) {
    semesterListEl.innerHTML = "";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const CLASS_LEVEL_FIELDS = [
  "englishLevel",
  "english_level",
  "level",
  "grade",
  "year",
  "primaryLevel",
  "primary_level",
  "section",
];

function extractClassList(data) {
  if (!data) return [];
  if (Array.isArray(data.classList)) return data.classList;
  if (Array.isArray(data.classes)) return data.classes;
  if (Array.isArray(data.data?.classList)) return data.data.classList;
  if (Array.isArray(data.data?.classes)) return data.data.classes;
  if (Array.isArray(data)) return data;
  return [];
}

function classStudentCount(classItem) {
  if (!classItem) return null;
  if (classItem.studentCount != null && Number.isFinite(Number(classItem.studentCount))) {
    return Number(classItem.studentCount);
  }
  if (Array.isArray(classItem.students)) return classItem.students.length;
  if (Array.isArray(classItem.studentList)) return classItem.studentList.length;
  if (Array.isArray(classItem.student_list)) return classItem.student_list.length;

  const count =
    classItem.student_count ??
    classItem.students_count ??
    classItem.totalStudents ??
    classItem.total_students ??
    classItem.numStudents;
  if (count == null || count === "") return null;
  const n = Number(count);
  return Number.isFinite(n) ? n : null;
}

function getClassLevelLabel(classItem) {
  for (const field of CLASS_LEVEL_FIELDS) {
    const value = classItem?.[field];
    if (value != null && String(value).trim()) return String(value).trim();
  }

  const name = classItem?.name || classItem?.class_name || "";
  const levelMatch = name.match(/\b(P[1-6]|S[1-6])\b/i);
  if (levelMatch) return levelMatch[1].toUpperCase();

  return "Classes";
}

function groupClassesByLevel(classes) {
  const groups = new Map();
  for (const classItem of classes) {
    const level = getClassLevelLabel(classItem);
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(classItem);
  }

  const order = (label) => {
    const match = label.match(/^[PS](\d+)$/i);
    if (match) return [label[0].toUpperCase(), Number(match[1])];
    return ["Z", label];
  };

  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      const [aType, aNum] = order(a);
      const [bType, bNum] = order(b);
      if (aType !== bType) return aType.localeCompare(bType);
      if (typeof aNum === "number" && typeof bNum === "number") return aNum - bNum;
      return String(a).localeCompare(String(b));
    })
    .map(([label, items]) => ({
      label: label === "Classes" ? "" : label,
      items: items.sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      ),
    }));
}

function renderOptions(container, options, { clickable, onClick, showBars, counts, correctIndex, optionLabels } = {}) {
  container.innerHTML = options
    .map((opt, i) => {
      const optionLabel = optionLabels?.[i] || OPTION_LABELS[i] || String.fromCharCode(65 + i);
      const pct = counts && counts[i] ? counts[i] : 0;
      const bar = showBars ? `<span class="bar" style="width:${pct}%"></span>` : "";
      const countLabel = showBars ? `<span>${pct}%</span>` : "";
      const classes = ["option"];
      if (clickable) classes.push("player-btn");
      if (correctIndex === i) classes.push("correct");
      return `<button type="button" class="${classes.join(" ")}" data-index="${i}"${clickable ? "" : " disabled"}>
          ${bar}
          <span class="label"><span>${optionLabel} ${escapeHtml(opt)}</span>${countLabel}</span>
        </button>`;
    })
    .join("");

  if (clickable && onClick) {
    container.querySelectorAll(".player-btn").forEach((btn) => {
      btn.addEventListener("click", () => onClick(Number(btn.dataset.index), btn));
    });
  }
}

function renderPlayerMcqResult(mine, leaderboard = [], playerId) {
  const screen = $("#screen-player-results");
  const msg = $("#player-result-msg");
  const icon = $("#player-result-icon");
  const points = $("#player-result-points");
  const encouragement = $("#player-result-encouragement");
  const score = $("#player-result-score");
  const questionScore = $("#player-score");
  const isCorrect = !!mine?.correct;
  const hasAnswer = mine?.answerIndex != null;
  const scoreRow = leaderboard.find((row) => row.id === playerId || row.playerId === playerId);

  playPlayerSound(isCorrect ? "correct" : "wrong");

  screen?.classList.toggle("is-correct", isCorrect);
  screen?.classList.toggle("is-wrong", !isCorrect);

  if (isCorrect) {
    msg.textContent = "You answered it correctly";
    msg.className = "result-msg correct";
    icon.textContent = "✅";
    points.textContent = `${mine?.points || 0} pts`;
    encouragement.textContent = "Keep going";
  } else if (hasAnswer) {
    msg.textContent = "You were so close !";
    msg.className = "result-msg wrong";
    icon.textContent = "💪";
    points.textContent = "0 pts";
    encouragement.textContent = "Keep it up for next time.";
  } else {
    msg.textContent = "Time's up";
    msg.className = "result-msg wrong";
    icon.textContent = "⏰";
    points.textContent = "0 pts";
    encouragement.textContent = "Try the next one";
  }

  const totalScore = scoreRow?.score || 0;
  if (score) score.textContent = `Score : ${totalScore}`;
  if (questionScore) questionScore.textContent = `Score : ${totalScore}`;
  renderLeaderboard($("#player-leaderboard"), leaderboard, playerId);
}

function resetPlayerMcqAnsweredState() {
  const screen = $("#screen-player-question");
  screen?.classList.remove("is-answered");
  const title = $("#player-mcq-title");
  const label = $("#player-selected-answer-label");
  if (title) title.textContent = "MCQ Question";
  if (label) label.hidden = true;
}

function showPlayerMcqAnsweredState(answerIndex) {
  const screen = $("#screen-player-question");
  const title = $("#player-mcq-title");
  const label = $("#player-selected-answer-label");
  const timerRing = $("#timer-ring");
  const buttons = $("#player-options")?.querySelectorAll(".player-btn") || [];

  screen?.classList.add("is-answered");
  if (title) title.textContent = "Quick Questions";
  if (label) label.hidden = false;
  timerRing?.classList.remove("urgent");
  buttons.forEach((button, index) => {
    button.disabled = true;
    button.classList.toggle("selected", index === answerIndex);
  });
}

function startDeadlineTimer(endsAt, fallbackSeconds, onTick, onEnd) {
  clearTimer();
  const fallback = Math.max(0, Number(fallbackSeconds) || 0);
  const deadline = Number(endsAt) || Date.now() + fallback * 1000;
  let lastRemaining = null;

  const tick = () => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining !== lastRemaining) {
      lastRemaining = remaining;
      onTick(remaining);
    }
    if (remaining <= 0) {
      clearTimer();
      onEnd?.();
    }
  };

  tick();
  if (lastRemaining > 0) {
    window._timerInterval = setInterval(tick, 200);
  }
}

function startTimer(seconds, onTick, onEnd) {
  clearTimer();
  let remaining = seconds;
  onTick(remaining);

  window._timerInterval = setInterval(() => {
    remaining -= 1;
    onTick(remaining);
    if (remaining <= 0) {
      clearTimer();
      onEnd?.();
    }
  }, 1000);
}

function clearTimer() {
  if (window._timerInterval) {
    clearInterval(window._timerInterval);
    window._timerInterval = null;
  }
}
