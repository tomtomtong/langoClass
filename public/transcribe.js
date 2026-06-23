const DEFAULT_MODEL = "mistralai/voxtral-small-24b-2507";
const STORAGE_KEY = "openrouter_transcribe_config";

const apiKeyInput = document.getElementById("transcribe-api-key");
const showKeyCheckbox = document.getElementById("transcribe-show-key");
const modelInput = document.getElementById("transcribe-model");
const modelDefaultHint = document.getElementById("transcribe-model-default");
const fileInput = document.getElementById("transcribe-audio-file");
const fileNameInput = document.getElementById("transcribe-file-name");
const output = document.getElementById("transcribe-output");
const statusEl = document.getElementById("transcribe-status");
const errorSection = document.getElementById("transcribe-error-section");
const errorLog = document.getElementById("transcribe-error-log");
const btnTranscribe = document.getElementById("btn-transcribe");
const btnTest = document.getElementById("btn-transcribe-test");
const btnSave = document.getElementById("btn-transcribe-save");
const btnCopy = document.getElementById("btn-transcribe-copy");
const btnClear = document.getElementById("btn-transcribe-clear");
const btnClearErrors = document.getElementById("btn-transcribe-clear-errors");

let busy = false;
let selectedFile = null;

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_MODEL;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ api_key: apiKey, model }));
  setStatus("Settings saved in this browser.");
}

function applySettings() {
  const config = loadSettings();
  apiKeyInput.value = config.api_key || "";
  modelInput.value = config.model || DEFAULT_MODEL;
  modelDefaultHint.textContent = `Default: ${DEFAULT_MODEL}`;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function formatErrorEntry(context, message, details = null) {
  const time = new Date().toLocaleString();
  const lines = [`[${time}] ${context}`, message];
  if (details != null && details !== "") {
    lines.push(
      typeof details === "string" ? details : JSON.stringify(details, null, 2)
    );
  }
  return lines.join("\n");
}

function logError(context, message, details = null) {
  const entry = formatErrorEntry(context, message, details);
  errorLog.value = errorLog.value ? `${errorLog.value}\n\n${entry}` : entry;
  errorSection.hidden = false;
  errorLog.scrollTop = errorLog.scrollHeight;
}

function clearErrorLog() {
  errorLog.value = "";
  errorSection.hidden = true;
}

async function readResponseBody(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function setBusy(nextBusy) {
  busy = nextBusy;
  btnTranscribe.disabled = nextBusy;
  btnTest.disabled = nextBusy;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readResponseBody(res);
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status}).`);
    err.status = res.status;
    err.responseBody = data;
    throw err;
  }
  return data;
}

async function testApi() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    const message = "Enter your OpenRouter API key.";
    setStatus(message, true);
    logError("Test API", message);
    return;
  }

  setBusy(true);
  setStatus("Testing API with text-only request…");
  output.value = "";

  try {
    const result = await postJson("/api/transcribe/test", { apiKey, model });
    output.value = JSON.stringify(result, null, 2);
    setStatus(`API test succeeded (${result.latencyMs} ms).`);
    saveSettings();
  } catch (err) {
    const message = err.message || "API test failed.";
    setStatus("API test failed.", true);
    logError("Test API", message, err.responseBody || null);
  } finally {
    setBusy(false);
  }
}

async function transcribeAudio() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    const message = "Enter your OpenRouter API key.";
    setStatus(message, true);
    logError("Transcribe", message);
    return;
  }
  if (!selectedFile) {
    const message = "Choose an audio file first.";
    setStatus(message, true);
    logError("Transcribe", message);
    return;
  }

  setBusy(true);
  setStatus("Transcribing and reviewing pronunciation…");
  output.value = "";

  const formData = new FormData();
  formData.append("audio", selectedFile);
  formData.append("apiKey", apiKey);
  formData.append("model", model);

  try {
    const res = await fetch("/api/transcribe/audio", {
      method: "POST",
      body: formData,
    });
    const data = await readResponseBody(res);
    if (!res.ok) {
      const message = data.message || `Transcription failed (${res.status}).`;
      setStatus("Transcription failed.", true);
      logError("Transcribe", message, data);
      return;
    }
    output.value = data.text || "";
    setStatus("Transcription and pronunciation feedback complete.");
    saveSettings();
  } catch (err) {
    const message = err.message || "Transcription failed.";
    setStatus("Transcription failed.", true);
    logError("Transcribe", message, err.responseBody || null);
  } finally {
    setBusy(false);
  }
}

function copyResult() {
  const text = output.value.trim();
  if (!text) {
    const message = "Nothing to copy yet.";
    setStatus(message, true);
    logError("Copy result", message);
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => setStatus("Result copied to clipboard."),
    () => {
      const message = "Could not copy to clipboard.";
      setStatus(message, true);
      logError("Copy result", message);
    }
  );
}

function clearOutput() {
  output.value = "";
  setStatus("Output cleared.");
}

showKeyCheckbox.addEventListener("change", () => {
  apiKeyInput.type = showKeyCheckbox.checked ? "text" : "password";
});

fileInput.addEventListener("change", () => {
  selectedFile = fileInput.files?.[0] || null;
  fileNameInput.value = selectedFile ? selectedFile.name : "";
});

btnTranscribe.addEventListener("click", () => {
  if (!busy) void transcribeAudio();
});

btnTest.addEventListener("click", () => {
  if (!busy) void testApi();
});

btnSave.addEventListener("click", saveSettings);
btnCopy.addEventListener("click", copyResult);
btnClear.addEventListener("click", clearOutput);
btnClearErrors.addEventListener("click", clearErrorLog);

applySettings();
