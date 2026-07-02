import React from "react";
import "./PlayerFastMcResult.css";

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

const DEFAULT_ANSWERS = [
  { correctIndex: 1, correctAnswer: "Cellular Respiration", answerIndex: 1, correct: true },
  { correctIndex: 1, correctAnswer: "Mitochondria", answerIndex: 0, correct: false },
  { correctIndex: 1, correctAnswer: "Cellular Respiration", answerIndex: 1, correct: true },
  { correctIndex: 1, correctAnswer: "Mitochondria", answerIndex: 0, correct: false },
  { correctIndex: 1, correctAnswer: "Cellular Respiration", answerIndex: 1, correct: true },
  { correctIndex: 1, correctAnswer: "Mitochondria", answerIndex: 0, correct: false },
  { correctIndex: 1, correctAnswer: "Cellular Respiration", answerIndex: 1, correct: true },
  { correctIndex: 1, correctAnswer: "Mitochondria", answerIndex: 0, correct: false },
  { correctIndex: 1, correctAnswer: "Cellular Respiration", answerIndex: 1, correct: true },
  { correctIndex: 1, correctAnswer: "Mitochondria", answerIndex: 0, correct: false },
];

function optionLabel(index) {
  return index == null ? "-" : OPTION_LABELS[Number(index)] || "-";
}

export default function PlayerFastMcResult({
  answers = DEFAULT_ANSWERS,
  currentPoints = 9850,
}) {
  const correctCount = answers.filter((answer) => answer.correct).length;

  return (
    <section className="playerFastResult" aria-labelledby="player-fast-result-title">
      <div className="playerFastResult__shell">
        <h1 className="playerFastResult__title" id="player-fast-result-title">Result</h1>

        <main className="playerFastResult__panel">
          <header className="playerFastResult__summary">
            <p className="playerFastResult__summaryLabel">Corrected Answer</p>
            <p className="playerFastResult__summaryScore">{correctCount} / {answers.length}</p>
          </header>

          <ol className="playerFastResult__answers" aria-label="Correct answers">
            {answers.map((answer, index) => (
              <li className="playerFastResult__answer" key={`${answer.correctAnswer}-${index}`}>
                <span className="playerFastResult__answerMain">
                  <span className="playerFastResult__answerNumber">{index + 1}.</span>
                  <span className="playerFastResult__answerLetter">{optionLabel(answer.correctIndex)}.</span>
                  <span className="playerFastResult__answerText">{answer.correctAnswer || "Correct answer"}</span>
                </span>
                <span className="playerFastResult__answerStatus" aria-label={`Your answer ${optionLabel(answer.answerIndex)}`}>
                  <span className="playerFastResult__answerChoice">{optionLabel(answer.answerIndex)}</span>
                  <span aria-hidden="true">{answer.correct ? "✅" : "💪"}</span>
                </span>
              </li>
            ))}
          </ol>

          <footer className="playerFastResult__footer">
            <p className="playerFastResult__pointsLabel">Your Current Points</p>
            <p className="playerFastResult__points">{Number(currentPoints || 0).toLocaleString()} pts</p>
          </footer>
        </main>
      </div>
    </section>
  );
}
