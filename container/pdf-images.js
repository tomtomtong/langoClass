// Pictures embedded in the first pages of a PDF, run in a worker thread so a
// heavy PDF cannot block the server and can be stopped when it takes too long
// (server.js pdfImages).
const { parentPort, workerData } = require("worker_threads");
const { PDFParse } = require("pdf-parse");
const { MIN_IMAGE_DIMENSION, normalizeImage } = require("./image");

async function pdfImages(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getImage({
      imageBuffer: true,
      imageDataUrl: false,
      imageThreshold: MIN_IMAGE_DIMENSION,
      first: 30,
    });
    const images = [];
    for (const page of result?.pages || []) {
      for (const image of page.images || []) {
        if (!image?.data?.length) continue;
        const normalized = await normalizeImage(Buffer.from(image.data));
        if (!normalized.jpeg) continue;
        images.push({
          pageNumber: page.pageNumber,
          name: image.name || "",
          width: normalized.width,
          height: normalized.height,
          jpeg: normalized.jpeg,
        });
        if (images.length >= 40) return images;
      }
    }
    return images;
  } finally {
    await parser.destroy?.();
  }
}

pdfImages(Buffer.from(workerData))
  .then((images) => parentPort.postMessage({ images }))
  .catch((error) => parentPort.postMessage({ error: String(error?.message || error) }));
