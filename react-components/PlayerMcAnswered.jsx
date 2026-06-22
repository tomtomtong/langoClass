import React from "react";
import "./PlayerMcQuestion.css";
import "./PlayerMcAnswered.css";

const DEFAULT_OPTIONS = [
  "Photosynthesis",
  "Cellular Respiration",
  "Decomposition",
  "Transpiration",
];

const OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];

export default function PlayerMcAnswered({
  countdown = 5,
  selectedIndex = 0,
  question = "What is the process by which plants make their own food?",
  options = DEFAULT_OPTIONS,
}) {
  return (
    <section className="playerMcq playerMcqAnswered" aria-labelledby="player-mcq-answered-title">
      <div className="playerMcq__backdrop" aria-hidden="true" />
      <div className="playerMcq__shell">
        <header className="playerMcq__header">
          <h1 className="playerMcq__title" id="player-mcq-answered-title">Quick Questions</h1>
        </header>

        <main className="playerMcq__main">
          <section className="playerMcq__timerCard" aria-label={`Time remaining: ${countdown} seconds`}>
            <span className="playerMcq__sparkle" aria-hidden="true" />
            <div className="playerMcq__timer" aria-hidden="true">{countdown}</div>
          </section>

          <p className="playerMcqAnswered__label">Selected answer</p>
          <div className="playerMcq__options">
            {options.map((option, index) => (
              <button
                className={`playerMcq__option${index === selectedIndex ? " is-selected" : ""}`}
                data-index={index}
                disabled
                key={`${option}-${index}`}
                type="button"
              >
                {OPTION_LABELS[index] || `${index + 1}.`} {option}
              </button>
            ))}
          </div>

          <p className="playerMcq__question">{question}</p>
        </main>
      </div>
    </section>
  );
}
