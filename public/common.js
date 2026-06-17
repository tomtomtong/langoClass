const OPTION_LABELS = ["▲", "◆", "●", "■", "★", "⬡"];

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

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.querySelector(`#screen-${id}`).classList.add("active");
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

function renderOptions(container, options, { clickable, onClick, showBars, counts, correctIndex }) {
  container.innerHTML = options
    .map((opt, i) => {
      const pct = counts && counts[i] ? counts[i] : 0;
      const bar = showBars ? `<span class="bar" style="width:${pct}%"></span>` : "";
      const countLabel = showBars ? `<span>${pct}%</span>` : "";
      const classes = ["option"];
      if (clickable) classes.push("player-btn");
      if (correctIndex === i) classes.push("correct");
      return `<button type="button" class="${classes.join(" ")}" data-index="${i}"${clickable ? "" : " disabled"}>
          ${bar}
          <span class="label"><span>${OPTION_LABELS[i] || String.fromCharCode(65 + i)} ${escapeHtml(opt)}</span>${countLabel}</span>
        </button>`;
    })
    .join("");

  if (clickable && onClick) {
    container.querySelectorAll(".player-btn").forEach((btn) => {
      btn.addEventListener("click", () => onClick(Number(btn.dataset.index), btn));
    });
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
