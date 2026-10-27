// HTTP API routes from server.js, in Express registration order.
// The Worker matches these paths. Courses, community, course files, imports,
// exports, scores, and host progress are handled in the Worker on D1 and R2
// (see d1-api.js); the rest still run on the Node origin.

export const API_ROUTES = [
  { method: "GET", path: "/api/config" },
  { method: "PUT", path: "/api/config" },
  { method: "POST", path: "/api/config/test-gameplay-tts" },
  { method: "POST", path: "/api/config/test-inworld" },
  { method: "POST", path: "/api/config/test-qwen" },
  { method: "POST", path: "/api/config/test-azure" },
  { method: "POST", path: "/api/config/test-openrouter" },
  { method: "POST", path: "/api/config/clear-student-database" },
  { method: "POST", path: "/api/transcribe/test" },
  { method: "POST", path: "/api/transcribe/audio" },
  { method: "POST", path: "/api/llm" },
  { method: "POST", path: "/api/tts" },
  { method: "POST", path: "/api/stt" },
  { method: "POST", path: "/api/lango/login" },
  { method: "GET", path: "/api/lango/classList" },
  { method: "GET", path: "/api/lango/classStudents" },
  { method: "GET", path: "/api/cms/app-context" },
  { method: "GET", path: "/api/cms/courses" },
  { method: "GET", path: "/api/cms/community/courses" },
  { method: "GET", path: "/api/cms/community/courses/:listingId" },
  { method: "POST", path: "/api/cms/community/courses/:listingId/copy" },
  { method: "POST", path: "/api/cms/community/courses/:listingId/report" },
  { method: "POST", path: "/api/cms/community/courses/:listingId/unpublish" },
  { method: "POST", path: "/api/cms/community/courses/:listingId/feature" },
  { method: "POST", path: "/api/cms/courses/:courseId/community/publish" },
  { method: "POST", path: "/api/cms/courses/:courseId/community/unpublish" },
  { method: "GET", path: "/api/cms/dashboard/progress" },
  { method: "GET", path: "/api/cms/courses/export-all" },
  { method: "POST", path: "/api/cms/courses/import-all/init" },
  { method: "POST", path: "/api/cms/courses/import-all/chunk" },
  { method: "POST", path: "/api/cms/courses/import-all/complete" },
  { method: "POST", path: "/api/cms/courses/import-one/init" },
  { method: "POST", path: "/api/cms/courses/import-one/chunk" },
  { method: "POST", path: "/api/cms/courses/import-one/complete" },
  { method: "POST", path: "/api/cms/courses/import-one" },
  { method: "POST", path: "/api/cms/courses/import-all" },
  { method: "POST", path: "/api/cms/courses" },
  { method: "GET", path: "/api/cms/courses/:courseId" },
  { method: "GET", path: "/api/cms/courses/:courseId/export" },
  { method: "PUT", path: "/api/cms/courses/:courseId" },
  { method: "PUT", path: "/api/cms/courses/:courseId/sections" },
  { method: "POST", path: "/api/cms/courses/:courseId/sections/:sectionId/banner" },
  { method: "POST", path: "/api/cms/question-image" },
  { method: "POST", path: "/api/cms/courses/:courseId/question-image" },
  { method: "POST", path: "/api/cms/question-image/generate" },
  { method: "POST", path: "/api/cms/section-banner/generate" },
  { method: "POST", path: "/api/cms/generate-video" },
  { method: "GET", path: "/api/cms/video-jobs/:jobId" },
  { method: "POST", path: "/api/video" },
  { method: "GET", path: "/api/video/:jobId" },
  { method: "POST", path: "/api/cms/generate-video-captions" },
  { method: "POST", path: "/api/cms/upload-video-captions" },
  { method: "GET", path: "/api/cms/video-captions" },
  { method: "PUT", path: "/api/cms/video-captions" },
  { method: "POST", path: "/api/cms/compress-material-video" },
  { method: "POST", path: "/api/cms/extract-material" },
  { method: "POST", path: "/api/cms/prefetch-question-tts" },
  { method: "GET", path: "/api/cms/question-tts/:cacheKey" },
  { method: "POST", path: "/api/cms/generate-exercises" },
  { method: "POST", path: "/api/cms/revise-exercises" },
  { method: "POST", path: "/api/cms/assistant" },
  { method: "POST", path: "/api/cms/batch-generate-exercises" },
  { method: "POST", path: "/api/cms/analyze-course-material" },
  { method: "POST", path: "/api/cms/generate-course-from-plan" },
  { method: "POST", path: "/api/cms/import-exercises-json" },
  { method: "POST", path: "/api/cms/export-exercises-json" },
  { method: "POST", path: "/api/cms/translate-video-captions" },
  { method: "POST", path: "/api/cms/courses/:courseId/banner" },
  { method: "POST", path: "/api/cms/courses/:courseId/sections/:sectionId/intro-video" },
  { method: "DELETE", path: "/api/cms/courses/:courseId" },
  { method: "POST", path: "/api/session/start" },
  { method: "PUT", path: "/api/session/roster" },
  { method: "POST", path: "/api/session/end" },
  { method: "GET", path: "/api/host/progress" },
  { method: "PUT", path: "/api/host/progress" },
  { method: "GET", path: "/api/scores" },
  { method: "POST", path: "/api/logs/login" },
  { method: "POST", path: "/api/logs/logout" },
  { method: "GET", path: "/api/logs/categories" },
  { method: "GET", path: "/api/logs/stats" },
  { method: "GET", path: "/api/logs" },
  { method: "GET", path: "/api/logs/debug-files" },
  { method: "DELETE", path: "/api/logs" },
  { method: "GET", path: "/api/network-urls" },
  { method: "GET", path: "/api/join/lookup" },
  { method: "GET", path: "/api/room-qr.svg" },
];

function compile(path) {
  const body = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${body}/?$`);
}

const compiled = API_ROUTES.map((route) => ({
  ...route,
  regex: compile(route.path),
}));

export function matchApiRoute(method, pathname) {
  const lookup = String(method || "").toUpperCase() === "HEAD" ? "GET" : String(method || "").toUpperCase();
  return compiled.find((route) => route.method === lookup && route.regex.test(pathname)) || null;
}
