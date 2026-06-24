const DEFAULT_MODEL = "mistralai/voxtral-small-24b-2507";
const STORAGE_KEY = "openrouter_transcribe_config";
const MAX_RECORD_MS = 60000;

const modelInput = document.getElementById("transcribe-model");
const modelDefaultHint = document.getElementById("transcribe-model-default");
const configStatusEl = document.getElementById("transcribe-config-status");
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
const btnRecord = document.getElementById("btn-transcribe-record");
const recordStatus = document.getElementById("transcribe-record-status");
const audioPreview = document.getElementById("transcribe-audio-preview");

let busy = false;
let selectedFile = null;
let mediaRecorder = null;
let audioChunks = [];
let recordStream = null;
let recordedBlob = null;
let recordedFormat = "webm";
let recordTimer = null;
let previewUrl = null;

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettings() {
  const model = modelInput.value.trim() || DEFAULT_MODEL;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ model }));
  setStatus("Model preference saved in this browser.");
}

function applySettings() {
  const config = loadSettings();
  modelInput.value = config.model || DEFAULT_MODEL;
}

async function loadOpenRouterConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await readResponseBody(res);
    if (!res.ok) {
      throw new Error(data.message || `Could not load config (${res.status}).`);
    }

    const configured = !!data.openrouterApiKeyConfigured;
    const effectiveModel = data.effectiveOpenRouterBuzzinModel || DEFAULT_MODEL;

    if (configStatusEl) {
      configStatusEl.textContent = configured
        ? `OpenRouter key is configured (${data.openrouterApiKeyMasked || "active"}).`
        : "OpenRouter is not configured. Add your API key on the Config page.";
      configStatusEl.classList.toggle("is-error", !configured);
    }

    if (!loadSettings().model) {
      modelInput.value = effectiveModel;
    }
    modelDefaultHint.textContent = `Config default: ${effectiveModel}`;
    return configured;
  } catch (err) {
    if (configStatusEl) {
      configStatusEl.textContent = err.message || "Could not load OpenRouter config.";
      configStatusEl.classList.add("is-error");
    }
    modelDefaultHint.textContent = `Default: ${DEFAULT_MODEL}`;
    return false;
  }
}

function requireOpenRouterConfig(configured) {
  if (configured) return true;
  const message = "OpenRouter is not configured. Add your API key on the Config page.";
  setStatus(message, true);
  logError("OpenRouter config", message);
  return false;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function setRecordStatus(message) {
  recordStatus.textContent = message;
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
  if (mediaRecorder?.state !== "recording") {
    btnRecord.disabled = nextBusy;
  }
}

function clearRecordingPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  audioPreview.removeAttribute("src");
  audioPreview.hidden = true;
}

function resetRecording() {
  if (recordTimer) {
    clearTimeout(recordTimer);
    recordTimer = null;
  }

  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  } else if (recordStream) {
    recordStream.getTracks().forEach((track) => track.stop());
    recordStream = null;
  }

  mediaRecorder = null;
  audioChunks = [];
  recordedBlob = null;
  recordedFormat = "webm";
  selectedFile = null;
  clearRecordingPreview();

  btnRecord.textContent = "Record";
  btnRecord.classList.remove("is-recording");
  btnRecord.disabled = busy;
  setRecordStatus("Tap Record, then speak.");
}

