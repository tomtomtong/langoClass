import React from "react";
import "./HostSectionProgress.css";

export default function HostSectionProgress({
  completedSections = 0,
  totalSections = 0,
  percent,
  className = "",
}) {
  const safeTotal = Math.max(0, Number(totalSections) || 0);
  const safeCompleted = Math.min(Math.max(0, Number(completedSections) || 0), safeTotal);
  const progressPercent =
    percent ?? (safeTotal > 0 ? Math.round((safeCompleted / safeTotal) * 100) : 0);
  const clampedPercent = Math.min(100, Math.max(0, progressPercent));

  return (
    <aside
      className={`hostSectionProgress${className ? ` ${className}` : ""}`}
      aria-label="Current progress"
    >
      <div
        className="hostSectionProgress__ring"
        style={{ "--progress": `${clampedPercent * 3.6}deg` }}
      >
        <span className="hostSectionProgress__pct">{clampedPercent}%</span>
      </div>
      <p className="hostSectionProgress__label">
        {safeCompleted} out of {safeTotal} Sections Completed
      </p>
    </aside>
  );
}
