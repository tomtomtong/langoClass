import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { completeText, speak, speechProvider, speechReady, transcribe } from "./ai.js";
import { buzzFeedbackPrompt, parseBuzzFeedback } from "./buzz-feedback.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("speech uses the chosen provider, then keys, then the keyless ElevenLabs router", () => {
  assert.equal(speechProvider({ GAMEPLAY_TTS_PROVIDER: "openrouter" }), "openrouter");
  assert.equal(speechProvider({ INWORLD_API_KEY: "k" }), "inworld");
  assert.equal(speechProvider({ INWORLD_API_KEY: "k", OPENROUTER_API_KEY: "o" }, "hk-elderly"), "openrouter");
  assert.equal(speechProvider({}), "elevenlabs");
  assert.equal(speechReady({}), true);
  assert.equal(speechReady({ GAMEPLAY_TTS_PROVIDER: "inworld" }), false);
});

test("ElevenLabs speech goes through the CMS router", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://cms.example/api/router/elevenlabs-tts");
    const body = JSON.parse(init.body);
    assert.equal(body.text, "Hello Ada");
    assert.equal(body.languageCode, "en");
    return new Response(JSON.stringify({ audio: "data:audio/mpeg;base64,SUQz" }));
  };
  const audio = await speak({ CMS_API_BASE: "https://cms.example" }, "Hello Ada", { language: "en-US" });
  assert.deepEqual(audio, { audioContent: "SUQz", format: "mp3" });
});

test("text needs an OpenRouter key and returns the model reply", async () => {
  await assert.rejects(completeText({}, [{ role: "user", content: "hi" }]), /OPENROUTER_API_KEY/);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer secret");
    assert.equal(JSON.parse(init.body).max_tokens, 220);
    return new Response(JSON.stringify({ choices: [{ message: { content: " Verdict: Correct " } }] }));
  };
  assert.equal(await completeText({ OPENROUTER_API_KEY: "secret" }, [{ role: "user", content: "hi" }], 220), "Verdict: Correct");
});

test("speech to text prefers Inworld in the round's language", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.inworld.ai/stt/v1/transcribe");
    const body = JSON.parse(init.body);
    assert.equal(body.transcribeConfig.language, "yue");
    assert.equal(body.transcribeConfig.audioEncoding, "LINEAR16");
    assert.equal(body.audioData.content, "UklGRg==");
    return new Response(JSON.stringify({ transcription: { transcript: " 蘋果 " } }));
  };
  const text = await transcribe({ INWORLD_API_KEY: "k" }, { audioBase64: "data:audio/wav;base64,UklGRg==", format: "wav", language: "yue-HK" });
  assert.equal(text, "蘋果");
});

test("Buzz In feedback splits the host lines from the spoken line", () => {
  const parsed = parseBuzzFeedback(
    "Verdict: Partially correct\n✅ Correctness (60): Close\n🧩 Completeness (50): Short\n🗣️ Fluency (70): Clear\nSpoken Feedback: \"Nice try, Ada!\"",
    "Ada"
  );
  assert.equal(parsed.answerVerdict, "partial");
  assert.equal(parsed.isCorrect, false);
  assert.equal(parsed.spokenFeedback, "Nice try, Ada!");
  assert.match(parsed.analysis, /^✅ Correctness/);
  assert.doesNotMatch(parsed.analysis, /Verdict|Spoken/);
  assert.match(parseBuzzFeedback("", "Bo").spokenFeedback, /Thanks for your answer, Bo!/);
});

test("the Cantonese marking prompt is chosen for yue rooms", () => {
  const prompt = buzzFeedbackPrompt({ topic: "水果", correctAnswer: "蘋果", studentName: "Ada", responseText: "橙", hasAudio: true, language: "yue" });
  assert.match(prompt, /香港廣東話老師助手/);
  assert.match(prompt, /預期正確答案（老師參考）：蘋果/);
  assert.match(buzzFeedbackPrompt({ topic: "Fruit", studentName: "Ada", responseText: "apple", language: "en" }), /No recording was supplied/);
});
