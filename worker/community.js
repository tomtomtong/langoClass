// Community listings in D1, following lib/community-store.js. A listing keeps
// its own copy of the course files, so the publisher can change or delete the
// course without breaking copies.
import { copyCourseFiles, deletePrefix } from "./course-files.js";
import {
  clip,
  countExercises,
  json,
  newCourse,
  numberSections,
  readDoc,
  readJson,
  requireTeacher,
  sameId,
  writeDocs,
} from "./d1-store.js";

const REPORT_HIDE_THRESHOLD = 3;
const COPY_FOLDERS = new Set(["courses", "sections", "questions", "captions", "videos", "material"]);

export async function handleCommunityApi(request, env, url, { fetchImpl = fetch } = {}) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && pathname === "/api/cms/community/courses") {
    return withTeacher(request, env, (auth) => listListings(env, url, auth));
  }
  const listing = pathname.match(/^\/api\/cms\/community\/courses\/(\d+)(?:\/(copy|report|unpublish|feature))?$/);
  if (listing) {
    const listingId = Number(listing[1]);
    const action = listing[2] || "";
    if (method === "GET" && !action) return withTeacher(request, env, (auth) => preview(env, listingId, auth));
    if (method !== "POST" || !action) return null;
    return withTeacher(request, env, async (auth) => {
      const body = await readJson(request);
      if (action === "copy") return copyListing(env, listingId, auth, fetchImpl);
      if (action === "report") return reportListing(env, listingId, auth, body);
      if (action === "unpublish") return unpublishListing(env, listingId, auth);
      return featureListing(env, listingId, auth, body);
    });
  }
  const course = pathname.match(/^\/api\/cms\/courses\/(-?\d+)\/community\/(publish|unpublish)$/);
  if (course && method === "POST") {
    return withTeacher(request, env, async (auth) => {
      const body = await readJson(request);
      if (course[2] === "publish") return publishCourse(env, Number(course[1]), auth, body, fetchImpl);
      return unpublishCourse(env, Number(course[1]), auth, body);
    });
  }
  return null;
}

async function withTeacher(request, env, handler) {
  const auth = await requireTeacher(request, env);
  if (auth instanceof Response) return auth;
  try {
    return await handler(auth);
  } catch (error) {
    if (error instanceof CommunityError) return json({ message: error.message }, error.status);
    throw error;
  }
}

class CommunityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function listListings(env, url, auth) {
  const [store, courses] = await readStores(env);
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const lang = String(url.searchParams.get("langCode") || "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") || "featured";
  const author = Number(url.searchParams.get("authorId"));

