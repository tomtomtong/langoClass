const { normalizeBaseUrl } = require("./video-generator");

async function parseJsonResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || res.statusText };
  }

  if (!res.ok) {
    const message =
      data?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      data?.error?.message ||
      text ||
      `Router image API returned ${res.status}.`;
    throw new Error(message);
  }

  return data;
}

async function generateImage(baseUrl, prompt) {
  const trimmed = String(prompt || "").trim();
  if (!trimmed) {
    throw new Error("prompt is required.");
  }

  const root = normalizeBaseUrl(baseUrl);
  if (!root) {
    throw new Error("Router API URL is not configured.");
  }

  const res = await fetch(`${root}/api/router/image`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: trimmed }),
  });

  const data = await parseJsonResponse(res);
  const image = String(data?.image || "").trim();
  if (!image) {
    throw new Error("Router image API did not return an image.");
  }

  return { image };
}

module.exports = {
  generateImage,
};
