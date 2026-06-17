import React from "react";
import "./HostWaitingRoom.css";

const DEFAULT_STUDENTS = [
  "Emma Thompson",
  "Isabella Martinez",
  "Oliver Wilson",
  "Mia Chen",
  "Aiden Lee",
  "Sophia Patel",
  "Noah Kim",
  "Ava Wong",
  "Lucas Chen",
  "Harper Lam",
  "Ethan Ng",
  "Lily Chan",
];

function initialsForName(name) {
  return String(name || "Student")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "S";
}

export default function HostWaitingRoom({
  time = "05 : 00",
  connectedCount = 0,
  totalCount = 0,
  students = DEFAULT_STUDENTS,
  onDashboard,
  onStartSession,
}) {
  const visibleStudents = students.slice(0, 12);

  return (
    <section className="hostWaiting" aria-label="Waiting Room">
      <img className="hostWaiting__bg" src="/assets/course/courseBG.png" alt="" />
      <div className="hostWaiting__shade" aria-hidden="true" />

      <h1 className="hostWaiting__title">Waiting Room</h1>

      <aside className="hostWaiting__timer" aria-live="polite">
        <div className="hostWaiting__timerRing">
          <svg className="hostWaiting__watch" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="26" r="16" fill="#feca57" stroke="#d97706" strokeWidth="2" />
            <rect x="20" y="8" width="8" height="6" rx="2" fill="#d97706" />
            <circle cx="24" cy="26" r="2" fill="#7c2d12" />
            <line x1="24" y1="26" x2="24" y2="18" stroke="#7c2d12" strokeWidth="2" strokeLinecap="round" />
            <line x1="24" y1="26" x2="30" y2="30" stroke="#7c2d12" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="hostWaiting__timerLabel">Start In</p>
          <p className="hostWaiting__time">{time}</p>
        </div>
      </aside>

      <section className="hostWaiting__studentsPanel" aria-label="Connected Students">
        <header className="hostWaiting__studentsHeader">
          <div>
            <h2 className="hostWaiting__studentsTitle">Connected Students</h2>
            <p className="hostWaiting__studentsSubtitle">Waiting For The Class To Assemble...</p>
          </div>
          <div className="hostWaiting__count" aria-label={`${connectedCount} of ${totalCount} students connected`}>
            <span>{connectedCount}</span>
            <em>/</em>
            <strong>{totalCount}</strong>
          </div>
        </header>

        <ul className="hostWaiting__grid">
          {visibleStudents.map((student, index) => (
            <li className="hostWaiting__student" key={`${student}-${index}`}>
              <div className="hostWaiting__avatar" aria-hidden="true">
                <span>{initialsForName(student)}</span>
              </div>
              <p>{student}</p>
            </li>
          ))}
        </ul>
      </section>

      <img className="hostWaiting__wizard" src="/assets/login/wizard.png" alt="" />

      <footer className="hostWaiting__footer">
        <button className="hostWaiting__button" type="button" onClick={onDashboard}>
          <img src="/assets/class/arrow-left.svg" alt="" />
          <span>Dashboard</span>
        </button>
        <button className="hostWaiting__button hostWaiting__button--start" type="button" onClick={onStartSession}>
          <img src="/assets/waiting/play.png" alt="" />
          <span>Start Session</span>
        </button>
      </footer>
    </section>
  );
}
