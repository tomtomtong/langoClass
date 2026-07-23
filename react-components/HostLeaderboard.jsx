import React, { useMemo, useState } from "react";
import "../public/host-leaderboard.css";

const medals = ["🥇", "🥈", "🥉"];

function normalize(entries = []) {
  return entries.map((entry) => ({
    id: entry.id ?? entry.studentUserId,
    name: String(entry.name ?? entry.displayName ?? "Player"),
    score: entry.score ?? entry.totalScore ?? 0,
  }));
}

function sortRows(rows) {
  return [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function ordinal(rank) {
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  return `${rank}${rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th"}`;
}

export default function HostLeaderboard({ currentSession = [], overall = [], sessionNumber = 1, onDashboard, onNextExercise }) {
  const currentRows = useMemo(() => sortRows(normalize(currentSession)), [currentSession]);
  const overallRows = useMemo(() => sortRows(normalize(overall)), [overall]);
  const [view, setView] = useState("current");
  const rows = view === "overall" ? overallRows : currentRows;

  return (
    <section className="host-leaderboard" aria-labelledby="host-leaderboard-title">
      <div className="host-leaderboard__overlay" aria-hidden="true" />
      <div className="host-leaderboard__container">
        <header className="host-leaderboard__header">
          <h1 id="host-leaderboard-title">{view === "overall" ? "Overall Results" : `Leaderboard - Session ${sessionNumber}`}</h1>
          {onNextExercise && <button className="host-leaderboard__next" type="button" onClick={onNextExercise}>Next exercise</button>}
        </header>
        <main className="host-leaderboard__main">
          {!rows.length ? <p className="host-leaderboard__empty">No scores yet</p> : (
            <div className="host-leaderboard__columns">
              <ol className="host-leaderboard__podium">
                {rows.slice(0, 3).map((row, index) => <li className={`host-leaderboard__podium-row host-leaderboard__podium-row--${index + 1}`} key={row.id ?? row.name}>
                  <div className="host-leaderboard__profile" aria-hidden="true"><span className="host-leaderboard__medal">{medals[index]}</span><span className="host-leaderboard__avatar">{row.name[0]?.toUpperCase()}</span></div>
                  <span className="host-leaderboard__rank">{ordinal(index + 1)}</span>
                  <span className="host-leaderboard__player"><span className="host-leaderboard__name">{row.name}</span><span className="host-leaderboard__score">{Number(row.score).toLocaleString()} pts</span></span>
                </li>)}
              </ol>
              <ol className="host-leaderboard__rankings" start={4}>
                {rows.slice(3).map((row, index) => <li className="host-leaderboard__ranking-row" key={row.id ?? row.name}>
                  <span className="host-leaderboard__ranking-rank">{index + 4}.</span><span className="host-leaderboard__ranking-avatar" aria-hidden="true">{row.name[0]?.toUpperCase()}</span><span className="host-leaderboard__ranking-name">{row.name}</span><span className="host-leaderboard__ranking-result"><strong>{Number(row.score).toLocaleString()} pts</strong><small>{view === "overall" ? "Overall Score" : "Section Scores"}</small></span>
                </li>)}
              </ol>
            </div>
          )}
        </main>
        <footer className="host-leaderboard__footer">
          <button className="host-leaderboard__button" type="button" onClick={onDashboard}>Dashboard</button>
          <div className="host-leaderboard__tabs" role="tablist" aria-label="Leaderboard period">
            <button className={`host-leaderboard__button${view === "current" ? " is-active" : ""}`} type="button" role="tab" aria-selected={view === "current"} onClick={() => setView("current")}>Current Session</button>
            {!!overallRows.length && <button className={`host-leaderboard__button${view === "overall" ? " is-active" : ""}`} type="button" role="tab" aria-selected={view === "overall"} onClick={() => setView("overall")}>Overall</button>}
          </div>
        </footer>
      </div>
    </section>
  );
}
