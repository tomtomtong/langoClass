// WebVTT cues: building them from word timings, parsing, and translating with
// an injected model call. No files or ffmpeg, so the Worker can use it too.

const WORDS_PER_CUE = 10;
const MAX_CUE_MS = 4500;

function normalizeWordTimestamps(rawWords, offsetMs = 0) {
  return (Array.isArray(rawWords) ? rawWords : [])
    .map((entry) => {
      const word = String(entry?.word || "").trim();
      if (!word) return null;
      const startMs = Number(
        entry.startTimeMs ??
          (Number.isFinite(Number(entry.startTimeSeconds))
            ? Number(entry.startTimeSeconds) * 1000
            : entry.start ?? entry.start_ms ?? 0)
      );
      const endMs = Number(
        entry.endTimeMs ??
          (Number.isFinite(Number(entry.endTimeSeconds))
            ? Number(entry.endTimeSeconds) * 1000
            : entry.end ?? entry.end_ms ?? startMs + 300)
      );
      return {
        word,
        startMs: offsetMs + Math.max(0, startMs),
        endMs: offsetMs + Math.max(startMs + 40, endMs),
      };
    })
    .filter(Boolean);
}

function syntheticWordsFromTranscript(transcript, offsetMs, durationMs) {
  const parts = String(transcript || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length || durationMs <= 0) return [];

  const step = durationMs / parts.length;
  return parts.map((word, index) => {
    const startMs = Math.round(offsetMs + index * step);
    const endMs = Math.round(offsetMs + (index + 1) * step);
    return { word, startMs, endMs: Math.max(startMs + 40, endMs) };
  });
}

function groupWordsIntoCues(words) {
  const cues = [];
  let current = null;

  for (const word of words) {
    if (!current) {
      current = {
        startMs: word.startMs,
        endMs: word.endMs,
        words: [word.word],
      };
      continue;
    }

    const nextText = `${current.words.join(" ")} ${word.word}`;
    const gap = word.startMs - current.endMs;
    const span = word.endMs - current.startMs;
    const shouldBreak =
      current.words.length >= WORDS_PER_CUE ||
      span > MAX_CUE_MS ||
      gap > 900 ||
      /[.!?。！？]$/.test(current.words[current.words.length - 1] || "");

    if (shouldBreak) {
      cues.push(current);
      current = {
        startMs: word.startMs,
        endMs: word.endMs,
        words: [word.word],
      };
    } else {
      current.words.push(word.word);
      current.endMs = Math.max(current.endMs, word.endMs);
      // silence unused; nextText helps readability in debug only
      void nextText;
    }
  }

  if (current?.words?.length) cues.push(current);
  return cues.map((cue) => ({
    startMs: cue.startMs,
    endMs: Math.max(cue.endMs, cue.startMs + 400),
    text: cue.words.join(" ").replace(/\s+/g, " ").trim(),
  }));
}

function formatVttTimestamp(ms) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function cuesToWebVtt(cues) {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    if (!cue.text) return;
    lines.push(String(index + 1));
    lines.push(`${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return `${lines.join("\n").trim()}\n`;
}

function parseVttTimestamp(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const fraction = String(match[4] || "0").padEnd(3, "0").slice(0, 3);
  return hours * 3600 + minutes * 60 + seconds + Number(fraction) / 1000;
}

function parseWebVtt(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n");
  const cues = [];
  let index = 0;

  if (/^WEBVTT/i.test(lines[0] || "")) index = 1;

  while (index < lines.length) {
    while (index < lines.length && !String(lines[index] || "").trim()) index += 1;
    if (index >= lines.length) break;

    let line = String(lines[index] || "").trim();
    if (/^\d+$/.test(line)) {
      index += 1;
      line = String(lines[index] || "").trim();
    }

    const timing = line.match(
      /^((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/
    );
    if (!timing) {
      index += 1;
      continue;
    }

    const start = parseVttTimestamp(timing[1]);
    const end = parseVttTimestamp(timing[2]);
    index += 1;
    const textLines = [];
    while (index < lines.length && String(lines[index] || "").trim()) {
      textLines.push(String(lines[index]).trim());
      index += 1;
    }

    if (Number.isFinite(start) && Number.isFinite(end) && end > start && textLines.length) {
      cues.push({
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        text: textLines.join("\n"),
      });
    }
  }

  return cues;
}

function languageDisplayName(code) {
  const map = {
    en: "English",
    zh: "Simplified Chinese",
    yue: "Cantonese Chinese",
    ja: "Japanese",
    ko: "Korean",
  };
  return map[String(code || "").toLowerCase()] || String(code || "the target language");
}

/**
 * Translate cue texts with an LLM callback while preserving timings.
 * @param {string} vttText
 * @param {string} targetLanguage
 * @param {(messages: Array<{role:string, content:string}>, maxTokens: number) => Promise<string>} llmComplete
 */
async function translateWebVtt(vttText, targetLanguage, llmComplete) {
  const cues = parseWebVtt(vttText);
  if (!cues.length) throw new Error("Source captions have no cues to translate.");
  if (typeof llmComplete !== "function") throw new Error("LLM translate function is required.");

  const numbered = cues.map((cue, index) => `${index + 1}. ${cue.text}`).join("\n");
  const targetName = languageDisplayName(targetLanguage);
  const reply = await llmComplete(
    [
      {
        role: "system",
        content:
          "You translate video subtitle lines. Keep the same numbering and line count. Return only the translated numbered list. Do not add commentary.",
      },
      {
        role: "user",
        content: `Translate each subtitle line into ${targetName}. Keep meaning natural for learners. Preserve numbering exactly.\n\n${numbered}`,
      },
    ],
    Math.min(4000, 120 + cues.length * 40)
  );

  const translations = new Map();
  String(reply || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^(\d+)\s*[.、:)\-]\s*(.+)$/);
      if (!match) return;
      translations.set(Number(match[1]), match[2].trim());
    });

  const translatedCues = cues.map((cue, index) => ({
    ...cue,
    text: translations.get(index + 1) || cue.text,
  }));

  const translatedCount = translatedCues.filter(
    (cue, index) => cue.text !== cues[index].text
  ).length;
  if (!translatedCount) {
    throw new Error("Translation returned no usable subtitle lines.");
  }

  return cuesToWebVtt(translatedCues);
}

module.exports = {
  normalizeWordTimestamps,
  syntheticWordsFromTranscript,
  groupWordsIntoCues,
  formatVttTimestamp,
  cuesToWebVtt,
  parseVttTimestamp,
  parseWebVtt,
  languageDisplayName,
  translateWebVtt,
  WORDS_PER_CUE,
  MAX_CUE_MS,
};
