import React, { useMemo, useState } from "react";
import "../public/player-leaderboard.css";

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

function rankLabel(rank) {
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  if (rank % 10 === 1) return `${rank}st`;
  if (rank % 10 === 2) return `${rank}nd`;
  if (rank % 10 === 3) return `${rank}rd`;
  return `${rank}th`;
}

function samePlayerId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function encouragementFor(rank, rows, ownScore) {
  if (!rank) return "Play the next round to get on the board.";
  if (rank === 1) return "You took 1st place!";
  if (rank === 2 || rank === 3) return "Podium finish - amazing work!";
  const topCut = Math.max(3, Math.ceil(rows.length * 0.3));
  if (rank <= topCut) return "You're in the top of the class!";
  const ahead = rows[rank - 2];
  if (ahead) {
    const gap = Math.max(0, Number(ahead.score) - Number(ownScore || 0));
    if (gap > 0) return `${gap.toLocaleString()} pts to climb one place.`;
  }
  return "Still climbing — keep going!";
}

export default function PlayerLeaderboard({
  currentSession = [],
  overall = [],
  currentPlayerId,
  accuracy,
  onBack,
  onPlayAgain,
}) {
  const currentRows = useMemo(() => sortRows(normalize(currentSession)), [currentSession]);
  const overallRows = useMemo(() => sortRows(normalize(overall)), [overall]);
  const [view, setView] = useState("current");
  const rows = view === "overall" ? overallRows : currentRows;
  const ownIndex = rows.findIndex((row) => samePlayerId(row.id, currentPlayerId));
  const ownRank = ownIndex >= 0 ? ownIndex + 1 : null;
  const ownScore = ownIndex >= 0 ? rows[ownIndex].score : 0;

  const boardRows = (() => {
    if (!rows.length) return [];
    if (!ownRank || ownRank <= 3) {
      return rows.slice(0, 3).map((row, index) => ({ row, rank: index + 1 }));
    }
    const start = Math.max(0, ownRank - 2);
    const end = Math.min(rows.length, ownRank + 1);
    return rows.slice(start, end).map((row, i) => ({ row, rank: start + i + 1 }));
  })();

  const accuracyText =
    view === "current" && accuracy?.total
      ? `${accuracy.correct} of ${accuracy.total} correct`
      : view === "current" && accuracy?.correct != null
        ? `${accuracy.correct} correct`
        : null;

  return (
    <section className="player-leaderboard" aria-labelledby="leaderboard-title">
      <div className="player-leaderboard__backdrop" aria-hidden="true" />
      <div className="player-leaderboard__shell">
        <h1 className="player-leaderboard__title" id="leaderboard-title">Your results</h1>
        <main className="player-leaderboard__panel">
          <div className="player-leaderboard__tabs" role="tablist" aria-label="Leaderboard period">
            {[{ id: "current", label: "This round" }, { id: "overall", label: "Class total" }].map((tab) => (
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

          <div className={`player-leaderboard__me${ownRank && ownRank <= 3 ? " is-podium" : ""}${ownRank === 1 ? " is-first" : ""}`}>
            <span className="player-leaderboard__me-sparkle" aria-hidden="true" />
            <p className="player-leaderboard__me-label">Your place</p>
            <p className="player-leaderboard__rank-summary">{ownRank ? rankLabel(ownRank) : "—"}</p>
            <p className="player-leaderboard__points">{Number(ownScore).toLocaleString()} pts</p>
            {accuracyText && <p className="player-leaderboard__accuracy">{accuracyText}</p>}
            <p className="player-leaderboard__encouragement">{encouragementFor(ownRank, rows, ownScore)}</p>
          </div>

          <p className="player-leaderboard__board-label">{ownRank && ownRank > 3 ? "Near you" : "Top of class"}</p>
          <div className="player-leaderboard__board">
            <ol className="player-leaderboard__list">
              {boardRows.map(({ row, rank }) => (
                <li
                  className={`player-leaderboard__row player-leaderboard__row--sheet player-leaderboard__row--compact ${rank <= 3 ? `player-leaderboard__row--${rank}` : "player-leaderboard__row--rest"}${samePlayerId(row.id, currentPlayerId) ? " is-me" : ""}`}
                  key={row.id ?? `${row.name}-${rank}`}
                >
                  <span className="player-leaderboard__rank-badge">{rank}</span>
                  <span className="player-leaderboard__avatar" aria-hidden="true">
                    {row.name.trim()[0]?.toUpperCase() || "?"}
                  </span>
                  <span className="player-leaderboard__meta">
                    <span className="player-leaderboard__name">{row.name}</span>
                  </span>
                  <span className="player-leaderboard__score">{Number(row.score).toLocaleString()} pts</span>
                </li>
              ))}
              {!rows.length && <li className="player-leaderboard__empty">No scores yet</li>}
            </ol>
          </div>

          <footer className="player-leaderboard__footer">
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
