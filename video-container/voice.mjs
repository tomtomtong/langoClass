// Uncle Tommy's voice for each slide, from the newcms router's Inworld TTS with
// the same voice and settings the Worker uses (worker/ai.js speakWithRouter).
// Cantonese (yue-HK) is the exception: it is always ElevenLabs v4 with the Cantonese
// voice below, via the router's /elevenlabs-tts, as in worker/ai.js.
import { createHash } from "node:crypto";

const VOICE = "default-zylgts2tamenvybeti3z0w__uncle_tommy";
const MODEL = "inworld-tts-1.5-max";
const SPEAKING_RATE = 1.12;
const ELEVENLABS_CANTONESE_VOICE = "SPRXwABrRtJGzRFBpO1H";
const ELEVENLABS_MODEL = "eleven_v4";
const ELEVENLABS_STABILITY = 0.5;

// The name a line is kept under in the autoclass voice cache (R2 uploads/autoclass/_voice/):
// everything that changes how it sounds is in it, so a cached line is never the wrong one.
export function voiceKey(text, language, speakingRate = SPEAKING_RATE) {
  if (language === "yue-HK") {
    return createHash("sha1").update(`v2|elevenlabs|${ELEVENLABS_CANTONESE_VOICE}|${ELEVENLABS_MODEL}|${text}`).digest("hex").slice(0, 24);
  }
  return createHash("sha1").update(`v1|${VOICE}|${MODEL}|${language}|${speakingRate}|${text}`).digest("hex").slice(0, 24);
}

export function speechLanguage(text) {
  if (/[぀-ヿ]/.test(text)) return "ja-JP";
  if (/[가-힯]/.test(text)) return "ko-KR";
  if (/[一-鿿]/.test(text)) return /[嘅咩唔喺噉乜哋佢睇]/.test(text) ? "yue-HK" : "zh-CN";
  return "en-US";
}

export async function speak(routerBase, text, language, speakingRate = SPEAKING_RATE) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const cantonese = language === "yue-HK";
      const res = await fetch(`${routerBase}/${cantonese ? "elevenlabs-tts" : "tts"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          cantonese
            ? { text, voiceId: ELEVENLABS_CANTONESE_VOICE, modelId: ELEVENLABS_MODEL, languageCode: "yue", stability: ELEVENLABS_STABILITY }
            : { text, voice: VOICE, model: MODEL, language, audioEncoding: "MP3", sampleRate: 24000, speakingRate }
        ),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Voice (router): ${data?.message || data?.error || res.status}`);
      const match = typeof data?.audio === "string" && data.audio.match(/^data:audio\/(?:mpeg|mp3);base64,([A-Za-z0-9+/=\s]+)$/);
      if (!match) throw new Error("Voice (router): no MP3 audio returned.");
      return Buffer.from(match[1].replace(/\s/g, ""), "base64");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}
