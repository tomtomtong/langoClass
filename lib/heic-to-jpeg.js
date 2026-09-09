const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

async function convertHeicWithSips(buffer) {
  if (process.platform !== "darwin") return null;
  const id = `heic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(os.tmpdir(), `${id}.heic`);
  const outputPath = path.join(os.tmpdir(), `${id}.jpg`);
  try {
    fs.writeFileSync(inputPath, buffer);
    await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", inputPath, "--out", outputPath]);
    const jpeg = fs.readFileSync(outputPath);
    return jpeg.length ? jpeg : null;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(inputPath);
    } catch {}
    try {
      fs.unlinkSync(outputPath);
    } catch {}
  }
}

async function convertHeicWithHeicConvert(buffer) {
  const convert = require("heic-convert");
  const output = await convert({ buffer, format: "JPEG", quality: 0.9 });
  const jpeg = Buffer.from(output);
  if (!jpeg.length) throw new Error("HEIC conversion returned empty output.");
  return jpeg;
}

async function convertHeicWithSharp(buffer) {
  const sharp = require("sharp");
  return sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
}

async function convertHeicToJpeg(buffer) {
  if (!buffer?.length) throw new Error("Empty HEIC image.");

  const sipsResult = await convertHeicWithSips(buffer);
  if (sipsResult) {
    return { buffer: sipsResult, mime: "image/jpeg", method: "sips" };
  }

  try {
    const jpeg = await convertHeicWithHeicConvert(buffer);
    return { buffer: jpeg, mime: "image/jpeg", method: "heic-convert" };
  } catch (heicConvertErr) {
    try {
      const jpeg = await convertHeicWithSharp(buffer);
      return { buffer: jpeg, mime: "image/jpeg", method: "sharp" };
    } catch {
      throw heicConvertErr;
    }
  }
}

module.exports = {
  convertHeicToJpeg,
};
