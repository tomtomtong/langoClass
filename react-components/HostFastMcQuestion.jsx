import React from "react";
import "./HostFastMcQuestion.css";

function HostFastButton({ children, direction = "next", onClick }) {
  const isBack = direction === "back";

  return (
    <button className="hostFastMcq__footerButton" type="button" onClick={onClick}>
      {isBack ? <img src="/assets/class/arrow-left.svg" alt="" /> : null}
      <span>{children}</span>
      {!isBack ? <img className="hostFastMcq__footerIconNext" src="/assets/class/arrow-left.svg" alt="" /> : null}
    </button>
  );
}

export default function HostFastMcQuestion({
  questionNumber = 1,
  points = 500,
  countdown = 5,
  question = "What is this?",
  imageUrl,
  onDashboard,
  onNext,
}) {
  return (
    <section className="hostFastMcq" aria-label={`Question ${questionNumber}`}>
      <img className="hostFastMcq__bg" src="/assets/course/courseBG.png" alt="" />
      <div className="hostFastMcq__stage">
        <header className="hostFastMcq__header">
          <h1 className="hostFastMcq__title">Question {questionNumber}</h1>
        </header>

        <main className="hostFastMcq__main">
          <section className="hostFastMcq__questionBox">
            <p className="hostFastMcq__points">{points} pts</p>
            <h2 className="hostFastMcq__question">{question}</h2>
            {imageUrl ? <img className="hostFastMcq__image" src={imageUrl} alt="" /> : null}
            <span className="hostFastMcq__sparkle" aria-hidden="true" />
            <aside className="hostFastMcq__countdown" aria-label="Question countdown">
              <span>{countdown}</span>
            </aside>
          </section>
        </main>
      </div>

      <footer className="hostFastMcq__footer">
        <HostFastButton direction="back" onClick={onDashboard}>
          Dashboard
        </HostFastButton>
        <HostFastButton onClick={onNext}>Next</HostFastButton>
      </footer>
    </section>
  );
}
