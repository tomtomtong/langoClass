const OPTION_LABELS = ["▲", "◆", "●", "■", "★", "⬡"];

function isHkElderlyVariant() {
  return window.LANGO_VARIANT === "hk-elderly";
}

function langoJoinPagePath() {
  return isHkElderlyVariant() ? "/hk/join.html" : "/join.html";
}

function uiT(key, vars) {
  return window.LangoI18n?.t?.(key, vars) ?? key;
}

const PLAYER_SOUND_EFFECTS = Object.freeze({
  click: "/assets/soundeffect/user_click.mp3",
  correct: "/assets/soundeffect/user_correct_answer.mp3",
  wrong: "/assets/soundeffect/user_wrong_answer.mp3",
  celebrate: "/assets/soundeffect/login_success.mp3",
});

const playerSoundBank = new Map();
const playerSoundEffectsMuted = false;

function playPlayerSound(name, volume = 0.8) {
  if (playerSoundEffectsMuted) return;
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

function hideQuestionImage(imgEl, wrapperEl) {
  if (wrapperEl) {
    wrapperEl.hidden = true;
    wrapperEl.setAttribute("aria-hidden", "true");
  }
  if (!imgEl) return;
  imgEl.hidden = true;
  imgEl.onload = null;
  imgEl.onerror = null;
  // Keep a real asset path so markup never ships a broken empty <img src>.
  imgEl.src = "/assets/login/sparkle.png";
  imgEl.alt = "";
}

function setQuestionImage(imgEl, wrapperEl, url) {
  const imageUrl = (url || "").trim();
  hideQuestionImage(imgEl, wrapperEl);
  if (!imageUrl || !imgEl) return;

  const show = () => {
    imgEl.hidden = false;
    if (wrapperEl) {
      wrapperEl.hidden = false;
      wrapperEl.removeAttribute("aria-hidden");
    }
  };

  imgEl.onload = show;
  imgEl.onerror = () => hideQuestionImage(imgEl, wrapperEl);
  imgEl.alt = "Question illustration";
  imgEl.src = imageUrl;

  if (imgEl.complete) {
    if (imgEl.naturalWidth > 0) show();
    else hideQuestionImage(imgEl, wrapperEl);
  }
}

function $(sel) {
  return document.querySelector(sel);
}

function normalizePin(pin) {
  return String(pin || "").replace(/\D/g, "").slice(0, 6);
}

function formatRoomCode(roomId) {
  const digits = normalizePin(roomId);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
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

  const usesCharacterTransition =
    document.body.classList.contains("join-page") || app.classList.contains("lango-host");

  if (usesCharacterTransition && !layer.querySelector(".join-transition-cast")) {
    // Real portal/sparks nodes only when GSAP is available; otherwise keep CSS ::before/::after.
    window.LangoGsap?.ensureTransitionFx?.(layer);

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
  } else if (usesCharacterTransition) {
    window.LangoGsap?.ensureTransitionFx?.(layer);
  }
  return layer;
}

if (
  document.body?.classList.contains("join-page") ||
  document.querySelector("#app.lango-host")
) {
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
  window.dispatchEvent(new CustomEvent("lango:screen-change", { detail: { screenId: id } }));
}

/** Invalidate in-flight page transitions so a later activateScreen/showScreen sticks. */
function cancelScreenTransition() {
  screenTransitionToken++;
  window.LangoGsap?.killScreenTransition?.();
  document.querySelector(".host-page-transition")?.classList.remove("is-playing");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showScreen(id, { transition = true } = {}) {
  const next = document.querySelector(`#screen-${id}`);
  if (!next) return Promise.resolve();

  const current = document.querySelector(".screen.active");

  if (!transition) {
    cancelScreenTransition();
    activateScreen(id);
    return Promise.resolve();
  }

  const layer = getScreenTransitionLayer();
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  if (!layer || !current || current === next || reduceMotion) {
    cancelScreenTransition();
    activateScreen(id);
    return Promise.resolve();
  }

  const token = ++screenTransitionToken;
  screenTransitionPromise = screenTransitionPromise
    .catch(() => {})
    .then(async () => {
      if (token !== screenTransitionToken) return;

      layer.classList.remove("is-playing");
      selectJoinTransitionCharacter(layer);

      if (window.LangoGsap?.playScreenTransition) {
        window.LangoGsap.killScreenTransition?.();
        await window.LangoGsap.playScreenTransition(layer, {
          coveredAt: 0.92,
          duration: 1.18,
          onCovered: () => {
            if (token === screenTransitionToken) activateScreen(id);
          },
        });
        return;
      }

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
    name: p.name ?? p.displayName ?? uiT("leaderboard.player"),
    score: p.score ?? p.totalScore ?? 0,
  }));

  if (!rows.length) {
    listEl.innerHTML = `<li class="leaderboard-empty"><span>${uiT("leaderboard.noScores")}</span></li>`;
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
  accuracyLeaderboard,
  totalQuestions,
}) {
  const hasExercise = (exerciseLeaderboard || []).length > 0;
  const hasSemester = (semesterLeaderboard || []).length > 0;

  const normalizeRows = (entries) =>
    (entries || []).map((p) => ({
      id: p.id ?? p.studentUserId,
      name: String(p.name ?? p.displayName ?? "Player"),
      score: p.score ?? p.totalScore ?? 0,
    }));
  const sortLeaderboardRows = (rows) =>
    [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const samePlayerId = (left, right) =>
    left != null && right != null && String(left) === String(right);
  const playerRankFor = (rows, playerId) => {
    const index = rows.findIndex((row) => samePlayerId(row.id, playerId));
    return index >= 0 ? index + 1 : null;
  };
  const ordinalLabel = (rank) => {
    const teen = rank % 100;
    if (teen >= 11 && teen <= 13) return `${rank}th`;
    if (rank % 10 === 1) return `${rank}st`;
    if (rank % 10 === 2) return `${rank}nd`;
    if (rank % 10 === 3) return `${rank}rd`;
    return `${rank}th`;
  };
  const encouragementFor = (rank, rows, ownScore) => {
    if (!rank) return uiT("leaderboard.getOnBoard");
    if (rank === 1) return uiT("leaderboard.firstPlace");
    if (rank === 2 || rank === 3) return uiT("leaderboard.podium");
    const topCut = Math.max(3, Math.ceil(rows.length * 0.3));
    if (rank <= topCut) return uiT("leaderboard.topClassEncourage");
    const ahead = rows[rank - 2];
    if (ahead) {
      const gap = Math.max(0, Number(ahead.score) - Number(ownScore || 0));
      if (gap > 0) return uiT("leaderboard.ptsToClimb", { n: gap.toLocaleString() });
    }
    return uiT("leaderboard.stillClimbing");
  };
  const classPulseHtml = (rows) => {
    const scored = rows.filter((row) => Number(row.score) > 0).length || rows.length;
    const totalPts = rows.reduce((sum, row) => sum + Math.max(0, Number(row.score) || 0), 0);
    return `
      <div class="host-leaderboard__pulse-chip">
        <strong>${scored}</strong>
        <span>${uiT("leaderboard.playersScored")}</span>
      </div>
      <div class="host-leaderboard__pulse-chip">
        <strong>${totalPts.toLocaleString()}</strong>
        <span>${uiT("leaderboard.classPts")}</span>
      </div>`;
  };
  const fillScoresFallback = (root) => {
    root?.querySelectorAll?.("[data-score-value]")?.forEach((el) => {
      const value = Number(el.dataset.scoreValue || 0);
      el.textContent = uiT("leaderboard.pts", { n: value.toLocaleString() });
    });
  };
  const accuracyForPlayer = (playerId) => {
    if (!playerId || !Array.isArray(accuracyLeaderboard)) return null;
    const entry = accuracyLeaderboard.find(
      (row) => samePlayerId(row.id ?? row.playerId, playerId)
    );
    if (!entry) return null;
    const correct = Number(entry.correctAnswers ?? entry.correct ?? 0);
    const total =
      Number(totalQuestions) ||
      Number(entry.totalQuestions) ||
      (entry.accuracyPercent != null && correct
        ? Math.round(correct / (Number(entry.accuracyPercent) / 100))
        : 0);
    if (!total && entry.accuracyPercent == null) return { correct, total: null };
    return { correct, total: total || null, percent: entry.accuracyPercent };
  };

  const exerciseRows = sortLeaderboardRows(normalizeRows(exerciseLeaderboard));
  const semesterRows = sortLeaderboardRows(normalizeRows(semesterLeaderboard));
  const hostScreen = exerciseListEl?.closest(".host-leaderboard");

  if (hostScreen) {
    const tabs = [...hostScreen.querySelectorAll("[data-host-leaderboard-view]")];
    const title = hostScreen.querySelector("#host-leaderboard-title");
    const pulseEl = hostScreen.querySelector("#host-leaderboard-pulse");

    const renderHostBoard = (container, rows, overall) => {
      if (!container) return;
      if (!rows.length) {
        container.innerHTML = `<p class="host-leaderboard__empty">${uiT("leaderboard.noScores")}</p>`;
        return;
      }

      const podium = rows.slice(0, 3)
        .map((row, index) => {
          const rank = index + 1;
          const initial = escapeHtml((row.name.trim()[0] || "?").toUpperCase());
          return `<li class="host-leaderboard__podium-row host-leaderboard__podium-row--${rank}" data-reveal="podium" data-reveal-order="${4 - rank}">
            <div class="host-leaderboard__podium-person">
              ${rank === 1 ? '<span class="host-leaderboard__crown" aria-hidden="true"></span>' : ""}
              <span class="host-leaderboard__avatar">${initial}</span>
              <span class="host-leaderboard__name">${escapeHtml(row.name)}</span>
              <span class="host-leaderboard__score-pill">
                <span class="host-leaderboard__score" data-score-value="${Number(row.score)}">${uiT("leaderboard.pts", { n: 0 })}</span>
              </span>
            </div>
            <div class="host-leaderboard__plinth" aria-hidden="true">
              <span class="host-leaderboard__plinth-num">${rank}</span>
            </div>
          </li>`;
        })
        .join("");

      const rankings = rows.slice(3)
        .map((row, index) => {
          const rank = index + 4;
          const initial = escapeHtml((row.name.trim()[0] || "?").toUpperCase());
          return `<li class="host-leaderboard__ranking-row" data-reveal="rank">
            <span class="host-leaderboard__ranking-rank">${rank}</span>
            <span class="host-leaderboard__ranking-avatar" aria-hidden="true">${initial}</span>
            <span class="host-leaderboard__ranking-name">${escapeHtml(row.name)}</span>
            <strong class="host-leaderboard__score" data-score-value="${Number(row.score)}">${uiT("leaderboard.pts", { n: 0 })}</strong>
          </li>`;
        })
        .join("");

      container.innerHTML = `<div class="host-leaderboard__arena">
        <div class="host-leaderboard__spotlight">
          <ol class="host-leaderboard__podium" aria-label="${escapeHtml(uiT("leaderboard.topOfClass"))}">${podium}</ol>
        </div>
        <section class="host-leaderboard__sheet">
          <div class="host-leaderboard__sheet-handle" aria-hidden="true"></div>
          <ol class="host-leaderboard__rankings" start="4">${rankings || `<li class="host-leaderboard__empty host-leaderboard__empty--small">${uiT("leaderboard.noOtherScores")}</li>`}</ol>
        </section>
      </div>`;
    };

    const updatePulse = (rows) => {
      if (!pulseEl) return;
      pulseEl.innerHTML = rows.length ? classPulseHtml(rows) : "";
    };

    const runHostReveal = (boardRoot) => {
      if (window.LangoGsap?.playLeaderboardReveal) {
        window.LangoGsap.playLeaderboardReveal(hostScreen, { boardRoot });
        return;
      }
      fillScoresFallback(hostScreen);
    };

    const setHostView = (view, { animate = false } = {}) => {
      const overall = view === "overall" && hasSemester;
      exerciseWrapEl.hidden = overall;
      semesterWrapEl.hidden = !overall;
      if (title) title.textContent = overall ? uiT("leaderboard.overallResults") : uiT("leaderboard.exerciseResults");
      updatePulse(overall ? semesterRows : exerciseRows);
      tabs.forEach((tab) => {
        const active = tab.dataset.hostLeaderboardView === (overall ? "overall" : "current");
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      if (animate) {
        const board = overall ? semesterWrapEl || semesterListEl : exerciseWrapEl || exerciseListEl;
        runHostReveal(board);
      }
    };

    renderHostBoard(exerciseListEl, exerciseRows, false);
    renderHostBoard(semesterListEl, semesterRows, true);
    tabs.forEach((tab) => {
      tab.hidden = tab.dataset.hostLeaderboardView === "overall" && !hasSemester;
      tab.onclick = () => setHostView(tab.dataset.hostLeaderboardView, { animate: true });
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
    requestAnimationFrame(() => {
      runHostReveal(exerciseWrapEl || exerciseListEl);
    });
    return;
  }

  const finishedScreen = exerciseListEl?.closest(".player-leaderboard");

  if (finishedScreen) {
    const tabs = [...finishedScreen.querySelectorAll("[data-leaderboard-view]")];
    const pointsEl = finishedScreen.querySelector("#player-current-points");
    const rankEl = finishedScreen.querySelector("#player-current-rank");
    const encouragementEl = finishedScreen.querySelector("#player-encouragement");
    const accuracyEl = finishedScreen.querySelector("#player-accuracy-line");
    const meHero = finishedScreen.querySelector("#player-me-hero");
    const boardLabel = finishedScreen.querySelector("#player-board-label");

    const renderPlayerRow = (player, rank, { compact = false, isMe = false } = {}) => {
      const initial = escapeHtml((player.name.trim()[0] || "?").toUpperCase());
      const podium = rank <= 3;
      const rowClass = [
        "player-leaderboard__row",
        "player-leaderboard__row--sheet",
        compact ? "player-leaderboard__row--compact" : "",
        podium ? `player-leaderboard__row--${rank}` : "player-leaderboard__row--rest",
        isMe || samePlayerId(player.id, highlightId) ? "is-me" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<li class="${rowClass}">
        <span class="player-leaderboard__rank-badge">${rank}</span>
        <span class="player-leaderboard__avatar" aria-hidden="true">${initial}</span>
        <span class="player-leaderboard__meta">
          <span class="player-leaderboard__name">${escapeHtml(player.name)}</span>
        </span>
        <span class="player-leaderboard__score">${uiT("leaderboard.pts", { n: Number(player.score).toLocaleString() })}</span>
      </li>`;
    };

    const neighborSlice = (rows, ownRank) => {
      if (!rows.length) return [];
      if (!ownRank || ownRank <= 3) return rows.slice(0, Math.min(3, rows.length));
      const start = Math.max(0, ownRank - 2);
      const end = Math.min(rows.length, ownRank + 1);
      return rows.slice(start, end).map((row, i) => ({ row, rank: start + i + 1 }));
    };

    const renderCards = (listEl, rows) => {
      if (!listEl) return;
      if (!rows.length) {
        listEl.innerHTML = `<li class="player-leaderboard__empty">${uiT("leaderboard.noScores")}</li>`;
        return;
      }

      const ownRank = highlightId ? playerRankFor(rows, highlightId) : null;
      let html = "";

      if (!ownRank || ownRank <= 3) {
        html = rows
          .slice(0, 3)
          .map((player, index) =>
            renderPlayerRow(player, index + 1, {
              compact: true,
              isMe: samePlayerId(player.id, highlightId),
            })
          )
          .join("");
      } else {
        const neighbors = neighborSlice(rows, ownRank);
        html = neighbors
          .map(({ row, rank }) =>
            renderPlayerRow(row, rank, {
              compact: true,
              isMe: samePlayerId(row.id, highlightId),
            })
          )
          .join("");
      }
      listEl.innerHTML = html;
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
      const ownRank = highlightId ? playerRankFor(rows, highlightId) : null;
      const ownRow = ownRank ? rows[ownRank - 1] : null;
      const score = Number(ownRow?.score || 0);

      if (pointsEl) {
        pointsEl.dataset.scoreValue = String(score);
        pointsEl.textContent = uiT("leaderboard.pts", { n: 0 });
      }
      if (rankEl) {
        rankEl.textContent = ownRank ? ordinalLabel(ownRank) : "—";
        rankEl.hidden = false;
      }
      if (encouragementEl) {
        encouragementEl.textContent = encouragementFor(ownRank, rows, score);
      }
      if (accuracyEl) {
        const accuracy = !overall ? accuracyForPlayer(highlightId) : null;
        if (accuracy && (accuracy.total || accuracy.correct != null)) {
          accuracyEl.hidden = false;
          accuracyEl.textContent = accuracy.total
            ? uiT("leaderboard.correctOfTotal", {
                correct: accuracy.correct,
                total: accuracy.total,
              })
            : uiT("leaderboard.correctCount", { correct: accuracy.correct });
        } else {
          accuracyEl.hidden = true;
          accuracyEl.textContent = "";
        }
      }
      if (boardLabel) {
        boardLabel.textContent =
          ownRank && ownRank > 3 ? uiT("leaderboard.nearYou") : uiT("leaderboard.topOfClass");
      }
      if (meHero) {
        meHero.classList.toggle("is-podium", ownRank != null && ownRank <= 3);
        meHero.classList.toggle("is-first", ownRank === 1);
      }
      if (window.LangoGsap?.playPlayerLeaderboardEnter) {
        window.LangoGsap.playPlayerLeaderboardEnter(finishedScreen);
      } else if (pointsEl) {
        pointsEl.textContent = uiT("leaderboard.pts", { n: score.toLocaleString() });
      }
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
    msg.textContent = uiT("mcq.resultCorrect");
    msg.dataset.text = msg.textContent;
    msg.className = "result-msg correct";
    icon.textContent = "✅";
    points.textContent = uiT("leaderboard.pts", { n: mine?.points || 0 });
    points.dataset.text = points.textContent;
    encouragement.textContent = uiT("mcq.encourageKeepGoing");
    encouragement.dataset.text = encouragement.textContent;
  } else if (hasAnswer) {
    msg.textContent = uiT("mcq.resultClose");
    msg.dataset.text = msg.textContent;
    msg.className = "result-msg wrong";
    icon.textContent = "💪";
    points.textContent = uiT("leaderboard.pts", { n: 0 });
    points.dataset.text = points.textContent;
    encouragement.textContent = uiT("mcq.encourageNextTime");
    encouragement.dataset.text = encouragement.textContent;
  } else {
    msg.textContent = uiT("mcq.timesUpShort");
    msg.dataset.text = msg.textContent;
    msg.className = "result-msg wrong";
    icon.textContent = "⏰";
    points.textContent = uiT("leaderboard.pts", { n: 0 });
    points.dataset.text = points.textContent;
    encouragement.textContent = uiT("mcq.encourageTryNext");
    encouragement.dataset.text = encouragement.textContent;
  }

  const totalScore = scoreRow?.score || 0;
  if (score) score.textContent = uiT("mcq.scoreLabel", { n: totalScore });
  if (questionScore) questionScore.textContent = uiT("mcq.scoreLabel", { n: totalScore });
  renderLeaderboard($("#player-leaderboard"), leaderboard, playerId);
}

function resetPlayerMcqAnsweredState() {
  const screen = $("#screen-player-question");
  screen?.classList.remove("is-answered", "is-previewing");
  const title = $("#player-mcq-title");
  const label = $("#player-selected-answer-label");
  if (title) title.textContent = uiT("mcq.title");
  if (label) label.hidden = true;
}

function showPlayerMcqAnsweredState(answerIndex) {
  const screen = $("#screen-player-question");
  const title = $("#player-mcq-title");
  const label = $("#player-selected-answer-label");
  const timerRing = $("#timer-ring");
  const buttons = $("#player-options")?.querySelectorAll(".player-btn") || [];

  screen?.classList.add("is-answered");
  if (title) title.textContent = uiT("mcq.quickQuestions");
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

const COUNTDOWN321_VIDEO_SRC = "/assets/transitions/countdown321.mp4";

function playCountdown321Video(options = {}) {
  const {
    root = document.body,
    layerClass = "lango-countdown321",
    videoClass = "lango-countdown321-video",
    playingClass = "is-playing",
    src = COUNTDOWN321_VIDEO_SRC,
    muted = false,
    volume = 1,
  } = options;

  return new Promise((resolve) => {
    if (!root) {
      resolve();
      return;
    }

    let layer = root.querySelector(`.${layerClass}`);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = layerClass;
      layer.setAttribute("aria-hidden", "true");

      const video = document.createElement("video");
      video.className = videoClass;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.src = src;
      layer.appendChild(video);
      root.appendChild(layer);
    }

    const video = layer.querySelector("video");
    if (!video) {
      resolve();
      return;
    }

    const finish = () => {
      layer.classList.remove(playingClass);
      video.pause();
      resolve();
    };

    video.currentTime = 0;
    video.muted = muted;
    video.volume = volume;
    layer.classList.add(playingClass);
    video.addEventListener("ended", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
    const playPromise = video.play();
    if (playPromise?.catch) playPromise.catch(finish);
  });
}
