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
  const showBuzzButton = phase === "join" || phase === "ready";
  const showTurn = phase === "turn";
  const waveformBars = Array.from({ length: 30 });

  return (
    <section className={`playerBuzzIn${isRecording ? " is-recording" : ""}`} aria-labelledby="player-buzzin-title">
      <div className="playerBuzzIn__stage">
        <header className="playerBuzzIn__header">
          <h1 className="playerBuzzIn__title" id="player-buzzin-title">{title}</h1>
        </header>

        <main className="playerBuzzIn__main">
          <section className="playerBuzzIn__card" aria-label="Buzz in interaction">
            <div className="playerBuzzIn__copy">
              <h2>{isRecording ? "Recording your voice" : cardTitle}</h2>
              {topic ? <p className="playerBuzzIn__topic">{topic}</p> : null}
              {status ? <p className="playerBuzzIn__status">{status}</p> : null}
            </div>

            {showTimer ? (
              <div className="playerBuzzIn__timer" aria-label={`${timer} seconds remaining`}>
                <span>Buzz in</span>
                <strong>{timer}</strong>
              </div>
            ) : null}

            {showBuzzButton ? (
              <button className="playerBuzzIn__button" type="button" disabled={!isBuzzEnabled} onClick={onBuzz}>
                Buzz In!
              </button>
            ) : null}

            {result ? <p className="playerBuzzIn__result">{result}</p> : null}

            {showTurn ? (
              <div className="playerBuzzIn__turn">
                {isRecording ? (
                  <div className="playerBuzzIn__recordingPanel" aria-live="polite">
                    <div className="playerBuzzIn__waveform" aria-hidden="true">
                      {waveformBars.map((_, index) => (
                        <span key={index} />
                      ))}
                    </div>
                    <span className="playerBuzzIn__recordingTime">
                      00 : {String(Math.max(0, timer)).padStart(2, "0")} s
                    </span>
                  </div>
                ) : null}
                <button
                  className={`playerBuzzIn__button${isRecording ? " is-recording" : ""}`}
                  type="button"
                  onClick={onRecord}
                >
                  {isRecording ? "Stop" : "Record"}
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
