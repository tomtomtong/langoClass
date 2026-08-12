import React, { useMemo, useState } from "react";
import "../public/host-leaderboard.css";

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

function Pulse({ rows }) {
  const scored = rows.filter((row) => Number(row.score) > 0).length || rows.length;
  const totalPts = rows.reduce((sum, row) => sum + Math.max(0, Number(row.score) || 0), 0);
  if (!rows.length) return null;
  return (
    <div className="host-leaderboard__pulse" data-reveal="pulse">
      <div className="host-leaderboard__pulse-chip">
        <strong>{scored}</strong>
        <span>players scored</span>
      </div>
      <div className="host-leaderboard__pulse-chip">
        <strong>{totalPts.toLocaleString()}</strong>
        <span>class pts</span>
      </div>
    </div>
  );
}

export default function HostLeaderboard({ currentSession = [], overall = [], onDashboard, onNextExercise }) {
  const currentRows = useMemo(() => sortRows(normalize(currentSession)), [currentSession]);
  const overallRows = useMemo(() => sortRows(normalize(overall)), [overall]);
  const [view, setView] = useState("current");
  const rows = view === "overall" ? overallRows : currentRows;

  return (
    <section className="host-leaderboard" aria-labelledby="host-leaderboard-title">
      <img className="host-leaderboard__bg" src="/assets/course/courseBG.png" alt="" />
      <div className="host-leaderboard__overlay" aria-hidden="true" />
      <div className="host-leaderboard__container">
        <header className="host-leaderboard__header">
          <h1 className="host-leaderboard__title" id="host-leaderboard-title">
            {view === "overall" ? "Class total" : "Round complete!"}
          </h1>
          <Pulse rows={rows} />
        </header>

        <div className="host-leaderboard__stage">
          <aside className="host-leaderboard__tommy" data-reveal="tommy" aria-hidden="true">
            <img className="host-leaderboard__tommy-img" src="/assets/buzzin/uncle-tommy-buzzin.png" alt="" />
            <p className="host-leaderboard__tommy-caption">Great work, class!</p>
          </aside>

          <main className="host-leaderboard__main">
            {!rows.length ? (
              <p className="host-leaderboard__empty">No scores yet</p>
            ) : (
              <div className="host-leaderboard__arena">
                <div className="host-leaderboard__spotlight">
                  <ol className="host-leaderboard__podium" aria-label="Top of class">
                    {rows.slice(0, 3).map((row, index) => (
                      <li
                        className={`host-leaderboard__podium-row host-leaderboard__podium-row--${index + 1}`}
                        key={row.id ?? row.name}
                      >
                        <div className="host-leaderboard__podium-person">
                          {index === 0 ? <span className="host-leaderboard__crown" aria-hidden="true" /> : null}
                          <span className="host-leaderboard__avatar">
                            {row.name.trim()[0]?.toUpperCase() || "?"}
                          </span>
                          <span className="host-leaderboard__name">{row.name}</span>
                          <span className="host-leaderboard__score-pill">
                            <span className="host-leaderboard__score">
                              {Number(row.score).toLocaleString()} pts
                            </span>
                          </span>
                        </div>
                        <div className="host-leaderboard__plinth" aria-hidden="true">
                          <span className="host-leaderboard__plinth-num">{index + 1}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                <section className="host-leaderboard__sheet">
                  <div className="host-leaderboard__sheet-handle" aria-hidden="true" />
                  <ol className="host-leaderboard__rankings" start={4}>
                    {rows.slice(3).map((row, index) => (
                      <li className="host-leaderboard__ranking-row" key={row.id ?? row.name}>
                        <span className="host-leaderboard__ranking-rank">{index + 4}</span>
                        <span className="host-leaderboard__ranking-avatar" aria-hidden="true">
                          {row.name.trim()[0]?.toUpperCase() || "?"}
                        </span>
                        <span className="host-leaderboard__ranking-name">{row.name}</span>
                        <strong className="host-leaderboard__score">
                          {Number(row.score).toLocaleString()} pts
                        </strong>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            )}
          </main>
        </div>

        <footer className="host-leaderboard__footer">
          <button className="host-leaderboard__button" type="button" onClick={onDashboard}>
            Dashboard
          </button>
          <div className="host-leaderboard__tabs" role="tablist" aria-label="Leaderboard period">
            <button
              className={`host-leaderboard__button${view === "current" ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={view === "current"}
              onClick={() => setView("current")}
            >
              This round
            </button>
            {!!overallRows.length && (
              <button
                className={`host-leaderboard__button${view === "overall" ? " is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={view === "overall"}
                onClick={() => setView("overall")}
              >
                Class total
              </button>
            )}
          </div>
          {onNextExercise && (
            <button className="host-leaderboard__next" type="button" onClick={onNextExercise}>
              Next exercise
            </button>
          )}
        </footer>
      </div>
    </section>
  );
}
