const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const paths = require("./paths");
const cmsStore = require("./cms-store");

const DATA_FILE = paths.communityCoursesFile;
const REPORT_HIDE_THRESHOLD = 3;

function ensureDataFile() {
  paths.ensurePersistentDirs();
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ listings: [] }, null, 2), "utf8");
  }
}

function readStore() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { listings: Array.isArray(parsed.listings) ? parsed.listings : [] };
  } catch {
    return { listings: [] };
  }
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function nextListingId(store) {
  const ids = store.listings.map((item) => item.id).filter((id) => typeof id === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function collectCourseUrls(course) {
  const urls = new Set();
  const add = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) urls.add(trimmed);
  };
  add(course?.banner);
  for (const section of course?.sections || []) {
    add(section.banner);
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        add(item.image);
        add(item.videoUrl);
        add(item.captionUrl);
        for (const track of item.captionTracks || []) add(track.url);
      }
    }
  }
  return [...urls];
}

function rewriteCourseUrls(course, map) {
  const rewritten = JSON.parse(JSON.stringify(course));
  const swap = (url) => map.get(String(url || "").trim()) || url;
  rewritten.banner = swap(rewritten.banner);
  for (const section of rewritten.sections || []) {
    section.banner = swap(section.banner);
    for (const exercise of section.exercises || []) {
      for (const item of exercise.items || []) {
        if (item.image != null) item.image = swap(item.image);
        if (item.videoUrl != null) item.videoUrl = swap(item.videoUrl);
        if (item.captionUrl != null) item.captionUrl = swap(item.captionUrl);
        for (const track of item.captionTracks || []) {
          if (track.url != null) track.url = swap(track.url);
        }
      }
    }
  }
  return rewritten;
}

function copyLocalUpload(url, destDirName) {
  const trimmed = String(url || "").trim();
  if (!trimmed.startsWith("/uploads/")) return trimmed;
  const sourcePath = paths.uploadFilePath(trimmed);
  if (!sourcePath || !fs.existsSync(sourcePath)) return trimmed;

  const destDir = path.join(paths.uploadsRoot, destDirName);
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(sourcePath) || "";
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  fs.copyFileSync(sourcePath, path.join(destDir, filename));
  return `/uploads/${destDirName}/${filename}`;
}

function snapshotCourseAssets(course, destDirName) {
  const map = new Map();
  for (const url of collectCourseUrls(course)) {
    if (!url.startsWith("/uploads/")) continue;
    map.set(url, copyLocalUpload(url, destDirName));
  }
  return rewriteCourseUrls(course, map);
}