function waitForRecordedBlob(timeoutMs = 3000) {
  if (recordedBlob?.size) {
    return Promise.resolve(recordedBlob);
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (recordedBlob?.size) {
        resolve(recordedBlob);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("No audio captured. Try recording again."));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function setRecordedFile(uploadBlob, uploadFormat, previewBlob = uploadBlob) {
  recordedBlob = uploadBlob;
  recordedFormat = uploadFormat;
  selectedFile = new File([uploadBlob], `recording.${uploadFormat}`, {
    type: uploadBlob.type || "audio/wav",
  });

  clearRecordingPreview();
  previewUrl = URL.createObjectURL(previewBlob);
  audioPreview.src = previewUrl;
  audioPreview.hidden = false;
  setRecordStatus("Recording ready — click Transcribe or record again.");
}

async function finalizeRecording(rawBlob, sourceFormat) {
  btnRecord.disabled = true;
  setRecordStatus("Converting recording to WAV for transcription…");

  try {
    const wavBlob = await blobToWavBlob(rawBlob);
    setRecordedFile(wavBlob, "wav", rawBlob);
    setStatus("Recording saved as WAV. Click Transcribe.");
  } catch (err) {
    const message = err.message || "Could not convert recording to WAV.";
    setRecordStatus("Conversion failed. Try recording again.");
    setStatus(message, true);
    logError("Record", message);
    selectedFile = null;
    recordedBlob = null;
  } finally {
    btnRecord.textContent = "Record";
    btnRecord.classList.remove("is-recording");
    btnRecord.disabled = busy;
  }
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const message = "Microphone recording is not supported in this browser.";
    setStatus(message, true);
    logError("Record", message);
    return;
  }

  resetRecording();

  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const message = err.message || "Could not access the microphone.";
    setStatus(message, true);
    logError("Record", message);
    return;
  }

  audioChunks = [];
  recordedBlob = null;
  selectedFile = null;

  const preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  recordedFormat = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";

  mediaRecorder = mimeType
    ? new MediaRecorder(recordStream, { mimeType })
    : new MediaRecorder(recordStream);

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) audioChunks.push(event.data);
  });

  mediaRecorder.addEventListener("stop", () => {
    if (recordStream) {
      recordStream.getTracks().forEach((track) => track.stop());
      recordStream = null;
    }

    if (!audioChunks.length) {
      mediaRecorder = null;
      setRecordStatus("No audio captured. Try recording again.");
      return;
    }

    const blobType = mimeType || "audio/webm";
    const rawBlob = new Blob(audioChunks, { type: blobType });
    audioChunks = [];
    mediaRecorder = null;
    void finalizeRecording(rawBlob, recordedFormat);
  });

  mediaRecorder.start();
  btnRecord.textContent = "Stop recording";
  btnRecord.classList.add("is-recording");
  setRecordStatus("Recording… tap Stop when finished.");
  setStatus("Recording in progress…");

  recordTimer = setTimeout(() => {
    if (mediaRecorder?.state === "recording") {
      void stopRecording({ timedOut: true });
    }
  }, MAX_RECORD_MS);
}

async function stopRecording({ timedOut = false } = {}) {
  if (recordTimer) {
    clearTimeout(recordTimer);
    recordTimer = null;
  }

  if (mediaRecorder?.state !== "recording") {
    return;
  }

  mediaRecorder.stop();

  try {
    await waitForRecordedBlob();
    setStatus(
      timedOut
        ? "Time limit reached — recording saved. Click Transcribe."
        : "Recording saved. Click Transcribe."
    );
  } catch (err) {
    const message = err.message || "No audio captured. Try recording again.";
    setStatus(message, true);
    logError("Record", message);
  }
}

async function toggleRecording() {
  if (busy) return;

  if (mediaRecorder?.state === "recording") {
    await stopRecording();
    return;
  }

  await startRecording();
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
  const configured = await loadOpenRouterConfig();
  if (!requireOpenRouterConfig(configured)) return;

  const model = modelInput.value.trim() || DEFAULT_MODEL;

  setBusy(true);
  setStatus("Testing API with text-only request…");
  output.value = "";

  try {
    const result = await postJson("/api/transcribe/test", { model });
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
  const configured = await loadOpenRouterConfig();
  if (!requireOpenRouterConfig(configured)) return;

  const model = modelInput.value.trim() || DEFAULT_MODEL;

  if (mediaRecorder?.state === "recording") {
    await stopRecording();
  }

  if (!selectedFile) {
    const message = "Record audio first.";
    setStatus(message, true);
    logError("Transcribe", message);
    return;
  }

  setBusy(true);
  setStatus("Transcribing and reviewing pronunciation…");
  output.value = "";

  const formData = new FormData();
  formData.append("audio", selectedFile);
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

btnRecord.addEventListener("click", () => {
  void toggleRecording();
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
void loadOpenRouterConfig();
