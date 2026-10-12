const ENDPOINT = "https://newcms.lango.ai/api/router/elevenlabs-tts";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_STABILITY = 0.5;

async function synthesize(text, { voiceId = DEFAULT_VOICE_ID, languageCode = "en", stability = DEFAULT_STABILITY } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("No text to synthesize.");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(40000),
    body: JSON.stringify({ text: trimmed, voiceId, languageCode, stability }),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`ElevenLabs TTS: Invalid response (${response.status}).`); }
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS: ${data?.error?.message || data?.message || (typeof data?.error === "string" ? data.error : `API returned ${response.status}.`)}`);
  }
  const match = typeof data?.audio === "string" && data.audio.match(/^data:audio\/(?:mpeg|mp3);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || !Buffer.from(match[1], "base64").length) throw new Error("ElevenLabs TTS: No MP3 audio returned.");
  return { audioContent: match[1].replace(/\s/g, ""), format: "mp3" };
}

module.exports = { ENDPOINT, DEFAULT_VOICE_ID, DEFAULT_STABILITY, synthesize };
