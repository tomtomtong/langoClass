function mediaBase() {
  return String(process.env.MEDIA_URL || "").replace(/\/$/, "");
}

async function mediaRequest(pathname, buffer, contentType, extraHeaders) {
  const base = mediaBase();
  if (!base) return null;
  const headers = { "content-type": contentType || "application/octet-stream" };
  for (const [key, value] of Object.entries(extraHeaders || {})) {
    if (value != null) headers[key] = String(value);
  }
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers,
    body: buffer,
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Media container failed (${response.status}).`);
  }
  return response;
}

async function mediaBuffer(pathname, buffer, contentType, extraHeaders) {
  const response = await mediaRequest(pathname, buffer, contentType, extraHeaders);
  if (!response) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function mediaJson(pathname, buffer, contentType, extraHeaders) {
  const response = await mediaRequest(pathname, buffer, contentType, extraHeaders);
  if (!response) return null;
  return response.json();
}

module.exports = {
  mediaRequest,
  mediaBuffer,
  mediaJson,
};
