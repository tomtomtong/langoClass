async function convertHeicToJpeg(buffer) {
  if (!buffer?.length) throw new Error("Empty HEIC image.");
  try {
    const convert = require("heic-convert");
    const output = await convert({ buffer, format: "JPEG", quality: 0.9 });
    const jpeg = Buffer.from(output);
    if (!jpeg.length) throw new Error("HEIC conversion returned empty output.");
    return jpeg;
  } catch (heicErr) {
    try {
      const sharp = require("sharp");
      return sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
    } catch {
      throw heicErr;
    }
  }
}

module.exports = { convertHeicToJpeg };
