// What Uncle Tommy says about a question's results on the autoclass page.
//
// Nothing here is made up while the class waits. The lesson render (video-container/autoclass/)
// records many short lines in his voice, grouped by situation (the "banks" in cues.json); this module
// only reads the numbers and picks which lines to play. So it is quick, free, never says
// something nobody checked, and never says it wrong: each bank is written for one situation.
//
//   const summary = LangoAutoclassAnalysis.summarize(results, optionCount, correctIndex);
//   const lines = LangoAutoclassAnalysis.plan(summary, banks, wrongLines, picker).lines;
//
// Situations (summary.situation):
//   noAnswers    nobody answered (a class of none, or everyone silent)
//   singleRight  exactly one answer, and it was right
//   singleWrong  exactly one answer, and it was wrong
//   allRight     two or more answered and every answer was right
//   noneRight    two or more answered and none was right
//   mostRight    at least 70% of the answers were right
//   mixed        40% up to 70%
//   mostWrong    some were right, but fewer than 40%
// On top of that: a line about the most picked wrong option (when it was not a one-off), and a
// line about friends who did not answer in time (when it was more than one, or a quarter of the
// class). After the situation line there is at most one of those two: the wrong option, unless half
// the class or more was silent. A line never counts or names anyone.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LangoAutoclassAnalysis = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MOST_RIGHT = 0.7;
  const MIXED = 0.4;
  const SILENT_MIN = 2; // this many silent students, or...
  const SILENT_SHARE = 0.25; // ...this share of the class, is worth a word
  const MOSTLY_SILENT = 0.5; // this many silent beats a line about a wrong option
  const WRONG_MIN = 2; // a wrong option picked this often is worth a word...
  const SMALL_CLASS = 3; // ...or any pick at all in a class this small

  // results: question_results.results ([{ answerIndex, name, correct }]); answerIndex is null for
  // a student who did not answer. Counts come from answerIndex so a missing `correct` cannot hurt.
  function summarize(results, optionCount, correctIndex) {
    const list = Array.isArray(results) ? results.filter(Boolean) : [];
    const counts = Array.from({ length: Math.max(0, optionCount | 0) }, () => 0);
    let answered = 0;
    for (const item of list) {
      const index = item.answerIndex;
      if (Number.isInteger(index) && index >= 0 && index < counts.length) {
        counts[index] += 1;
        answered += 1;
      }
    }
    const right = counts[correctIndex] || 0;
    const total = Math.max(list.length, answered);
    let wrongTop = -1;
    counts.forEach((count, index) => {
      if (index !== correctIndex && count > 0 && (wrongTop < 0 || count > counts[wrongTop])) wrongTop = index;
    });
    return {
      total,
      answered,
      right,
      silent: total - answered,
      counts,
      wrongTop,
      wrongTopCount: wrongTop < 0 ? 0 : counts[wrongTop],
      situation: situationOf(answered, right),
    };
  }

  function situationOf(answered, right) {
    if (answered === 0) return "noAnswers";
    if (answered === 1) return right ? "singleRight" : "singleWrong";
    if (right === answered) return "allRight";
    if (right === 0) return "noneRight";
    const rate = right / answered;
    if (rate >= MOST_RIGHT) return "mostRight";
    if (rate >= MIXED) return "mixed";
    return "mostWrong";
  }

  // Picks lines so Tommy does not repeat himself: each bank is played through in a shuffled order
  // before any line comes round again, and the first line of a new round is never the one just played.
  function makePicker(random = Math.random) {
    const queues = new Map();
    const last = new Map();
    return {
      next(key, list) {
        if (!Array.isArray(list) || !list.length) return null;
        if (list.length === 1) return list[0];
        let queue = queues.get(key);
        if (!queue || !queue.length) {
          queue = shuffled(list, random);
          if (queue[0] === last.get(key)) queue.push(queue.shift());
          queues.set(key, queue);
        }
        const item = queue.shift();
        last.set(key, item);
        return item;
      },
    };
  }

  function shuffled(list, random) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // banks: { leadIn, noAnswers, singleRight, ..., someSilent }, each a list of { text, url }.
  // wrongLines: { [optionIndex]: [{ text, url }] } for this question.
  // A bank that is missing or empty is skipped, so a half-built lesson never breaks the page.
  function plan(summary, banks = {}, wrongLines = {}, picker = makePicker(), { questionKey = "" } = {}) {
    const lines = [];
    const add = (key, list) => {
      const line = picker.next(key, list);
      if (line) lines.push({ ...line, kind: key.split(":")[0] });
    };

    if (summary.situation !== "noAnswers") add("leadIn", banks.leadIn);
    add(summary.situation, banks[summary.situation]);

    const worthAWord = summary.wrongTopCount >= WRONG_MIN || (summary.total <= SMALL_CLASS && summary.wrongTopCount >= 1);
    if (summary.wrongTop >= 0 && worthAWord) {
      add(`wrong:${questionKey}:${summary.wrongTop}`, wrongLines[summary.wrongTop]);
    }

    // Tommy says at most one thing after the situation line, so the results stay short: the
    // silent friends only when most of the class was silent, otherwise the wrong option he can teach.
    const silentCounts = summary.silent >= SILENT_MIN || (summary.total > 0 && summary.silent / summary.total >= SILENT_SHARE);
    const mostlySilent = summary.total > 0 && summary.silent / summary.total >= MOSTLY_SILENT;
    const saidWrong = lines.some((line) => line.kind === "wrong");
    if (summary.answered > 0 && summary.silent > 0 && silentCounts && (!saidWrong || mostlySilent)) {
      if (saidWrong) lines.pop();
      add("someSilent", banks.someSilent);
    }

    return { situation: summary.situation, lines };
  }

  return { summarize, plan, makePicker, situationOf };
});