function deleteCommunityAssets(listingId) {
  const dir = path.join(paths.uploadsCommunityDir, String(listingId));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function countExercises(course) {
  return cmsStore.flattenExercises(course || {}).length;
}

function isPublicListing(listing) {
  if (!listing || listing.status !== "public") return false;
  return (listing.reports || []).length < REPORT_HIDE_THRESHOLD;
}

function publicCard(listing, { teacherId } = {}) {
  const reports = listing.reports || [];
  return {
    id: listing.id,
    name: listing.name,
    description: listing.description || "",
    banner: listing.banner || "",
    langCode: listing.langCode || "en",
    authorName: listing.authorName || "Teacher",
    publishedByTeacherId: listing.publishedByTeacherId,
    publishedAt: listing.publishedAt,
    updatedAt: listing.updatedAt,
    featured: Boolean(listing.featured),
    copyCount: listing.copyCount || 0,
    reportCount: reports.length,
    sectionCount: (listing.sections || []).length,
    exerciseCount: listing.exerciseCount || countExercises(listing),
    isOwner: teacherId != null && listing.publishedByTeacherId === teacherId,
    alreadyCopied: Boolean(
      teacherId &&
        cmsStore
          .listCoursesForTeacher(teacherId)
          .some((course) => Number(course.sourceCommunityId) === Number(listing.id))
    ),
  };
}

function listingPreview(listing, { teacherId } = {}) {
  return {
    ...publicCard(listing, { teacherId }),
    sections: (listing.sections || []).map((section) => ({
      title: section.title || "Section",
      exerciseCount: (section.exercises || []).length,
      types: [...new Set((section.exercises || []).map((exercise) => exercise.type).filter(Boolean))],
    })),
  };
}

function listPublicListings({
  q = "",
  langCode = "",
  sort = "featured",
  authorId = null,
  teacherId = null,
} = {}) {
  const store = readStore();
  const query = String(q || "").trim().toLowerCase();
  const lang = String(langCode || "").trim().toLowerCase();
  const author = authorId != null ? Number(authorId) : null;

  let listings = store.listings.filter(isPublicListing);
  if (Number.isFinite(author) && author > 0) {
    listings = listings.filter((item) => item.publishedByTeacherId === author);
  }
  if (lang && lang !== "all") {
    listings = listings.filter((item) => String(item.langCode || "en").toLowerCase() === lang);
  }
  if (query) {
    listings = listings.filter((item) => {
      const hay = `${item.name || ""} ${item.description || ""} ${item.authorName || ""}`.toLowerCase();
      return hay.includes(query);
    });
  }

  listings.sort((a, b) => {
    if (sort === "popular") {
      if ((b.copyCount || 0) !== (a.copyCount || 0)) return (b.copyCount || 0) - (a.copyCount || 0);
    } else if (sort === "newest") {
      return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
    } else {
      if (Boolean(b.featured) !== Boolean(a.featured)) return b.featured ? 1 : -1;
      if ((b.copyCount || 0) !== (a.copyCount || 0)) return (b.copyCount || 0) - (a.copyCount || 0);
    }
    return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
  });

  const languages = [
    ...new Set(
      store.listings.filter(isPublicListing).map((item) => String(item.langCode || "en").toLowerCase())
    ),
  ].sort();

  return {
    courses: listings.map((item) => publicCard(item, { teacherId })),
    languages,
  };
}

function getListing(listingId) {
  const store = readStore();
  return store.listings.find((item) => item.id === Number(listingId)) || null;
}

function getPublicListing(listingId) {
  const listing = getListing(listingId);
  return isPublicListing(listing) ? listing : null;
}

function publishCourse({ course, teacherId, authorName, featured = false }) {
  if (!course) throw new Error("Course not found.");
  if (course.sourceCommunityId != null && Number(course.sourceCommunityId) > 0) {
    throw new Error("Courses copied from Community cannot be shared again.");
  }
  const sections = course.sections || [];
  const exerciseCount = countExercises(course);
  if (!exerciseCount) {
    throw new Error("Add at least one exercise before sharing to Community.");
  }

  const store = readStore();
  const now = new Date().toISOString();
  let listing = store.listings.find(
    (item) =>
      item.publishedByTeacherId === teacherId &&
      Number(item.sourceCourseId) === Number(course.id) &&
      item.status !== "removed"
  );

  if (!listing) {
    listing = {
      id: nextListingId(store),
      sourceCourseId: course.id,
      publishedByTeacherId: teacherId,
      status: "public",
      reports: [],
      copyCount: 0,
      createdAt: now,
    };
    store.listings.push(listing);
  }

  deleteCommunityAssets(listing.id);
  const snapshot = snapshotCourseAssets(
    {
      name: course.name,
      description: course.description,
      banner: course.banner,
      langCode: course.langCode,
      sections,
    },
    `community/${listing.id}`
  );

  listing.name = clip(snapshot.name || course.name, 120) || "Untitled course";
  listing.description = clip(snapshot.description || course.description, 500);
  listing.banner = snapshot.banner || "";
  listing.langCode = clip(snapshot.langCode || course.langCode || "en", 8) || "en";
  listing.authorName = clip(authorName, 80) || "Teacher";
  listing.sections = snapshot.sections || [];
  listing.exerciseCount = exerciseCount;
  listing.featured = Boolean(featured);
  listing.status = "public";
  listing.publishedAt = listing.publishedAt || now;
  listing.updatedAt = now;
  listing.reports = [];

  writeStore(store);
  cmsStore.updateCourse(course.id, teacherId, {
    communityListingId: listing.id,
    communityPublishedAt: listing.updatedAt,
    communityFeatured: listing.featured,
  });
  return publicCard(listing, { teacherId });
}

function unpublishListing({ listingId, teacherId }) {
  const store = readStore();
  const listing = store.listings.find((item) => item.id === Number(listingId));
  if (!listing) throw new Error("Community course not found.");
  if (listing.publishedByTeacherId !== teacherId) {
    throw new Error("Only the publisher can unshare this course.");
  }
  listing.status = "unpublished";
  listing.updatedAt = new Date().toISOString();
  listing.featured = false;
  writeStore(store);

  const source = cmsStore.getCourseForTeacher(listing.sourceCourseId, teacherId);
  if (source && Number(source.communityListingId) === Number(listing.id)) {
    cmsStore.updateCourse(source.id, teacherId, {
      communityListingId: null,
      communityPublishedAt: null,
      communityFeatured: false,
    });
  }
  return { ok: true, id: listing.id };
}

function reportListing({ listingId, teacherId, reason }) {
  const store = readStore();
  const listing = store.listings.find((item) => item.id === Number(listingId));
  if (!listing || !isPublicListing(listing)) throw new Error("Community course not found.");
  if (listing.publishedByTeacherId === teacherId) {
    throw new Error("You cannot report your own listing.");
  }
  listing.reports = listing.reports || [];
  if (listing.reports.some((entry) => entry.teacherId === teacherId)) {
    throw new Error("You already reported this course.");
  }
  listing.reports.push({
    teacherId,
    reason: clip(reason, 280),
    createdAt: new Date().toISOString(),
  });
  if (listing.reports.length >= REPORT_HIDE_THRESHOLD) {
    listing.status = "hidden";
    listing.featured = false;
  }
  listing.updatedAt = new Date().toISOString();
  writeStore(store);
  return { ok: true, hidden: listing.status === "hidden" };
}

function setFeatured({ listingId, teacherId, featured }) {
  const store = readStore();
  const listing = store.listings.find((item) => item.id === Number(listingId));
  if (!listing) throw new Error("Community course not found.");
  if (listing.publishedByTeacherId !== teacherId) {
    throw new Error("Only the publisher can feature this course.");
  }
  if (!isPublicListing(listing) && listing.status !== "public") {
    throw new Error("Share the course to Community before featuring it.");
  }
  listing.featured = Boolean(featured);
  listing.updatedAt = new Date().toISOString();
  writeStore(store);
  return publicCard(listing, { teacherId });
}

function destCategoryFromUrl(url) {
  const match = String(url || "").match(/^\/uploads\/(courses|sections|questions|captions|videos|material)\//);
  if (match) return match[1];
  return "questions";
}

function copyListingToTeacher({ listingId, teacherId }) {
  const listing = getPublicListing(listingId);
  if (!listing) throw new Error("Community course not found.");

  const existing = cmsStore
    .listCoursesForTeacher(teacherId)
    .find((course) => Number(course.sourceCommunityId) === Number(listing.id));
  if (existing) {
    return { course: existing, alreadyCopied: true };
  }

  const map = new Map();
  for (const url of collectCourseUrls(listing)) {
    if (!url.startsWith("/uploads/")) continue;
    map.set(url, copyLocalUpload(url, destCategoryFromUrl(url)));
  }
  const snapshot = rewriteCourseUrls(listing, map);

  const created = cmsStore.createCourse(teacherId, {
    name: snapshot.name,
    description: snapshot.description,
    banner: snapshot.banner,
    langCode: snapshot.langCode,
    classIds: [],
    sourceCommunityId: listing.id,
  });
  const saved = cmsStore.saveSections(created.id, teacherId, snapshot.sections || []);
  if (!saved) {
    cmsStore.deleteCourse(created.id, teacherId);
    throw new Error("Could not add this course to My courses.");
  }

  const store = readStore();
  const live = store.listings.find((item) => item.id === listing.id);
  if (live) {
    live.copyCount = (live.copyCount || 0) + 1;
    live.updatedAt = new Date().toISOString();
    writeStore(store);
  }

  return {
    course: {
      id: saved.id,
      name: saved.name,
      exerciseCount: countExercises(saved),
      sourceCommunityId: listing.id,
    },
    alreadyCopied: false,
  };
}

module.exports = {
  listPublicListings,
  getListing,
  getPublicListing,
  listingPreview,
  publicCard,
  publishCourse,
  unpublishListing,
  reportListing,
  setFeatured,
  copyListingToTeacher,
  REPORT_HIDE_THRESHOLD,
};
