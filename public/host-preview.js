(function initHostLeaderboardPreview() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") !== "leaderboard") return;

  const currentSession = [
    { id: "sophia", name: "Sophia Patel", score: 10850 },
    { id: "liam", name: "Liam Chen", score: 10240 },
    { id: "ava", name: "Ava Williams", score: 9780 },
    { id: "emma", name: "Emma Smith", score: 9450 },
    { id: "noah", name: "Noah Brown", score: 8875 },
    { id: "olivia", name: "Olivia Davis", score: 8200 },
    { id: "james", name: "James Miller", score: 7750 },
    { id: "isabella", name: "Isabella Garcia", score: 7100 },
  ];

  const overall = currentSession.map((row, index) => ({
    ...row,
    score: row.score + (8 - index) * 10000,
  }));

  showExerciseLeaderboards({
    exerciseLeaderboard: currentSession,
    semesterLeaderboard: overall,
    exerciseListEl: document.querySelector("#host-quiz-final-leaderboard"),
    semesterListEl: document.querySelector("#host-semester-leaderboard"),
    semesterWrapEl: document.querySelector("#host-semester-leaderboard-wrap"),
    exerciseWrapEl: document.querySelector("#host-exercise-leaderboard-wrap"),
  });

  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  document.querySelector("#screen-host-quiz-finished")?.classList.add("active");
  document.querySelector("#btn-host-quiz-next-exercise")?.setAttribute("hidden", "");
})();
