/** Grok Voice TTS playback speed (0.7–1.5). Slightly above 1.0 sounds more energetic. */
const GROK_GAMEPLAY_TTS_SPEED = 1.12;

/** Inworld speaking rate (0.5–1.5). Slightly above 1.0 sounds more upbeat. */
const INWORLD_GAMEPLAY_SPEAKING_RATE = 1.12;

const INWORLD_GAMEPLAY_INSTRUCTION =
  "Speak with warm, happy, excited game-show host energy — smiling, upbeat, and encouraging.";

/**
 * Style Grok TTS input for happier, more excited delivery.
 * Uses xAI inline/wrapping speech tags plus livelier punctuation.
 * @param {string} text
 * @param {"question"|"topic"|"announcement"|"feedback"} [purpose]
 */
function styleGrokGameplayTtsText(text, purpose = "question") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return trimmed;
  if (/<(fast|loud|build-intensity|emphasis|whisper|slow|soft)>/.test(trimmed)) {
    return trimmed;
  }

  const lively = addExcitedPunctuation(trimmed, purpose);

  switch (purpose) {
    case "feedback":
      return `<fast><emphasis>${lively}</emphasis></fast>`;
    case "announcement":
      return `<fast><loud>${lively}</loud></fast>`;
    case "topic":
      return `<fast><emphasis>${lively}</emphasis></fast>`;
    case "question":
    default:
      return `<fast><loud>${lively}</loud></fast>`;
  }
}

function addExcitedPunctuation(text, purpose) {
  if (/[!！?？]$/.test(text)) return text;
  if (purpose === "feedback") {
    if (/[.。…]$/.test(text)) return text.replace(/[.。…]+$/, "!");
    return text;
  }
  if (/[.。…]$/.test(text)) return text.replace(/[.。…]+$/, "!");
  return `${text}!`;
}

module.exports = {
  GROK_GAMEPLAY_TTS_SPEED,
  INWORLD_GAMEPLAY_SPEAKING_RATE,
  INWORLD_GAMEPLAY_INSTRUCTION,
  styleGrokGameplayTtsText,
  addExcitedPunctuation,
};
