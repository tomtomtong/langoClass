import React from "react";
import "./HostMcQuestion.css";

const DEFAULT_OPTIONS = [
  "Photosynthesis",
  "Cellular Respiration",
  "Decomposition",
  "Transpiration",
];

const OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];

export default function HostMcQuestion({
  questionNumber = 1,
  points = 300,
  countdown = 5,
  question = "What is the process by which plants make their own food?",
  imageUrl,
  options = DEFAULT_OPTIONS,
  status = "Students are answering...",
  onDashboard,
  onNext,
}) {
  return (
    <section className="hostMcq" aria-label={`Question ${questionNumber}`}>
      <div className="hostMcq__backdrop" aria-hidden="true" />

      <div className="hostMcq__container">
        <header className="hostMcq__header">
          <h1 className="hostMcq__title">Question {questionNumber}</h1>
        </header>

        <main className="hostMcq__main">
          <section className="hostMcq__questionBox">
            <p className="hostMcq__points">{points} pts</p>
            <span className="hostMcq__sparkle" aria-hidden="true" />
            <h2 className="hostMcq__question">{question}</h2>
            {imageUrl ? (
              <img className="hostMcq__image" src={imageUrl} alt="" />
            ) : null}
          </section>

          <div className="hostMcq__options">
            {options.map((option, index) => (
              <button
                className="hostMcq__option"
                data-index={index}
                key={`${option}-${index}`}
                type="button"
                disabled
              >
                {OPTION_LABELS[index] || `${index + 1}.`} {option}
              </button>
            ))}
          </div>
        </main>

        <aside className="hostMcq__countdown" aria-label="Question countdown">
          {countdown}
        </aside>

        <footer className="hostMcq__footer">
          <button className="hostMcq__footerButton" type="button" onClick={onDashboard}>
            <span aria-hidden="true">←</span>
            <span>Dashboard</span>
          </button>
          <p className="hostMcq__status">{status}</p>
          <button className="hostMcq__footerButton" type="button" onClick={onNext}>
            <span>Next</span>
            <span aria-hidden="true">→</span>
          </button>
        </footer>
      </div>
    </section>
  );
}
