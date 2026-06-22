import React from "react";
import "./PlayerPassiveWaiting.css";

export default function PlayerPassiveWaiting({
  title = "Watch the lesson",
  message = "No action is needed. Please watch the teacher's screen.",
}) {
  return (
    <section
      className="playerPassiveWaiting"
      aria-labelledby="player-passive-waiting-title"
      data-node-id="124:15636"
    >
      <div className="playerPassiveWaiting__content">
        <header className="playerPassiveWaiting__header">
          <h1 id="player-passive-waiting-title">{title}</h1>
        </header>

        <main className="playerPassiveWaiting__main">
          <div className="playerPassiveWaiting__messageCard">
            <p aria-live="polite">{message}</p>
          </div>
        </main>
      </div>
    </section>
  );
}
