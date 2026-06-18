import React from "react";
import "./HostSectionJourney.css";

const DEFAULT_SECTIONS = [
  { id: 1, title: "Warm Up", exerciseCount: 2 },
  { id: 2, title: "Vocabulary", exerciseCount: 4 },
  { id: 3, title: "Listening", exerciseCount: 3 },
  { id: 4, title: "Speaking", exerciseCount: 5 },
  { id: 5, title: "Review", exerciseCount: 1 },
  { id: 6, title: "Final Quiz", exerciseCount: 6 },
];

const ROAD_POINTS = [
  { x: 9, y: 21 },
  { x: 39, y: 66 },
  { x: 58, y: 54 },
  { x: 74, y: 37 },
  { x: 87, y: 23 },
  { x: 96, y: 20 },
];

function roadPoint(index, total) {
  if (total <= ROAD_POINTS.length) {
    return ROAD_POINTS[index] || ROAD_POINTS[ROAD_POINTS.length - 1];
  }

  const progress = total <= 1 ? 0 : index / (total - 1);
  const wave = Math.sin(progress * Math.PI * 2.5);
  return {
    x: 10 + progress * 80,
    y: 55 - wave * 16 - progress * 14,
  };
}

export default function HostSectionJourney({
  sections = DEFAULT_SECTIONS,
  courseTitle = "English Adventure",
  activeSectionId,
  onDashboard,
  onSelectSection,
}) {
  const totalExercises = sections.reduce(
    (sum, section) => sum + (section.exerciseCount ?? section.exercises?.length ?? 0),
    0
  );
  const roadPoints = sections.map((_, index) => roadPoint(index, sections.length));

  return (
    <section className="hostSectionJourney" aria-label="Continue Your Journey">
      <img className="hostSectionJourney__bg" src="/assets/class/bg.jpg" alt="" />
      <div className="hostSectionJourney__shade" aria-hidden="true" />

      <p className="hostSectionJourney__cornerTitle">Create new journey</p>
      <p className="hostSectionJourney__course">{courseTitle}</p>

      <header className="hostSectionJourney__heading">
        <p className="hostSectionJourney__kicker">Step 3</p>
        <h1 className="hostSectionJourney__title">Continue Your Journey!</h1>
        <p className="hostSectionJourney__subtitle">
          {sections.length} sections · {totalExercises} exercises
        </p>
      </header>

      <div className="hostSectionJourney__map" aria-hidden="true">
        <img className="hostSectionJourney__road hostSectionJourney__road--one" src="/road/Vector road 1.svg" alt="" />
        <img className="hostSectionJourney__road hostSectionJourney__road--two" src="/road/Vector road 2.svg" alt="" />
      </div>

      <div className="hostSectionJourney__nodes">
        {sections.map((section, index) => {
          const sectionNumber = section.order || index + 1;
          const exerciseCount = section.exerciseCount ?? section.exercises?.length ?? 0;
          const point = roadPoint(index, sections.length);
          const isActive = section.id === activeSectionId;
          const isLocked = exerciseCount <= 0;

          return (
            <article
              className={`hostSectionJourney__card${isActive ? " is-active" : ""}${isLocked ? " is-locked" : ""}`}
              key={section.id ?? sectionNumber}
              style={{ "--node-x": `${point.x}%`, "--node-y": `${point.y}%` }}
            >
              <div className="hostSectionJourney__pin" aria-hidden="true">
                <span>{sectionNumber}</span>
              </div>
              <div className="hostSectionJourney__content">
                {section.thumbnail ? (
                  <img className="hostSectionJourney__thumb" src={section.thumbnail} alt="" />
                ) : (
                  <span className="hostSectionJourney__thumb hostSectionJourney__thumb--empty" aria-hidden="true">
                    {sectionNumber}
                  </span>
                )}
                <div className="hostSectionJourney__copy">
                  <p>Section {sectionNumber}</p>
                  <h2>{section.title || "Section"}</h2>
                  <span>
                    {exerciseCount} exercise{exerciseCount === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  className="hostSectionJourney__button"
                  type="button"
                  disabled={isLocked}
                  onClick={() => onSelectSection?.(section)}
                >
                  {isLocked ? "Locked" : "Start"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="hostSectionJourney__footer">
        <button className="hostSectionJourney__back" type="button" onClick={onDashboard}>
          <img src="/assets/class/arrow-left.svg" alt="" />
          <span>Course</span>
        </button>
      </footer>
    </section>
  );
}

function roadGuidePoints(points) {
  const first = points[0];
  const last = points[points.length - 1];
  const lead = { x: Math.max(0, first.x - 15), y: first.y + 2 };
  const tail =
    last.x < 88
      ? [
          { x: 77, y: 45 },
          { x: 88, y: 27 },
          { x: 96, y: 23 },
        ]
      : [{ x: Math.min(99, last.x + 4), y: Math.max(18, last.y - 2) }];
  return [lead, ...points, ...tail];
}

function smoothRoadPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const dx = next.x - current.x;
    path += ` C ${current.x + dx * 0.46} ${current.y}, ${next.x - dx * 0.46} ${next.y}, ${next.x} ${next.y}`;
  }
  return path;
}
