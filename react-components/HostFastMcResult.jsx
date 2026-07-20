import React from "react";
import "./HostFastMcResult.css";

const DEFAULT_RESULTS = [
  { id: "emma-1", name: "Emma Smith", correctAnswers: 3 },
  { id: "emma-2", name: "Emma Smith", correctAnswers: 3 },
  { id: "emma-3", name: "Emma Smith", correctAnswers: 3 },
  { id: "emma-4", name: "Emma Smith", correctAnswers: 3 },
  { id: "emma-5", name: "Emma Smith", correctAnswers: 3 },
  { id: "emma-6", name: "Emma Smith", correctAnswers: 2 },
  { id: "emma-7", name: "Emma Smith", correctAnswers: 2 },
  { id: "emma-8", name: "Emma Smith", correctAnswers: 1 },
];

function initialsForName(name) {
  return String(name || "Student")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "S";
}

function groupByCorrectAnswers(results) {
  const groups = new Map();
  results.forEach((student) => {
    const count = Math.max(0, Number(student.correctAnswers) || 0);
    if (!groups.has(count)) groups.set(count, []);
    groups.get(count).push(student);
  });
  return [...groups.entries()].sort(([a], [b]) => b - a);
}

export default function HostFastMcResult({
  results = DEFAULT_RESULTS,
  totalQuestions = 3,
  onDashboard,
  onNext,
}) {
  const groups = groupByCorrectAnswers(results);

  return (
    <section className="hostFastResult" aria-labelledby="fast-result-title">
      <img className="hostFastResult__background" src="/assets/course/courseBG.png" alt="" />
      <div className="hostFastResult__stage">
        <h1 className="hostFastResult__title" id="fast-result-title">Accuracy Leaderboard</h1>

        <main className="hostFastResult__board">
          <div className="hostFastResult__groups">
            {groups.map(([correctAnswers, students], groupIndex) => (
              <section
                className="hostFastResult__group"
                data-expanded={students.length > 3 || undefined}
                key={correctAnswers}
              >
                <h2
                  className="hostFastResult__score"
                  aria-label={`${Math.round((correctAnswers / Math.max(1, totalQuestions)) * 100)}% accuracy, ${correctAnswers} correct`}
                >
                  <strong>{Math.round((correctAnswers / Math.max(1, totalQuestions)) * 100)}%</strong>
                  <span>accuracy</span>
                </h2>
                <div className="hostFastResult__students">
                  {students.map((student, index) => (
                    <article className="hostFastResult__student" key={student.id || `${student.name}-${index}`}>
                      <span
                        className="hostFastResult__avatar"
                        style={{ "--avatar-index": groupIndex * 6 + index }}
                        aria-hidden="true"
                      >
                        {initialsForName(student.name)}
                      </span>
                      <span className="hostFastResult__name">{student.name || "Student"}</span>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </main>
      </div>

      <footer className="hostFastResult__footer">
        <button type="button" className="hostFastResult__button hostFastResult__button--back" onClick={onDashboard}>
          <img src="/assets/class/arrow-left.svg" alt="" />
          <span>Dashboard</span>
        </button>
        <button type="button" className="hostFastResult__button" onClick={onNext}>
          <span>Next</span>
          <img className="hostFastResult__nextIcon" src="/assets/class/arrow-left.svg" alt="" />
        </button>
      </footer>
    </section>
  );
}
