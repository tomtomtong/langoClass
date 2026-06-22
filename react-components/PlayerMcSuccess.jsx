import React from "react";
import "./PlayerMcSuccess.css";

export default function PlayerMcSuccess({
  points = 500,
}) {
  return (
    <section className="playerMcSuccess" aria-labelledby="player-mc-success-title">
      <div className="playerMcSuccess__backdrop" aria-hidden="true" />
      <div className="playerMcSuccess__shell">
        <header className="playerMcSuccess__header">
          <h1 className="playerMcSuccess__title" id="player-mc-success-title">
            Quick Questions
          </h1>
        </header>

        <main className="playerMcSuccess__main">
          <section className="playerMcSuccess__card" aria-live="polite">
            <p className="playerMcSuccess__message">You answered it correctly</p>
            <div className="playerMcSuccess__icon" aria-hidden="true">✅</div>
            <p className="playerMcSuccess__points">{points} pts</p>
            <p className="playerMcSuccess__encouragement">Keep going</p>
          </section>
        </main>
      </div>
    </section>
  );
}
