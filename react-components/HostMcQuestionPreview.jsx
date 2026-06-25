import React from "react";
import "./HostMcQuestionPreview.css";

export default function HostMcQuestionPreview({
  questionNumber = 1,
  points = 300,
  question = "What is the process by which plants make their own food?",
  imageUrl,
  previewSeconds = 5,
  remainingSeconds = 5,
  onDashboard,
}) {
  const total = Math.max(1, Number(previewSeconds) || 5);
  const remaining = Math.max(0, Math.min(total, Number(remainingSeconds) || 0));
  const progress = `${(remaining / total) * 100}%`;

  return (
    <section className="hostMcqPreview" aria-label={`Question ${questionNumber} preview`}>
      <img className="hostMcqPreview__bg" src="/assets/course/courseBG.png" alt="" />

      <div className="hostMcqPreview__stage">
        <header className="hostMcqPreview__header">
          <h1 className="hostMcqPreview__title">Question {questionNumber}</h1>
        </header>

        <main className="hostMcqPreview__main">
          <section className="hostMcqPreview__questionBox">
            <p className="hostMcqPreview__points">{points} pts</p>
            <h2 className="hostMcqPreview__question">{question}</h2>
            {imageUrl ? <img className="hostMcqPreview__image" src={imageUrl} alt="" /> : null}
          </section>

          <div className="hostMcqPreview__progress" aria-hidden="true">
            <div style={{ width: progress }} />
          </div>
        </main>
      </div>

      <footer className="hostMcqPreview__footer">
        <button className="hostMcqPreview__footerButton" type="button" onClick={onDashboard}>
          <img src="/assets/class/arrow-left.svg" alt="" />
          <span>Dashboard</span>
        </button>
        <button className="hostMcqPreview__footerButton" type="button" disabled>
          <span>Next</span>
          <img className="hostMcqPreview__footerIconNext" src="/assets/class/arrow-left.svg" alt="" />
        </button>
      </footer>
    </section>
  );
}
