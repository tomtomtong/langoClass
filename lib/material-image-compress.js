const path = require("path");
const { convertHeicToJpeg } = require("./heic-to-jpeg");

async function compressMaterialImageBuffer(buffer, maxBytes, { mimeType = "", filename = "" } = {}) {
  if (!buffer?.length || buffer.length <= maxBytes) {
    return { buffer, mime: mimeType || "image/jpeg", compressed: false };
  }

  const ext = path.extname(String(filename || "")).toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  let working = buffer;
  let workingMime = mime || "image/jpeg";

  if (ext === ".heic" || ext === ".heif" || mime.includes("heic") || mime.includes("heif")) {
    const converted = await convertHeicToJpeg(buffer);
    working = converted.buffer;
    workingMime = converted.mime;
    if (working.length <= maxBytes) {
      return { buffer: working, mime: workingMime, compressed: true };
    }
  }

  const sharp = require("sharp");
  let meta = await sharp(working).metadata();
  let longestEdge = Math.max(meta.width || 0, meta.height || 0) || 4096;
  let quality = 82;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const scale = longestEdge > 4096 ? 4096 / longestEdge : 1;
    const width =
      meta.width && meta.height
        ? Math.max(1, Math.round(meta.width * scale))
        : undefined;
    const height =
      meta.width && meta.height
        ? Math.max(1, Math.round(meta.height * scale))
        : undefined;

    const out = await sharp(working)
      .rotate()
      .resize(width, height, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (out.length <= maxBytes) {
      return { buffer: out, mime: "image/jpeg", compressed: true };
    }

    if (quality > 44) {
      quality -= 8;
      continue;
    }
    if (longestEdge > 960) {
      longestEdge = Math.round(longestEdge * 0.68);
      meta = {
        width: Math.max(1, Math.round((meta.width || longestEdge) * 0.75)),
        height: Math.max(1, Math.round((meta.height || longestEdge) * 0.75)),
      };
      quality = 82;
      continue;
    }
    break;
  }

  throw new Error(
    `Image is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB) even after compression. Try a smaller image.`
  );
}

module.exports = {
  compressMaterialImageBuffer,
};
