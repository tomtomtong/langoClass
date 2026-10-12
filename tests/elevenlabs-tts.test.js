const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { synthesize, ENDPOINT, DEFAULT_VOICE_ID } = require("../lib/elevenlabs-tts");
const { buildQuestionTtsCacheKey } = require("../lib/question-tts-cache");
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

test("CMS data URL becomes playback-ready MP3 with the supplied request settings", async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, ENDPOINT);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { text: "Hello from Lango.", voiceId: DEFAULT_VOICE_ID, languageCode: "en", stability: 0 });
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ audio: "data:audio/mpeg;base64,SUQz" }));
  };
  assert.deepEqual(await synthesize(" Hello from Lango. ", { stability: 0 }), { audioContent: "SUQz", format: "mp3" });
});

test("custom voice and language reach CMS without Grok style markers", async () => {
  global.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { text: "Bonjour", voiceId: "custom_voice", languageCode: "fr", stability: 1 });
    return new Response(JSON.stringify({ audio: "data:audio/mpeg;base64,SUQz" }));
  };
  await synthesize("Bonjour", { voiceId: "custom_voice", languageCode: "fr", stability: 1 });
});

test("upstream errors and malformed audio cannot be cached as MP3", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: { message: "Voice not found" } }), { status: 400 });
  await assert.rejects(synthesize("Hello"), /Voice not found/);
  global.fetch = async () => new Response("<html>Bad gateway</html>", { status: 502 });
  await assert.rejects(synthesize("Hello"), /Invalid response \(502\)/);
  global.fetch = async () => new Response(JSON.stringify({ audio: "https://example.com/audio.mp3" }));
  await assert.rejects(synthesize("Hello"), /No MP3 audio/);
  global.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
  await assert.rejects(synthesize("Hello"), /Timed out/);
});

test("blank text does not call the paid speech API", async () => {
  global.fetch = async () => { assert.fail("fetch must not run"); };
  await assert.rejects(synthesize("  "), /No text/);
});

test("provider, voice and stability each isolate question audio caches", () => {
  const base = { text: "Hello", speakLangCode: "en", meta: { provider: "elevenlabs", model: "eleven_multilingual_v2", voice: DEFAULT_VOICE_ID, stability: 0.5 } };
  const key = buildQuestionTtsCacheKey(base);
  for (const override of [{ provider: "inworld" }, { voice: "other" }, { stability: 0 }]) {
    assert.notEqual(key, buildQuestionTtsCacheKey({ ...base, meta: { ...base.meta, ...override } }));
  }
});
