import assert from "node:assert/strict";
import test from "node:test";
import { handleModelRequest, requestSpeechText } from "./models.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("speech calls the backend transcription route when the dedicated route is absent", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body });
    if (String(url).endsWith("/api/stt")) return jsonResponse({ message: "Cannot POST /api/stt" }, 404);
    assert.equal(String(url), "https://classroom.lango.ai/api/transcribe/audio");
    assert.ok(init.body instanceof FormData);
    return jsonResponse({ ok: true, text: "hello class" });
  };
  try {
    const text = await requestSpeechText(
      { ORIGIN: "https://classroom.lango.ai" },
      { audioBase64: btoa("hello"), format: "wav" }
    );
    assert.equal(text, "hello class");
    assert.equal(calls.length, 2);
    const response = await handleModelRequest(
      new Request("https://class.lango.ai/api/stt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audioBase64: btoa("hello"), format: "wav" }),
      }),
      { ORIGIN: "https://classroom.lango.ai" },
      new URL("https://class.lango.ai/api/stt")
    );
    assert.equal(response.headers.get("x-model-runtime"), "backend");
    assert.deepEqual(await response.json(), { ok: true, text: "hello class" });
  } finally {
    globalThis.fetch = original;
  }
});

test("language calls stay on the backend and ignore a client-supplied key", async () => {
  const original = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/llm")) return jsonResponse({ message: "missing" }, 404);
    sent = JSON.parse(init.body);
    assert.equal(init.headers.get("authorization"), "Bearer teacher");
    return jsonResponse({ reply: "A noun is a naming word." });
  };
  try {
    const response = await handleModelRequest(
      new Request("https://class.lango.ai/llm", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer teacher",
          "x-teacher-id": "835",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "What is a noun?" }],
          maxTokens: 64,
          openrouterApiKey: "should-not-be-forwarded",
        }),
      }),
      { ORIGIN: "https://classroom.lango.ai" },
      new URL("https://class.lango.ai/llm")
    );
    assert.equal(response.headers.get("x-model-runtime"), "backend");
    assert.deepEqual(await response.json(), { ok: true, text: "A noun is a naming word." });
    assert.equal(sent.message, "What is a noun?");
    assert.equal(sent.openrouterApiKey, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("speech synthesis uses the dedicated backend route when it exists", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://classroom.lango.ai/api/tts");
    assert.equal(JSON.parse(init.body).text, "Good morning.");
    return jsonResponse({ ok: true, audioContent: "abc", format: "mp3" });
  };
  try {
    const response = await handleModelRequest(
      new Request("https://class.lango.ai/api/tts", {
        method: "POST",
        body: JSON.stringify({ text: "Good morning.", language: "en" }),
      }),
      { ORIGIN: "https://classroom.lango.ai" },
      new URL("https://class.lango.ai/api/tts")
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, audioContent: "abc", format: "mp3" });
  } finally {
    globalThis.fetch = original;
  }
});
