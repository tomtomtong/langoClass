const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const videoCaptions = require("./video-captions");
const { convertHeicToJpeg } = require("./heic-to-jpeg");

const MAX_MATERIAL_CHARS = 12000;
const MIN_PDF_TEXT_CHARS = 80;
const MAX_PDF_OCR_PAGES = 12;
const PDF_TEXT_TIMEOUT_MS = 20000;
const PDF_OCR_SCREENSHOT_SCALE = 1.5;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".docx", ".pptx", ".vtt"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac", ".aac"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"]);
const SUPPORTED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateMaterial(text, maxChars = MAX_MATERIAL_CHARS) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false, originalLength: normalized.length };
  }
  return {
    text: `${normalized.slice(0, maxChars).trim()}\n\n[…truncated for generation]`,
    truncated: true,
    originalLength: normalized.length,
  };
}

function extensionFromName(filename) {
  return path.extname(String(filename || "")).toLowerCase();
}

function isAudioExtension(ext) {
  return AUDIO_EXTENSIONS.has(ext);
}

function isImageExtension(ext) {
  return IMAGE_EXTENSIONS.has(ext);
}

function isVideoExtension(ext) {
  return VIDEO_EXTENSIONS.has(ext);
}

function isVideoFormat(format, mimetype) {
  const mime = String(mimetype || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  if (mime.startsWith("audio/")) return false;
  return VIDEO_EXTENSIONS.has(`.${String(format || "").toLowerCase()}`);
}

function isAudioFormat(format, mimetype) {
  const mime = String(mimetype || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  if (isVideoFormat(format, mimetype)) return false;
  return AUDIO_EXTENSIONS.has(`.${String(format || "").toLowerCase()}`);
}

function isImageFormat(format) {
  return IMAGE_EXTENSIONS.has(`.${String(format || "").toLowerCase()}`);
}

function isHeicLikeFormat(format, mimetype) {
  const normalized = String(format || "").toLowerCase();
  const mime = String(mimetype || "").toLowerCase();
  return (
    normalized === "heic" ||
    normalized === "heif" ||
    mime.includes("heic") ||
    mime.includes("heif")
  );
}

function imageMimeFromFormat(format, fallbackMime) {
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
  };
  const normalized = String(format || "").toLowerCase();
  if (map[normalized]) return map[normalized];
  const mime = String(fallbackMime || "").toLowerCase();
  if (mime.startsWith("image/")) return mime;
  return "image/jpeg";
}

function detectFormat(filename, mimetype) {
  const ext = extensionFromName(filename);
  if (SUPPORTED_EXTENSIONS.has(ext)) return ext.slice(1);
  const mime = String(mimetype || "").toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("wordprocessingml") || mime.includes("msword")) return "docx";
  if (mime.includes("presentationml")) return "pptx";
  if (mime.includes("text/plain")) return "txt";
  if (mime.includes("webvtt")) return "vtt";
  if (mime.startsWith("video/")) return ext.slice(1) || "mp4";
  if (mime.startsWith("audio/")) return ext.slice(1) || "mp3";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  if (mime.startsWith("image/")) return ext.slice(1) || "jpeg";
  return ext ? ext.slice(1) : "txt";
}

function formatVideoMarkdown(transcript, filename) {
  const baseName = path.basename(String(filename || "video"), path.extname(String(filename || "")));
  const title = baseName || "Video transcript";
  return normalizeWhitespace(`## ${title}\n\n${String(transcript || "").trim()}`);
}

function formatAudioMarkdown(transcript, filename) {
  const baseName = path.basename(String(filename || "audio"), path.extname(String(filename || "")));
  const title = baseName || "Audio transcript";
  return normalizeWhitespace(`## ${title}\n\n${String(transcript || "").trim()}`);
}

async function destroyPdfParser(parser) {
  if (parser && typeof parser.destroy === "function") {
    try {
      await parser.destroy();
    } catch {
      /* ignore parser cleanup failures */
    }
  }
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await Promise.race([
      parser.getText(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("PDF text extraction timed out")), PDF_TEXT_TIMEOUT_MS);
      }),
    ]);
    const pages = Array.isArray(result?.pages) ? result.pages : [];
    if (pages.length) {
      return pages
        .map((page, index) => `## Page ${index + 1}\n\n${normalizeWhitespace(page?.text || "")}`)
        .filter((block) => block.trim().length > 10)
        .join("\n\n");
    }
    return normalizeWhitespace(result?.text || "");
  } finally {
    await destroyPdfParser(parser);
  }
}

