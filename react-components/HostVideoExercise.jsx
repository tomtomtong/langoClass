import React from "react";
import "./HostVideoExercise.css";

function HostVideoButton({ children, direction = "next", onClick }) {
  const isBack = direction === "back";

  return (
    <button className="hostVideo__button" type="button" onClick={onClick}>
      {isBack ? (
        <img className="hostVideo__buttonIcon" src="/assets/class/arrow-left.svg" alt="" />
      ) : null}
      <span>{children}</span>
      {!isBack ? (
        <img className="hostVideo__buttonIcon hostVideo__buttonIcon--next" src="/assets/class/arrow-left.svg" alt="" />
      ) : null}
    </button>
  );
}

export default function HostVideoExercise({
  title = "Introductory Video",
  subtitle = "",
  videoUrl = "",
  poster = "",
  onDashboard,
  onNext,
}) {
  return (
    <section className="hostVideo" aria-label={title}>
      <img className="hostVideo__bg" src="/assets/course/courseBG.png" alt="" />
      <div className="hostVideo__stage">
        <header className="hostVideo__header">
          <h1 className="hostVideo__title">{title}</h1>
          {subtitle ? <p className="hostVideo__subtitle">{subtitle}</p> : null}
        </header>

        <main className="hostVideo__main">
          <section className="hostVideo__card" aria-label="Video player">
            <span className="hostVideo__sparkle" aria-hidden="true" />
            <div className="hostVideo__videoFrame">
              {videoUrl ? (
                <video
                  className="hostVideo__player"
                  controls
                  playsInline
                  poster={poster || undefined}
                  src={videoUrl}
                />
              ) : (
                <svg className="hostVideo__placeholderIcon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Z" />
                  <path d="m10 8 6 4-6 4V8Z" />
                </svg>
              )}
            </div>
          </section>
        </main>
      </div>

      <footer className="hostVideo__footer">
        <HostVideoButton direction="back" onClick={onDashboard}>
          Dashboard
        </HostVideoButton>
        <HostVideoButton onClick={onNext}>Next</HostVideoButton>
      </footer>
    </section>
  );
}
