// Uncle Tommy's voice for each slide, from the newcms router's Inworld TTS with
// the same voice and settings the Worker uses (worker/ai.js speakWithRouter).

const VOICE = "default-zylgts2tamenvybeti3z0w__uncle_tommy";
const MODEL = "inworld-tts-1.5-max";
const SPEAKING_RATE = 1.12;

export function speechLanguage(text) {
  if (/[぀-ヿ]/.test(text)) return "ja-JP";
  if (/[가-힯]/.test(text)) return "ko-KR";
  if (/[一-鿿]/.test(text)) return /[嘅咩唔喺噉乜哋佢睇]/.test(text) ? "yue-HK" : "zh-CN";
  return "en-US";
}

export async function speak(routerBase, text, language) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${routerBase}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          text,
          voice: VOICE,
          model: MODEL,
          language,
          audioEncoding: "MP3",
          sampleRate: 24000,
          speakingRate: SPEAKING_RATE,
        }),
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
