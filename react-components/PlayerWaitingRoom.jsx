import React from "react";
import "./PlayerWaitingRoom.css";

export default function PlayerWaitingRoom({
  message = "Please look at the digital whiteboard outside.",
}) {
  return (
    <section
      className="playerWaitingRoom"
      aria-labelledby="player-waiting-room-title"
      data-node-id="124:15636"
    >
      <div className="playerWaitingRoom__content">
        <header className="playerWaitingRoom__header">
          <h1 id="player-waiting-room-title">Waiting Room</h1>
        </header>

        <main className="playerWaitingRoom__main">
          <div className="playerWaitingRoom__messageCard">
            <p aria-live="polite">{message}</p>
          </div>
        </main>
      </div>
    </section>
  );
}
