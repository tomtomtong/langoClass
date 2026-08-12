const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const courseImport = require("./course-import");
const paths = require("./paths");

const IMPORT_CHUNK_BYTES = 512 * 1024;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** @type {Map<string, object>} */
const sessions = new Map();

function importsTmpRoot() {
  const dir = path.join(paths.dataDir, "import-tmp");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function cleanupSession(uploadId) {
  const session = sessions.get(uploadId);
  if (!session) return;
  if (session.timeout) clearTimeout(session.timeout);
  sessions.delete(uploadId);
  try {
    fs.rmSync(session.dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function createSession(teacherId, totalBytes, totalChunks, fileName) {
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) {
    throw new Error("Invalid totalBytes.");
  }
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    throw new Error("Invalid totalChunks.");
  }
  if (totalBytes > courseImport.MAX_ZIP_BYTES) {
    throw new Error(`ZIP file is too large (max ${courseImport.MAX_ZIP_BYTES / 1024 / 1024}MB).`);
  }

  const uploadId = crypto.randomBytes(16).toString("hex");
  const dir = path.join(importsTmpRoot(), uploadId);
  fs.mkdirSync(dir, { recursive: true });

  const session = {
    uploadId,
    teacherId,
    totalBytes,
    totalChunks,
    fileName: String(fileName || "import.zip"),
    received: new Set(),
    dir,
    timeout: setTimeout(() => cleanupSession(uploadId), SESSION_TTL_MS),
  };
  sessions.set(uploadId, session);

  return { uploadId, chunkSize: IMPORT_CHUNK_BYTES };
}

function getSession(uploadId, teacherId) {
  const session = sessions.get(String(uploadId || ""));
  if (!session || session.teacherId !== teacherId) {
    throw new Error("Upload session not found or expired.");
  }
  return session;
}

function writeChunk(uploadId, teacherId, chunkIndex, buffer) {
  const session = getSession(uploadId, teacherId);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw new Error("Invalid chunk index.");
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Empty chunk.");
  }

  const chunkPath = path.join(session.dir, `chunk-${chunkIndex}`);
  fs.writeFileSync(chunkPath, buffer);
  session.received.add(chunkIndex);

  return {
    received: session.received.size,
    totalChunks: session.totalChunks,
  };
}

function assembleBuffer(session) {
  const parts = [];
  for (let i = 0; i < session.totalChunks; i++) {
    const chunkPath = path.join(session.dir, `chunk-${i}`);
    if (!fs.existsSync(chunkPath)) {
      throw new Error(`Missing chunk ${i + 1} of ${session.totalChunks}.`);
    }
    parts.push(fs.readFileSync(chunkPath));
  }

  const buffer = Buffer.concat(parts);
  if (buffer.length !== session.totalBytes) {
    throw new Error("Uploaded size does not match expected size.");
  }
  return buffer;
}

function completeSession(uploadId, teacherId) {
  const session = getSession(uploadId, teacherId);
  if (session.received.size !== session.totalChunks) {
    throw new Error(`Missing chunks (${session.received.size}/${session.totalChunks}).`);
  }

  const buffer = assembleBuffer(session);
  cleanupSession(uploadId);
  return courseImport.importCoursesFromZip(buffer, teacherId, { replace: true });
}

module.exports = {
  IMPORT_CHUNK_BYTES,
  createSession,
  writeChunk,
  completeSession,
  cleanupSession,
};
