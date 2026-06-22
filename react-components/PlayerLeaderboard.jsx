import React, { useMemo, useState } from "react";
import "../public/player-leaderboard.css";

const rankLabels = ["1st", "2nd", "3rd"];
const medals = ["🥇", "🥈", "🥉"];

function normalize(entries = []) {
  return entries.map((entry) => ({
    id: entry.id ?? entry.studentUserId,
    name: String(entry.name ?? entry.displayName ?? "Player"),
    score: entry.score ?? entry.totalScore ?? 0,
  }));
}

export default function PlayerLeaderboard({
  currentSession = [],
  overall = [],
  currentPlayerId,
  onBack,
  onPlayAgain,
}) {
  const currentRows = useMemo(() => normalize(currentSession), [currentSession]);
  const overallRows = useMemo(() => normalize(overall), [overall]);
  const [view, setView] = useState("current");
  const rows = view === "overall" ? overallRows : currentRows;
  const ownScore = rows.find((row) => row.id === currentPlayerId)?.score ?? 0;

  return (
    <section className="player-leaderboard" aria-labelledby="leaderboard-title">
      <div className="player-leaderboard__backdrop" aria-hidden="true" />
      <div className="player-leaderboard__shell">
        <h1 className="player-leaderboard__title" id="leaderboard-title">Leaderboard</h1>
        <main className="player-leaderboard__panel">
          <div className="player-leaderboard__tabs" role="tablist" aria-label="Leaderboard period">
            {[{ id: "current", label: "Current Session" }, { id: "overall", label: "Overall" }].map((tab) => (
              <button
                className={`player-leaderboard__tab${view === tab.id ? " is-active" : ""}`}
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                hidden={tab.id === "overall" && !overallRows.length}
                onClick={() => setView(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <ol className="player-leaderboard__list">
            {rows.slice(0, 3).map((row, index) => (
              <li className={`player-leaderboard__row player-leaderboard__row--${index + 1}${row.id === currentPlayerId ? " is-me" : ""}`} key={row.id ?? `${row.name}-${index}`}>
                <div className="player-leaderboard__profile" aria-hidden="true">
                  <span className="player-leaderboard__medal">{medals[index]}</span>
                  <span className="player-leaderboard__avatar">{row.name.trim()[0]?.toUpperCase() || "?"}</span>
                </div>
                <span className="player-leaderboard__rank">{rankLabels[index]}</span>
                <span className="player-leaderboard__player">
                  <span className="player-leaderboard__name">{row.name}</span>
                  <span className="player-leaderboard__score">{Number(row.score).toLocaleString()} pts</span>
                </span>
              </li>
            ))}
            {!rows.length && <li className="player-leaderboard__empty">No scores yet</li>}
          </ol>

          <footer className="player-leaderboard__footer">
            <p className="player-leaderboard__points-label">Your Current Points</p>
            <p className="player-leaderboard__points">{Number(ownScore).toLocaleString()} pts</p>
            <p className="player-leaderboard__encouragement">Keep going!<br />You're making great progress.</p>
            {(onBack || onPlayAgain) && (
              <div className="player-leaderboard__actions">
                {onBack && <button className="player-leaderboard__action" type="button" onClick={onBack}>Back to waiting room</button>}
                {onPlayAgain && <button className="player-leaderboard__action" type="button" onClick={onPlayAgain}>Play Again</button>}
              </div>
            )}
          </footer>
        </main>
      </div>
    </section>
  );
}