function screenshotMime(pageBuffer) {
  if (pageBuffer?.[0] === 0xff && pageBuffer?.[1] === 0xd8) return "image/jpeg";
  if (pageBuffer?.[0] === 0x89 && pageBuffer?.[1] === 0x50) return "image/png";
  return "image/png";
}

function isOpenRouterConfigError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("configure openrouter") ||
    text.includes("openrouter in config") ||
    text.includes("authorization") ||
    text.includes("invalid api key") ||
    text.includes("user not found")
  );
}

async function extractPdfViaVisionOcr(buffer, describeImage, filename) {
  if (typeof describeImage !== "function") {
    return { markdown: "", pageCount: 0, pagesProcessed: 0, errors: ["Vision OCR is not configured."] };
  }

  const parser = new PDFParse({ data: buffer });
  let shots;
  try {
    shots = await parser.getScreenshot({
      imageBuffer: true,
      imageDataUrl: false,
      scale: PDF_OCR_SCREENSHOT_SCALE,
      first: MAX_PDF_OCR_PAGES,
    });
  } finally {
    await destroyPdfParser(parser);
  }

  const pages = shots?.pages || [];
  const blocks = [];
  const errors = [];
  for (const page of pages) {
    if (!page?.data?.length) continue;
    const pageBuffer = Buffer.from(page.data);
    if (pageBuffer.length > 10 * 1024 * 1024) continue;
    const pageLabel = `${filename || "document"} · page ${page.pageNumber}`;
    try {
      const markdown = await describeImage(pageBuffer, screenshotMime(pageBuffer), pageLabel);
      const normalized = normalizeWhitespace(markdown);
      if (normalized) {
        blocks.push(`## Page ${page.pageNumber}\n\n${normalized}`);
      } else {
        errors.push(`${pageLabel}: empty OCR result`);
      }
    } catch (err) {
      const message = err?.message || String(err);
      if (isOpenRouterConfigError(message)) {
        throw err;
      }
      errors.push(`${pageLabel}: ${message}`);
      console.warn(`PDF OCR failed for ${pageLabel}:`, message);
    }
  }

  return {
    markdown: blocks.join("\n\n"),
    pageCount: pages.length,
    pagesProcessed: blocks.length,
    errors,
  };
}

async function extractPdf(buffer, services = {}) {
  const textMarkdown = await extractPdfText(buffer);
  if (textMarkdown.length >= MIN_PDF_TEXT_CHARS) {
    return { text: textMarkdown, method: "text", pageCount: 0, pagesProcessed: 0 };
  }

  if (typeof services.describeImage !== "function") {
    throw new Error(
      `No readable text found in ${services.filename || "this PDF"}. This looks like a scanned/image PDF — configure OpenRouter and a vision model in Config.`
    );
  }
  if (services.hasVisionApi === false) {
    throw new Error(
      `No readable text found in ${services.filename || "this PDF"}. This looks like a scanned/image PDF — add your OpenRouter API key in Config, then try again.`
    );
  }

  const ocrResult = await extractPdfViaVisionOcr(buffer, services.describeImage, services.filename);
  if (ocrResult.markdown) {
    return {
      text: ocrResult.markdown,
      method: "ocr",
      pageCount: ocrResult.pageCount,
      pagesProcessed: ocrResult.pagesProcessed,
    };
  }

  if (ocrResult.errors.length) {
    throw new Error(
      `Could not read ${services.filename || "this PDF"} with vision OCR. ${ocrResult.errors[0]}`
    );
  }

  throw new Error(`No readable text found in ${services.filename || "this PDF"}.`);
}

async function extractDocx(buffer) {
  const result = await mammoth.convertToMarkdown({ buffer });
  return normalizeWhitespace(result.value || "");
}

