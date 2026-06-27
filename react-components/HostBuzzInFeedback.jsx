import React from "react";
import "./HostBuzzInFeedback.css";

function FooterButton({ children, direction = "next", onClick, variant }) {
  const isBack = direction === "back";

  return (
    <button
      className={`hostBuzzInFeedback__footerButton${variant === "random" ? " hostBuzzInFeedback__footerButton--random" : ""}`}
      type="button"
      onClick={onClick}
    >
      {isBack ? <img src="/assets/class/arrow-left.svg" alt="" /> : null}
      <span>{children}</span>
      {!isBack ? (
        <img className="hostBuzzInFeedback__footerIconNext" src="/assets/class/arrow-left.svg" alt="" />
      ) : null}
    </button>
  );
}

function ChatAvatar({ initials, variant = "student" }) {
  return (
    <div className={`hostBuzzInFeedback__avatar hostBuzzInFeedback__avatar--${variant}`} aria-hidden="true">
      <span>{initials}</span>
    </div>
  );
}

function WinnerCard({ name, buzzTime, isLive = false }) {
  const parts = String(name || "Student").trim().split(/\s+/).filter(Boolean);
  const line1 = parts[0] || "Student";
  const line2 = parts.slice(1).join(" ") || "";

  return (
    <article className={`hostBuzzInFeedback__winnerCard${isLive ? " is-live" : ""}`}>
      {isLive ? (
        <span className="hostBuzzInFeedback__liveBadge">
          <span className="hostBuzzInFeedback__liveIcon" aria-hidden="true" />
          LIVE
        </span>
      ) : null}
      <span className="hostBuzzInFeedback__medal" aria-hidden="true">1st</span>
      <ChatAvatar initials={(line1[0] || "S").toUpperCase()} />
      <div className="hostBuzzInFeedback__winnerCopy">
        <p className="hostBuzzInFeedback__winnerName">
          {line1}
          {line2 ? <><br />{line2}</> : null}
        </p>
        <p className="hostBuzzInFeedback__winnerTime">{buzzTime}</p>
      </div>
    </article>
  );
}

export default function HostBuzzInFeedback({
  topic = "What is the process by which plants make their own food?",
  studentName = "Emma Thompson",
  studentAnswer = "",
  feedbackSummary = "",
  feedbackDetails = "",
  buzzTime = "1.2s",
  isLive = false,
  isPending = false,
  pointsAwarded = 0,
  pointsTotal = 300,
  onDashboard,
  onRandom,
  onNext,
}) {
  const studentInitials = String(studentName || "S")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "S";

  return (
    <section className="hostBuzzInFeedback" aria-label="Buzz in answer and feedback">
      <img className="hostBuzzInFeedback__bg" src="/assets/course/courseBG.png" alt="" />

      <div className="hostBuzzInFeedback__stage">
        <header className="hostBuzzInFeedback__header">
          <h1 className="hostBuzzInFeedback__title">Buzz in question</h1>
        </header>

        <div className="hostBuzzInFeedback__layout">
          <aside className="hostBuzzInFeedback__realtime" aria-label="Real time discussion">
            <div className="hostBuzzInFeedback__realtimeHeader">
              <span>Real Time</span>
            </div>

            <div className="hostBuzzInFeedback__chat">
              <div className="hostBuzzInFeedback__chatRow hostBuzzInFeedback__chatRow--teacher">
                <ChatAvatar initials="T" variant="teacher" />
                <div className="hostBuzzInFeedback__bubble hostBuzzInFeedback__bubble--question">
                  <p>{topic}</p>
                </div>
              </div>

              {studentAnswer || isPending ? (
                <div className="hostBuzzInFeedback__chatRow hostBuzzInFeedback__chatRow--student">
                  <div className="hostBuzzInFeedback__bubble hostBuzzInFeedback__bubble--answer">
                    <p>{isPending ? "Speaking…" : studentAnswer}</p>
                  </div>
                  <ChatAvatar initials={studentInitials} />
                </div>
              ) : null}

              {feedbackSummary ? (
                <div className="hostBuzzInFeedback__chatRow hostBuzzInFeedback__chatRow--teacher">
                  <ChatAvatar initials="T" variant="teacher" />
                  <div className="hostBuzzInFeedback__feedbackGroup">
                    <div className="hostBuzzInFeedback__bubble hostBuzzInFeedback__bubble--feedback">
                      <p>{feedbackSummary}</p>
                    </div>
                    {feedbackDetails ? (
                      <div className="hostBuzzInFeedback__bubble hostBuzzInFeedback__bubble--feedback">
                        <p style={{ whiteSpace: "pre-wrap" }}>{feedbackDetails}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="hostBuzzInFeedback__leaderboard" aria-label="Buzz in winner">
            <div className="hostBuzzInFeedback__leaderboardHead">
              <div className="hostBuzzInFeedback__leaderboardTitles">
                <h2 className="hostBuzzInFeedback__leaderboardTitle">Fastest Student</h2>
                <p className="hostBuzzInFeedback__leaderboardSub">Buzz In Winner</p>
              </div>
              <div className="hostBuzzInFeedback__scoreBadge" aria-label="Points awarded">
                <span className="hostBuzzInFeedback__scoreCurrent">{pointsAwarded}</span>
                <span className="hostBuzzInFeedback__scoreSep">/</span>
                <span className="hostBuzzInFeedback__scoreTotal">{pointsTotal}</span>
              </div>
            </div>

            <div className="hostBuzzInFeedback__winnerWrap">
              <WinnerCard name={studentName} buzzTime={buzzTime} isLive={isLive} />
            </div>
          </section>
        </div>
      </div>

      <footer className="hostBuzzInFeedback__footer hostBuzzInFeedback__footer--withRandom">
        <FooterButton direction="back" onClick={onDashboard}>Dashboard</FooterButton>
        <FooterButton variant="random" onClick={onRandom}>Random</FooterButton>
        <FooterButton onClick={onNext}>Next</FooterButton>
      </footer>
    </section>
  );
}
