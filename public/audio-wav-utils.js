/** Convert browser microphone input to 16 kHz mono WAV for STT APIs. */

const STT_TARGET_SAMPLE_RATE = 16000;
const BUZZIN_PCM_BUFFER_SIZE = 4096;

function mergeFloat32Arrays(chunks) {
  if (!chunks.length) return new Float32Array(0);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function getBuzzinMicrophoneStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone recording is not supported in this browser.");
  }

  const preferred = {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: { ideal: 48000 },
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: preferred });
  } catch {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }
}

function createBuzzinPcmRecorder() {
  let stream = null;
  let audioContext = null;
  let source = null;
  let processor = null;
  let silentGain = null;
  let chunks = [];
  let recording = false;

  async function start() {
    stopTracks();
    closeAudioGraph();

    stream = await getBuzzinMicrophoneStream();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This browser cannot record audio for speech-to-text.");
    }

    audioContext = new AudioContextCtor();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    source = audioContext.createMediaStreamSource(stream);
    const inputChannels = Math.min(2, source.channelCount || 1);
    processor = audioContext.createScriptProcessor(BUZZIN_PCM_BUFFER_SIZE, inputChannels, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    chunks = [];
    recording = true;

    processor.onaudioprocess = (event) => {
      if (!recording) return;
      const input = event.inputBuffer;
      const length = input.length;
      const mono = new Float32Array(length);
      if (input.numberOfChannels === 1) {
        mono.set(input.getChannelData(0));
      } else {
        for (let i = 0; i < length; i += 1) {
          let sum = 0;
          for (let ch = 0; ch < input.numberOfChannels; ch += 1) {
            sum += input.getChannelData(ch)[i];
          }
          mono[i] = sum / input.numberOfChannels;
        }
      }
      chunks.push(mono);
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
  }

  function stopTracks() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  function closeAudioGraph() {
    recording = false;
    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
      processor = null;
    }
    if (source) {
      source.disconnect();
      source = null;
    }
    if (silentGain) {
      silentGain.disconnect();
      silentGain = null;
    }
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }
  }

  async function stop() {
    if (!audioContext) {
      throw new Error("No audio captured. Try recording again.");
    }

    recording = false;
    const captureRate = audioContext.sampleRate;
    const merged = mergeFloat32Arrays(chunks);
    chunks = [];
    closeAudioGraph();
    stopTracks();

    if (!merged.length) {
      throw new Error("No audio captured. Try recording again.");
    }

    const resampled = resampleMonoFloat32(merged, captureRate, STT_TARGET_SAMPLE_RATE);
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const encodeContext = new AudioContextCtor();
    try {
      const prepared = float32MonoToAudioBuffer(
        encodeContext,
        resampled,
        STT_TARGET_SAMPLE_RATE
      );
      return new Blob([audioBufferToWavArrayBuffer(prepared)], { type: "audio/wav" });
    } finally {
      await encodeContext.close();
    }
  }

  function cancel() {
    recording = false;
    chunks = [];
    closeAudioGraph();
    stopTracks();
  }

  function isRecording() {
    return recording;
  }

  return { start, stop, cancel, isRecording };
}

function audioBufferToMonoFloat32(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  if (channels === 1) {
    return audioBuffer.getChannelData(0).slice();
  }

  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

function resampleMonoFloat32(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }
  return output;
}

function float32MonoToAudioBuffer(audioContext, samples, sampleRate) {
  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

function prepareAudioBufferForStt(audioBuffer, audioContext, sampleRate = STT_TARGET_SAMPLE_RATE) {
  const mono = audioBufferToMonoFloat32(audioBuffer);
  const resampled = resampleMonoFloat32(mono, audioBuffer.sampleRate, sampleRate);
  return float32MonoToAudioBuffer(audioContext, resampled, sampleRate);
}

function audioBufferToWavArrayBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;
  const samples = audioBuffer.length;
  const blockAlign = (numChannels * bitDepth) / 8;
  const dataSize = samples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let i = 0; i < numChannels; i += 1) {
    channels.push(audioBuffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < samples; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return buffer;
}

async function blobToWavBlob(blob, { sampleRate = STT_TARGET_SAMPLE_RATE } = {}) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("This browser cannot convert audio to WAV.");
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const prepared = prepareAudioBufferForStt(decoded, audioContext, sampleRate);
    const wavBuffer = audioBufferToWavArrayBuffer(prepared);
    return new Blob([wavBuffer], { type: "audio/wav" });
  } finally {
    await audioContext.close();
  }
}

async function blobToWavBase64(blob) {
  if (blob?.type === "audio/wav") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error("Could not read WAV recording."));
      reader.readAsDataURL(blob);
    });
  }

  const wavBlob = await blobToWavBlob(blob);
  return blobToWavBase64(wavBlob);
}
