import React from "react";
import "./HostMcQuestionResult.css";

const OPTION_LABELS = ["A.", "B.", "C.", "D.", "E.", "F."];
const OPTION_COLORS = ["#15c4f8", "#45c937", "#f33b3d", "#eab308", "#a855f7", "#14b8a6"];

const DEFAULT_OPTIONS = [
  "Photosynthesis",
  "Cellular Respiration",
  "Decomposition",
  "Transpiration",
];

const DEFAULT_STUDENTS = [
  "Emma Thompson",
  "Isabella Martinez",
  "Oliver Wilson",
  "Mia Chen",
  "Aiden Lee",
  "Sophia Patel",
  "Liam Johnson",
  "Liam Johnson",
  "Liam Johnson",
];

function initialsForName(name) {
  return String(name || "Student")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "S";
}

export default function HostMcQuestionResult({
  points = 300,
  question = "What is the process by which plants make their own food?",
  options = DEFAULT_OPTIONS,
  answerCounts = [12, 1, 5, 12],
  correctIndex = 0,
  correctStudents = DEFAULT_STUDENTS,
  onDashboard,
  onNext,
}) {
  const total = answerCounts.reduce((sum, count) => sum + count, 0);
  const safeTotal = total || 1;
  let offset = 0;
  const donutFill = answerCounts
    .map((count, index) => {
      const start = offset;
      const end = offset + (count / safeTotal) * 100;
      offset = end;
      return `${OPTION_COLORS[index] || "#94a3b8"} ${start}% ${end}%`;
    })
    .join(", ");
  const correctAnswer = options[correctIndex] || "";

  return (
    <section className="hostResult" aria-label="Quiz Results">
      <div className="hostResult__backdrop" aria-hidden="true" />
      <div className="hostResult__container">
        <h1 className="hostResult__title">Quiz Results</h1>

        <main className="hostResult__main">
          <div className="hostResult__left">
            <section className="hostResult__questionBox">
              <p className="hostResult__points">{points} pts</p>
              <h2 className="hostResult__question">{question}</h2>
              <div className="hostResult__correct">
                <span aria-hidden="true">✓</span>
                <p>
                  Correct Answer: {OPTION_LABELS[correctIndex]} {correctAnswer}
                </p>
              </div>
              <p className="hostResult__explanation">
                {correctAnswer} is the correct answer for this question.
              </p>
            </section>

            <section className="hostResult__distribution">
              <h2>Answer Distribution</h2>
              <div className="hostResult__distributionBody">
                <div className="hostResult__donut" style={{ "--donut-fill": donutFill || "#d1d5db 0% 100%" }}>
                  <span>Total<br />Responses</span>
                  <strong>{total}</strong>
                </div>
                <div className="hostResult__legend">
                  {options.map((option, index) => {
                    const count = answerCounts[index] || 0;
                    return (
                      <div className="hostResult__legendItem" key={`${option}-${index}`}>
                        <span>
                          <i style={{ "--dot-color": OPTION_COLORS[index] || "#94a3b8" }} />
                          {OPTION_LABELS[index] || `${index + 1}.`} {option}
                        </span>
                        <strong>{count} <em>Response{count === 1 ? "" : "s"}</em></strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>

          <aside className="hostResult__board">
            <header>
              <h2>Correct Responses</h2>
              <p>Students Who Answered Correctly</p>
            </header>
            <div className="hostResult__students">
              {correctStudents.slice(0, 9).map((name, index) => (
                <div className="hostResult__student" style={{ "--student-i": index }} key={`${name}-${index}`}>
                  <div>{initialsForName(name)}</div>
                  <p>{name}</p>
                </div>
              ))}
            </div>
          </aside>
        </main>

        <footer className="hostResult__footer">
          <button type="button" onClick={onDashboard}>← Dashboard</button>
          <button type="button" onClick={onNext}>Next →</button>
        </footer>
      </div>
    </section>
  );
}
