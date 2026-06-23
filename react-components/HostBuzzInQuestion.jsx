import React from "react";
import "./HostBuzzInQuestion.css";

function FooterButton({ children, direction = "next", onClick }) {
  const isBack = direction === "back";

  return (
    <button className="hostBuzzIn__footerButton" type="button" onClick={onClick}>
      {isBack ? <img src="/assets/class/arrow-left.svg" alt="" /> : null}
      <span>{children}</span>
      {!isBack ? (
        <img className="hostBuzzIn__footerIconNext" src="/assets/class/arrow-left.svg" alt="" />
      ) : null}
    </button>
  );
}

export default function HostBuzzInQuestion({
  points = 300,
  countdown = 20,
  question = "What is the process by which plants make their own food?",
  onDashboard,
  onNext,
}) {
  return (
    <section className="hostBuzzIn" aria-label="Buzz in question">
      <img className="hostBuzzIn__bg" src="/assets/course/courseBG.png" alt="" />

      <div className="hostBuzzIn__stage">
        <header className="hostBuzzIn__header">
          <h1 className="hostBuzzIn__title">Buzz in question</h1>
        </header>

        <main className="hostBuzzIn__main">
          <section className="hostBuzzIn__questionCard">
            <p className="hostBuzzIn__points">{points} pts</p>
            <h2 className="hostBuzzIn__question">{question}</h2>
            <span className="hostBuzzIn__sparkle" aria-hidden="true" />
            <div className="hostBuzzIn__countdown" aria-label={`${countdown} seconds remaining`}>
              <span>{countdown}</span>
            </div>
          </section>

          <div className="hostBuzzIn__prompt" role="status">Buzz In Now</div>
        </main>
      </div>

      <footer className="hostBuzzIn__footer">
        <FooterButton direction="back" onClick={onDashboard}>Dashboard</FooterButton>
        <FooterButton onClick={onNext}>Next</FooterButton>
      </footer>
    </section>
  );
}
