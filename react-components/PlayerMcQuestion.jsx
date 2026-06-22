import React from "react";
import "./PlayerMcQuestion.css";

const DEFAULT_OPTIONS = [
  "Photosynthesis",
  "Cellular Respiration",
  "Decomposition",
  "Transpiration",
];

const OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];

export default function PlayerMcQuestion({
  countdown = 5,
  question = "What is the process by which plants make their own food?",
  options = DEFAULT_OPTIONS,
  feedback = "",
  disabled = false,
  onAnswer,
}) {
  return (
    <section className="playerMcq" aria-labelledby="player-mcq-title">
      <div className="playerMcq__backdrop" aria-hidden="true" />
      <div className="playerMcq__shell">
        <header className="playerMcq__header">
          <h1 className="playerMcq__title" id="player-mcq-title">MCQ Question</h1>
        </header>

        <main className="playerMcq__main">
          <section className="playerMcq__timerCard" aria-label={`${countdown} seconds remaining`}>
            <p className="playerMcq__timerLabel">Timer</p>
            <span className="playerMcq__sparkle" aria-hidden="true" />
            <div className="playerMcq__timer" aria-hidden="true">{countdown}</div>
          </section>

          <div className="playerMcq__options">
            {options.map((option, index) => (
              <button
                className="playerMcq__option"
                data-index={index}
                disabled={disabled}
                key={`${option}-${index}`}
                type="button"
                onClick={() => onAnswer?.(index)}
              >
                {OPTION_LABELS[index] || `${index + 1}.`} {option}
              </button>
            ))}
          </div>

          <p className="playerMcq__feedback" aria-live="polite">{feedback}</p>
          <p className="playerMcq__question">{question}</p>
        </main>
      </div>
    </section>
  );
}
