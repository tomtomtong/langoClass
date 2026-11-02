// Join URLs and the waiting-room QR code the host page shows, as server.js
// /api/network-urls and /api/room-qr.svg served them. The Worker has no LAN
// address, so students always join through the public site.
import QRCode from "qrcode/lib/core/qrcode.js";
import SvgTag from "qrcode/lib/renderer/svg-tag.js";

export function handleJoinLinks(request, env, url) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  if (url.pathname === "/api/network-urls") return networkUrls(env, url);
  if (url.pathname === "/api/room-qr.svg") return roomQr(url);
  return null;
}

function networkUrls(env, url) {
  const configured = String(env?.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  return Response.json({
    port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
    addresses: [],
    publicBaseUrl: configured || url.origin,
    configuredPublicBaseUrl: configured,
  });
}

function roomQr(url) {
  const target = String(url.searchParams.get("url") || "").trim();
  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response("Valid http(s) url is required.", { status: 400 });
  }
  let svg;
  try {
    const options = { margin: 1, width: 200, color: { dark: "#1f2937", light: "#ffffff" } };
    svg = SvgTag.render(QRCode.create(target, options), options);
  } catch {
    return new Response("Could not generate QR code.", { status: 400 });
  }
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=300" },
  });
}
