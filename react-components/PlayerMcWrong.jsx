import React from "react";
import "./PlayerMcSuccess.css";
import "./PlayerMcWrong.css";

export default function PlayerMcWrong() {
  return (
    <section className="playerMcSuccess playerMcWrong" aria-labelledby="player-mc-wrong-title">
      <div className="playerMcSuccess__backdrop" aria-hidden="true" />
      <div className="playerMcSuccess__shell">
        <header className="playerMcSuccess__header">
          <h1 className="playerMcSuccess__title" id="player-mc-wrong-title">
            Quick Questions
          </h1>
        </header>

        <main className="playerMcSuccess__main">
          <section className="playerMcSuccess__card" aria-live="polite">
            <p className="playerMcSuccess__message">You were so close !</p>
            <div className="playerMcSuccess__icon" aria-hidden="true">💪</div>
            <p className="playerMcSuccess__encouragement">Keep it up for next time.</p>
          </section>
        </main>
      </div>
    </section>
  );
}
