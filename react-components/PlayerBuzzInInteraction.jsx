import React from "react";
import "./PlayerBuzzInInteraction.css";

export default function PlayerBuzzInInteraction({
  topic = "Press the record button to start recording",
  title = "Buzz in Question",
  cardTitle = "Record your voice",
  status = "",
  phase = "turn",
  timer = 20,
  result = "",
  recordStatus = "",
  submitted = "",
  isBuzzEnabled = false,
  isRecording = false,
  onBuzz,
  onRecord,
}) {
  const showTimer = phase === "join";
  const showTurn = phase === "turn";

  return (
    <section className="playerBuzzIn" aria-labelledby="player-buzzin-title">
      <div className="playerBuzzIn__stage">
        <header className="playerBuzzIn__header">
          <h1 className="playerBuzzIn__title" id="player-buzzin-title">{title}</h1>
        </header>

        <main className="playerBuzzIn__main">
          <section className="playerBuzzIn__card" aria-label="Buzz in interaction">
            <div className="playerBuzzIn__copy">
              <h2>{cardTitle}</h2>
              {topic ? <p className="playerBuzzIn__topic">{topic}</p> : null}
              {status ? <p className="playerBuzzIn__status">{status}</p> : null}
            </div>

            {showTimer ? (
              <div className="playerBuzzIn__timer" aria-label={`${timer} seconds remaining`}>
                <span>Buzz in</span>
                <strong>{timer}</strong>
              </div>
            ) : null}

            {phase === "join" ? (
              <button className="playerBuzzIn__button" type="button" disabled={!isBuzzEnabled} onClick={onBuzz}>
                Buzz In!
              </button>
            ) : null}

            {result ? <p className="playerBuzzIn__result">{result}</p> : null}

            {showTurn ? (
              <div className="playerBuzzIn__turn">
                <button
                  className={`playerBuzzIn__button${isRecording ? " is-recording" : ""}`}
                  type="button"
                  onClick={onRecord}
                >
                  {isRecording ? "Stop recording" : "Record"}
                </button>
                {recordStatus ? <p className="playerBuzzIn__recordStatus">{recordStatus}</p> : null}
                {submitted ? <p className="playerBuzzIn__submitted">{submitted}</p> : null}
              </div>
            ) : null}
          </section>
        </main>
      </div>
    </section>
  );
}