  const visible = store.listings.filter(isPublic);
  let listings = visible;
  if (Number.isFinite(author) && author > 0) listings = listings.filter((item) => sameId(item.publishedByTeacherId, author));
  if (lang && lang !== "all") listings = listings.filter((item) => String(item.langCode || "en").toLowerCase() === lang);
  if (query) {
    listings = listings.filter((item) =>
      `${item.name || ""} ${item.description || ""} ${item.authorName || ""}`.toLowerCase().includes(query)
    );
  }
  listings = [...listings].sort((a, b) => {
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
  return json({
    courses: listings.map((item) => publicCard(item, auth.teacherId, courses)),
    languages: [...new Set(visible.map((item) => String(item.langCode || "en").toLowerCase()))].sort(),
  });
}

async function preview(env, listingId, auth) {
  const [store, courses] = await readStores(env);
  const listing = store.listings.find((item) => item.id === listingId);
  if (!isPublic(listing)) return json({ message: "Community course not found." }, 404);
  return json({
    course: {
      ...publicCard(listing, auth.teacherId, courses),
      sections: (listing.sections || []).map((section) => ({
        title: section.title || "Section",
        exerciseCount: (section.exercises || []).length,
        types: [...new Set((section.exercises || []).map((exercise) => exercise.type).filter(Boolean))],
      })),
    },
  });
}

async function publishCourse(env, courseId, auth, body, fetchImpl) {
  let [store, courses] = await readStores(env);
  let course = ownCourse(courses, courseId, auth.teacherId);
  if (!course) return json({ message: "Course not found." }, 404);
  if (course.sourceCommunityId != null && Number(course.sourceCommunityId) > 0) {
    throw new CommunityError("Courses copied from Community cannot be shared again.");
  }
  const exerciseCount = countExercises(course);
  if (!exerciseCount) throw new CommunityError("Add at least one exercise before sharing to Community.");

  let listing = findPublished(store, course.id, auth.teacherId);
  const listingId = listing?.id ?? nextListingId(store);

  // Copy files before reading the documents again for the write: copying can
  // take a while, and the write must not undo changes made meanwhile.
  await deletePrefix(env, `uploads/community/${listingId}/`);
  const snapshot = await copyCourseFiles(
    env,
    { name: course.name, description: course.description, banner: course.banner, langCode: course.langCode, sections: course.sections || [] },
    () => `community/${listingId}`,
    fetchImpl
  );

  [store, courses] = await readStores(env);
  course = ownCourse(courses, courseId, auth.teacherId);
  if (!course) return json({ message: "Course not found." }, 404);
  const now = new Date().toISOString();
  listing = store.listings.find((item) => item.id === listingId);
  if (!listing) {
    listing = {
      id: listingId,
      sourceCourseId: course.id,
      publishedByTeacherId: auth.teacherId,
      status: "public",
      reports: [],
      copyCount: 0,
      createdAt: now,
    };
    store.listings.push(listing);
  }
  listing.name = clip(snapshot.name || course.name, 120) || "Untitled course";
  listing.description = clip(snapshot.description || course.description, 500);
  listing.banner = snapshot.banner || "";
  listing.langCode = clip(snapshot.langCode || course.langCode || "en", 8) || "en";
  listing.authorName = clip(body.authorName, 80) || "Teacher";
  listing.sections = snapshot.sections || [];
  listing.exerciseCount = exerciseCount;
  listing.featured = Boolean(body.featured);
  listing.status = "public";
  listing.publishedAt = listing.publishedAt || now;
  listing.updatedAt = now;
  listing.reports = [];

  course.communityListingId = listing.id;
  course.communityPublishedAt = listing.updatedAt;
  course.communityFeatured = listing.featured;
  course.updatedAt = now;
  await writeDocs(env, [["community-courses", store], ["teacher-courses", courses]]);
  return json({ ok: true, listing: publicCard(listing, auth.teacherId, courses), course });
}

async function unpublishCourse(env, courseId, auth, body) {
  const [, courses] = await readStores(env);
  const course = ownCourse(courses, courseId, auth.teacherId);
  if (!course) return json({ message: "Course not found." }, 404);
  const listingId = Number(course.communityListingId || body.listingId);
  if (!Number.isFinite(listingId) || listingId <= 0) {
    throw new CommunityError("This course is not shared to Community.");
  }
  const result = await unpublish(env, listingId, auth.teacherId);
  return json({ ok: true, course: ownCourse(result.courses, courseId, auth.teacherId) });
}

async function unpublishListing(env, listingId, auth) {
  await unpublish(env, listingId, auth.teacherId);
  return json({ ok: true, id: listingId });
}

async function unpublish(env, listingId, teacherId) {
  const [store, courses] = await readStores(env);
  const listing = store.listings.find((item) => item.id === listingId);
  if (!listing) throw new CommunityError("Community course not found.");
  if (!sameId(listing.publishedByTeacherId, teacherId)) {
    throw new CommunityError("Only the publisher can unshare this course.");
  }
  listing.status = "unpublished";
  listing.updatedAt = new Date().toISOString();
  listing.featured = false;
  const source = ownCourse(courses, listing.sourceCourseId, teacherId);
  if (source && Number(source.communityListingId) === listing.id) {
    source.communityListingId = null;
    source.communityPublishedAt = null;
    source.communityFeatured = false;
    source.updatedAt = listing.updatedAt;
  }
  await writeDocs(env, [["community-courses", store], ["teacher-courses", courses]]);
  return { store, courses };
}

async function reportListing(env, listingId, auth, body) {
  const [store] = await readStores(env);
  const listing = store.listings.find((item) => item.id === listingId);
  if (!isPublic(listing)) throw new CommunityError("Community course not found.");
  if (sameId(listing.publishedByTeacherId, auth.teacherId)) {
    throw new CommunityError("You cannot report your own listing.");
  }
  listing.reports = listing.reports || [];
  if (listing.reports.some((entry) => sameId(entry.teacherId, auth.teacherId))) {
    throw new CommunityError("You already reported this course.");
  }
  listing.reports.push({ teacherId: auth.teacherId, reason: clip(body.reason, 280), createdAt: new Date().toISOString() });
  if (listing.reports.length >= REPORT_HIDE_THRESHOLD) {
    listing.status = "hidden";
    listing.featured = false;
  }
  listing.updatedAt = new Date().toISOString();
  await writeDocs(env, [["community-courses", store]]);
  return json({ ok: true, hidden: listing.status === "hidden" });
}

async function featureListing(env, listingId, auth, body) {
  const [store, courses] = await readStores(env);
  const listing = store.listings.find((item) => item.id === listingId);
  if (!listing) throw new CommunityError("Community course not found.");
  if (!sameId(listing.publishedByTeacherId, auth.teacherId)) {
    throw new CommunityError("Only the publisher can feature this course.");
  }
  if (listing.status !== "public") throw new CommunityError("Share the course to Community before featuring it.");
  listing.featured = body.featured !== false;
  listing.updatedAt = new Date().toISOString();
  await writeDocs(env, [["community-courses", store]]);
  return json({ ok: true, course: publicCard(listing, auth.teacherId, courses) });
}

async function copyListing(env, listingId, auth, fetchImpl) {
  let [store, courses] = await readStores(env);
  let listing = store.listings.find((item) => item.id === listingId);
  if (!isPublic(listing)) throw new CommunityError("Community course not found.");
  const existing = copiedCourse(courses, listingId, auth.teacherId);
  if (existing) return json({ ok: true, course: courseSummary(existing), alreadyCopied: true });

  const snapshot = await copyCourseFiles(env, listing, copyFolder, fetchImpl);

  [store, courses] = await readStores(env);
  listing = store.listings.find((item) => item.id === listingId);
  if (!isPublic(listing)) throw new CommunityError("Community course not found.");
  const raced = copiedCourse(courses, listingId, auth.teacherId);
  if (raced) return json({ ok: true, course: courseSummary(raced), alreadyCopied: true });

  const now = new Date().toISOString();
  const course = newCourse(
    courses,
    auth.teacherId,
    {
      name: snapshot.name,
      description: snapshot.description,
      banner: snapshot.banner,
      langCode: snapshot.langCode,
      classIds: [],
      sourceCommunityId: listing.id,
    },
    now
  );
  course.sections = numberSections(structuredClone(snapshot.sections || []));
  courses.courses.push(course);
  listing.copyCount = (listing.copyCount || 0) + 1;
  listing.updatedAt = now;
  await writeDocs(env, [["teacher-courses", courses], ["community-courses", store]]);
  return json({ ok: true, course: courseSummary(course), alreadyCopied: false });
}

async function readStores(env) {
  const store = await readDoc(env, "community-courses", { listings: [] });
  const courses = await readDoc(env, "teacher-courses", { courses: [] });
  if (!Array.isArray(store.listings)) store.listings = [];
  if (!Array.isArray(courses.courses)) courses.courses = [];
  return [store, courses];
}

function isPublic(listing) {
  return !!listing && listing.status === "public" && (listing.reports || []).length < REPORT_HIDE_THRESHOLD;
}

function publicCard(listing, teacherId, courses) {
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
    reportCount: (listing.reports || []).length,
    sectionCount: (listing.sections || []).length,
    exerciseCount: listing.exerciseCount || countExercises(listing),
    isOwner: teacherId != null && sameId(listing.publishedByTeacherId, teacherId),
    alreadyCopied: Boolean(teacherId != null && copiedCourse(courses, listing.id, teacherId)),
  };
}

function findPublished(store, courseId, teacherId) {
  return store.listings.find(
    (item) => sameId(item.publishedByTeacherId, teacherId) && Number(item.sourceCourseId) === Number(courseId) && item.status !== "removed"
  );
}

function nextListingId(store) {
  const ids = store.listings.map((item) => item.id).filter((id) => typeof id === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function ownCourse(courses, courseId, teacherId) {
  return courses.courses.find((item) => item.id === Number(courseId) && sameId(item.teacherId, teacherId)) || null;
}

function copiedCourse(courses, listingId, teacherId) {
  return courses.courses.find(
    (item) => sameId(item.teacherId, teacherId) && Number(item.sourceCommunityId) === Number(listingId)
  ) || null;
}

function courseSummary(course) {
  return {
    id: course.id,
    name: course.name,
    exerciseCount: countExercises(course),
    sourceCommunityId: course.sourceCommunityId,
  };
}

function copyFolder(url) {
  const folder = String(url).split("/")[2];
  return COPY_FOLDERS.has(folder) ? folder : "questions";
}