function extractPptx(buffer) {
  const zip = new AdmZip(buffer);
  const slideEntries = zip
    .getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
    .sort((a, b) => {
      const numA = Number(a.entryName.match(/slide(\d+)/i)?.[1] || 0);
      const numB = Number(b.entryName.match(/slide(\d+)/i)?.[1] || 0);
      return numA - numB;
    });

  const slides = slideEntries.map((entry, index) => {
    const xml = entry.getData().toString("utf8");
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map((match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
      .map((line) => line.trim())
      .filter(Boolean);
    if (!texts.length) return "";
    return `## Slide ${index + 1}\n\n${texts.join("\n")}`;
  });

  return normalizeWhitespace(slides.filter(Boolean).join("\n\n"));
}

function extractVtt(text) {
  const cues = videoCaptions.parseWebVtt(text);
  return normalizeWhitespace(cues.map((cue) => cue.text).join("\n"));
}

function extractPlainText(text) {
  return normalizeWhitespace(text);
}

async function extractFromBuffer(buffer, filename, mimetype, services = {}) {
  const format = detectFormat(filename, mimetype);
  let markdown = "";
  let extractionMethod = format;
  let pageCount = 0;
  let pagesProcessed = 0;

  if (isVideoFormat(format, mimetype)) {
    if (typeof services.transcribeVideo !== "function") {
      throw new Error("Video transcription is not configured on the server.");
    }
    const transcript = await services.transcribeVideo(buffer, filename, mimetype, services.language);
    markdown = formatVideoMarkdown(transcript, filename);
  } else if (isAudioFormat(format, mimetype)) {
    if (typeof services.transcribeAudio !== "function") {
      throw new Error("Audio transcription is not configured on the server.");
    }
    const transcript = await services.transcribeAudio(buffer, format, services.language);
    markdown = formatAudioMarkdown(transcript, filename);
  } else if (isImageFormat(format)) {
    if (typeof services.describeImage !== "function") {
      throw new Error("Image conversion requires OpenRouter vision in Config.");
    }
    let imageBuffer = buffer;
    let mime = imageMimeFromFormat(format, mimetype);
    if (isHeicLikeFormat(format, mimetype)) {
      try {
        const converted = await convertHeicToJpeg(buffer);
        imageBuffer = converted.buffer;
        mime = converted.mime;
        extractionMethod = `heic-jpeg-${converted.method || "unknown"}`;
        // #region agent log
        try {
          fs.appendFileSync(
            path.join(__dirname, "..", ".cursor", "debug-d0607f.log"),
            `${JSON.stringify({
              sessionId: "d0607f",
              runId: "heic-support",
              hypothesisId: "H-HEIC",
              location: "material-extract.js:extractFromBuffer",
              message: "HEIC image converted to JPEG for vision",
              data: {
                filename: filename || "",
                method: converted.method || "",
                inputBytes: buffer?.length || 0,
                outputBytes: imageBuffer?.length || 0,
              },
              timestamp: Date.now(),
            })}\n`
          );
        } catch {}
        // #endregion
      } catch (err) {
        throw new Error(
          `Could not read ${filename || "HEIC image"}. Try exporting it as JPG from Photos, or upload a .jpg/.png instead. (${err.message || err})`
        );
      }
    }
    markdown = await services.describeImage(imageBuffer, mime, filename);
  } else {
    switch (format) {
      case "pdf": {
        const pdfResult = await extractPdf(buffer, {
          describeImage: services.describeImage,
          filename,
          hasVisionApi: services.hasVisionApi,
        });
        markdown = pdfResult.text;
        extractionMethod = pdfResult.method === "ocr" ? "pdf-ocr" : "pdf-text";
        pageCount = pdfResult.pageCount || 0;
        pagesProcessed = pdfResult.pagesProcessed || 0;
        break;
      }
      case "docx":
        markdown = await extractDocx(buffer);
        break;
      case "pptx":
        markdown = extractPptx(buffer);
        break;
      case "vtt":
        markdown = extractVtt(buffer.toString("utf8"));
        break;
      default:
        markdown = extractPlainText(buffer.toString("utf8"));
        break;
    }
  }

  if (!markdown) {
    if (format === "pdf" && typeof services.describeImage !== "function") {
      throw new Error(
        `No readable text found in ${filename || "this file"}. This PDF may be image-based—configure OpenRouter and a vision model in Config.`
      );
    }
    throw new Error(`No readable text found in ${filename || "this file"}.`);
  }

  const maxChars = Number(services.maxChars);
  const truncated = truncateMaterial(
    markdown,
    Number.isFinite(maxChars) && maxChars > 0 ? maxChars : MAX_MATERIAL_CHARS
  );
  return {
    format,
    filename: filename || "",
    extractionMethod,
    pageCount,
    pagesProcessed,
    ...truncated,
  };
}

async function extractFromFilePath(filePath) {
  const buffer = fs.readFileSync(filePath);
  return extractFromBuffer(buffer, path.basename(filePath));
}

function vttFileToText(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const markdown = extractVtt(text);
  if (!markdown) throw new Error("Caption file has no readable text.");
  return truncateMaterial(markdown);
}

module.exports = {
  MAX_MATERIAL_CHARS,
  TEXT_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  normalizeWhitespace,
  truncateMaterial,
  detectFormat,
  isAudioFormat,
  isImageFormat,
  isVideoFormat,
  isHeicLikeFormat,
  imageMimeFromFormat,
  formatAudioMarkdown,
  formatVideoMarkdown,
  extractFromBuffer,
  extractFromFilePath,
  vttFileToText,
  extractVtt,
  extractPdf,
  extractPdfViaVisionOcr,
};
