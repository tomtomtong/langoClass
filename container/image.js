// Re-encodes a picture as JPEG for material assets; tiny images are skipped.
const MIN_IMAGE_DIMENSION = 72;

async function normalizeImage(buffer) {
  const sharp = require("sharp");
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return { jpeg: null };
    if (meta.width < MIN_IMAGE_DIMENSION && meta.height < MIN_IMAGE_DIMENSION) return { jpeg: null };
    const jpeg = await sharp(buffer).rotate().jpeg({ quality: 88 }).toBuffer();
    return { jpeg: jpeg.toString("base64"), width: meta.width, height: meta.height };
  } catch {
    return { jpeg: null };
  }
}

module.exports = { MIN_IMAGE_DIMENSION, normalizeImage };
