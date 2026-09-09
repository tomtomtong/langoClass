const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

const USER_AGENT = "LangoClassCMS/1.0 (educational quiz image search)";
const MAX_WIKIPEDIA_CANDIDATES = 4;
const MAX_RELEVANCE_CANDIDATES = 2;

const HK_WIKIPEDIA_TITLE_HINTS = [
  { pattern: /彩虹邨|彩虹村/, titles: ["Choi Hung Estate"], queries: ["Choi Hung Estate Hong Kong"] },
  { pattern: /華富邨|華富村/, titles: ["Wah Fu Estate"], queries: ["Wah Fu Estate Hong Kong"] },
  { pattern: /美孚/, titles: ["Mei Foo Sun Chuen"], queries: ["Mei Foo Hong Kong"] },
  { pattern: /公屋|公共屋邨|公共房屋/, titles: [], queries: ["Public housing estates Hong Kong"] },
];

function fallbackSearchQuery(text) {
  const latin = String(text || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => /[a-zA-Z]/.test(word))
    .slice(0, 6)
    .join(" ")
    .trim();
  return latin;
}

function isLatinSearchQuery(query) {
  const q = String(query || "").trim();
  if (!q) return false;
  const latin = (q.match(/[a-zA-Z]/g) || []).length;
  const total = q.replace(/\s/g, "").length;
  return latin >= Math.min(3, Math.max(1, total * 0.4));
}

function searchQueryVariants(primary) {
  const variants = [];
  const add = (value) => {
    const query = String(value || "").trim();
    if (query && isLatinSearchQuery(query) && !variants.includes(query)) variants.push(query);
  };

  add(primary);
  add(String(primary || "").replace(/\b(19|20)\d{2}s?\b/gi, "").replace(/\s+/g, " ").trim());
  const words = String(primary || "").split(/\s+/).filter(Boolean);
  add(words.slice(0, 4).join(" "));
  add(words.slice(0, 3).join(" "));
  return variants;
}

function wikipediaApiUrl(wikiLang) {
  const lang = String(wikiLang || "en")
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .slice(0, 12);
  return `https://${lang || "en"}.wikipedia.org/w/api.php`;
}

function wikipediaSearchLanguages(langCode) {
  const base = String(langCode || "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  if (base === "yue" || base === "zh") return ["en", "zh"];
  const localized = {
    ja: "ja",
    ko: "ko",
    fr: "fr",
    de: "de",
    es: "es",
    it: "it",
    pt: "pt",
    ru: "ru",
    vi: "vi",
    ar: "ar",
    hi: "hi",
    id: "id",
    tr: "tr",
    bn: "bn",
  }[base];
  if (localized && localized !== "en") return ["en", localized];
  return ["en"];
}

function normalizeMatchToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
}

function conservativeTitleMatch(articleTitle, searchQuery) {
  const title = normalizeMatchToken(articleTitle);
  const words = normalizeMatchToken(searchQuery)
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (!title || !words.length) return false;
  const hits = words.filter((word) => title.includes(word)).length;
  if (words.length === 1) return hits === 1;
  return hits >= Math.min(2, words.length);
}

async function buildOnlineImageSearchQuery(questionText, langCode, llmComplete, apiKey, model) {
  const trimmed = String(questionText || "").trim();
  if (!trimmed) return "";
  if (typeof llmComplete !== "function" || !apiKey) {
    const fallback = fallbackSearchQuery(trimmed);
    return isLatinSearchQuery(fallback) ? fallback : "";
  }

  try {
    const content = await llmComplete(
      apiKey,
      model,
      [
        {
          role: "system",
          content:
            "You pick Wikipedia article search phrases for educational quiz photos. " +
            "Reply with ONLY 2-6 English keywords for the main subject/place/person in the question. " +
            "Use official English Wikipedia article names when possible (e.g. Choi Hung Estate, Wah Fu Estate). " +
            "No quotes or punctuation.",
        },
        {
          role: "user",
          content: `Language: ${langCode || "en"}\nQuestion: ${trimmed}`,
        },
      ],
      48
    );
    const query = String(content || "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    if (isLatinSearchQuery(query)) return query;
    const fallback = fallbackSearchQuery(trimmed);
    return isLatinSearchQuery(fallback) ? fallback : "";
  } catch {
    const fallback = fallbackSearchQuery(trimmed);
    return isLatinSearchQuery(fallback) ? fallback : "";
  }
}

function hkWikipediaHintsForQuestion(questionText) {
  const text = String(questionText || "");
  const directTitles = [];
  const searchQueries = [];
  for (const hint of HK_WIKIPEDIA_TITLE_HINTS) {
    if (!hint.pattern.test(text)) continue;
    for (const title of hint.titles || []) {
      if (!directTitles.includes(title)) directTitles.push(title);
    }
    for (const query of hint.queries || []) {
      if (!searchQueries.includes(query)) searchQueries.push(query);
    }
  }
  return { directTitles, searchQueries };
}

async function extractWikipediaArticleTargets(questionText, langCode, llmComplete, apiKey, model) {
  const trimmed = String(questionText || "").trim();
  const hints = hkWikipediaHintsForQuestion(trimmed);
  if (!trimmed || typeof llmComplete !== "function" || !apiKey) {
    return { ...hints, hintTitles: [...hints.directTitles] };
  }

  try {
    const hkHint =
      String(langCode || "").toLowerCase().startsWith("yue") || /[\u4e00-\u9fff]/.test(trimmed)
        ? "If the question is about Hong Kong, prefer Hong Kong Wikipedia articles. " +
          "彩虹邨/彩虹村 usually means Choi Hung Estate (Hong Kong), NOT Taiwan Rainbow Village. " +
          "華富邨/華富村 means Wah Fu Estate."
        : "";
    const content = await llmComplete(
      apiKey,
      model,
      [
        {
          role: "system",
          content:
            "Extract Wikipedia article titles for a quiz photo. Return ONLY JSON: " +
            '{"directTitles":["Exact English Wikipedia article title"],"searchQueries":["2-6 English keywords"]}. ' +
            "Use the most specific article for the main subject/place. Max 3 directTitles and 3 searchQueries. " +
            hkHint,
        },
        {
          role: "user",
          content: `Language: ${langCode || "en"}\nQuestion: ${trimmed}`,
        },
      ],
      120
    );
    const parsed = JSON.parse(String(content || "").trim().replace(/^```json\s*|```$/g, ""));
    const directTitles = [
      ...hints.directTitles,
      ...(Array.isArray(parsed?.directTitles) ? parsed.directTitles : [])
        .map((title) => String(title || "").trim())
        .filter(Boolean),
    ].filter((title, index, list) => list.indexOf(title) === index).slice(0, 4);
    const searchQueries = [
      ...hints.searchQueries,
      ...(Array.isArray(parsed?.searchQueries) ? parsed.searchQueries : [])
        .map((query) => String(query || "").trim())
        .filter((query) => isLatinSearchQuery(query)),
    ].filter((query, index, list) => list.indexOf(query) === index).slice(0, 4);
    return { directTitles, searchQueries, hintTitles: [...hints.directTitles] };
  } catch {
    return { ...hints, hintTitles: [...hints.directTitles] };
  }
}

async function lookupWikipediaImageByTitle(title, wikiLang = "en") {
  const pageTitle = String(title || "").trim();
  if (!pageTitle) return null;

  const params = new URLSearchParams({
    action: "query",
    titles: pageTitle,
    prop: "pageimages",
    piprop: "thumbnail|original",
    pithumbsize: "960",
    format: "json",
    origin: "*",
    redirects: "1",
  });

  const res = await fetch(`${wikipediaApiUrl(wikiLang)}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const pages = data?.query?.pages || {};
  for (const page of Object.values(pages)) {
    if (Number(page?.missing) === 1 || Number(page?.invalid) === 1) continue;
    const url = pickWikipediaImageUrl(page);
    const resolvedTitle = String(page?.title || pageTitle).trim();
    if (url) return { url, title: resolvedTitle, wikiLang, searchQuery: pageTitle, direct: true };
  }
  return null;
}

function pickWikipediaImageUrl(page) {
  const thumbUrl = String(page?.thumbnail?.source || "").trim();
  const originalUrl = String(page?.original?.source || "").trim();
  const url = thumbUrl || originalUrl;
  if (!url) return null;
  if (/\.svg(\?|$)/i.test(url)) return null;
  if (/\.gif(\?|$)/i.test(url)) return null;
  return url;
}

async function searchWikipediaImageCandidates(query, langCode = "en", limit = MAX_WIKIPEDIA_CANDIDATES) {
  const search = String(query || "").trim();
  if (!search) return [];

  const candidates = [];
  const seen = new Set();

  for (const wikiLang of wikipediaSearchLanguages(langCode)) {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: search,
      gsrlimit: String(Math.min(limit, 10)),
      prop: "pageimages",
      piprop: "thumbnail|original",
      pithumbsize: "960",
      format: "json",
      origin: "*",
    });

    const res = await fetch(`${wikipediaApiUrl(wikiLang)}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) continue;

    const data = await res.json();
    const pages = data?.query?.pages || {};
    for (const page of Object.values(pages)) {
      const url = pickWikipediaImageUrl(page);
      const title = String(page?.title || "").trim();
      if (!url || !title) continue;
      const key = `${wikiLang}:${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ url, title, wikiLang, searchQuery: search });
      if (candidates.length >= limit) return candidates;
    }
  }

  return candidates;
}

async function searchWikipediaImageUrl(query, langCode = "en") {
  const candidates = await searchWikipediaImageCandidates(query, langCode, 1);
  return candidates[0]?.url || null;
}

function isLikelyIrrelevantArticleTitle(articleTitle, searchQuery) {
  const title = normalizeMatchToken(articleTitle);
  const query = normalizeMatchToken(searchQuery);
  if (!title) return true;
  if (/^list of\b/.test(title)) return true;
  if (/\belection\b/.test(title) && !/\belection\b/.test(query)) return true;
  if (/\bindependence movement\b/.test(title)) return true;
  if (/\bnational security\b/.test(title)) return true;
  if (/\bdemocracy in\b/.test(title) && !/\bdemocracy\b/.test(query)) return true;
  return false;
}

async function isArticleRelevantToQuestion({
  questionText,
  articleTitle,
  searchQuery,
  langCode,
  llmComplete,
  apiKey,
  model,
}) {
  const title = String(articleTitle || "").trim();
  if (!title) return false;
  if (isLikelyIrrelevantArticleTitle(title, searchQuery)) return false;

  if (typeof llmComplete !== "function" || !apiKey) {
    return conservativeTitleMatch(title, searchQuery);
  }

  try {
    const content = await llmComplete(
      apiKey,
      model,
      [
        {
          role: "system",
          content:
            "You judge whether a Wikipedia article's lead photo would help a quiz question. Reply ONLY YES or NO. Say NO if the article is about a different place, topic, country, list, election, movement, or only loosely related.",
        },
        {
          role: "user",
          content: `Quiz language: ${langCode || "en"}\nQuestion: ${questionText}\nSearch phrase: ${searchQuery}\nWikipedia article title: ${title}\nIs this article's photo clearly relevant?`,
        },
      ],
      8
    );
    return /^yes\b/i.test(String(content || "").trim()) && conservativeTitleMatch(title, searchQuery);
  } catch {
    return conservativeTitleMatch(title, searchQuery);
  }
}

async function downloadQuestionImageToUploads(sourceUrl, { owner = "web" } = {}) {
  const res = await fetch(sourceUrl, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Image download failed (${res.status}).`);
  }

  const contentType = String(res.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extMap = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  const ext = extMap[contentType] || ".jpg";
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 512) {
    throw new Error("Downloaded image was too small.");
  }
  if (buffer.length > 2 * 1024 * 1024) {
    throw new Error("Downloaded image exceeds 2 MB.");
  }

  paths.ensurePersistentDirs();
  const safeOwner = String(owner || "web").replace(/\W/g, "").slice(0, 24) || "web";
  const filename = `question-${safeOwner}-web-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const filePath = path.join(paths.uploadsQuestionsDir, filename);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/questions/${filename}`;
}

async function findAndSaveQuestionImage({ questionText, langCode, llmComplete, apiKey, model, owner }) {
  const startedAt = Date.now();
  const targets = await extractWikipediaArticleTargets(
    questionText,
    langCode,
    llmComplete,
    apiKey,
    model
  );
  const hintTitles = new Set(targets.hintTitles || []);
  const fallbackQuery = fallbackSearchQuery(questionText);
  const queries = [
    ...targets.searchQueries,
    ...searchQueryVariants(fallbackQuery || targets.searchQueries[0] || ""),
  ].filter((query, index, list) => query && list.indexOf(query) === index);

  if (!queries.length && !targets.directTitles.length) {
    return {
      ok: false,
      reason: "empty-query",
      query: fallbackQuery || "",
      durationMs: Date.now() - startedAt,
    };
  }

  const rejected = [];
  const wikiLangs = wikipediaSearchLanguages(langCode);

  for (const wikiLang of wikiLangs) {
    for (const title of targets.directTitles) {
      const direct = await lookupWikipediaImageByTitle(title, wikiLang);
      if (!direct) continue;
      const fromHint = hintTitles.has(title);
      const relevant =
        fromHint ||
        (await isArticleRelevantToQuestion({
          questionText,
          articleTitle: direct.title,
          searchQuery: title,
          langCode,
          llmComplete: fromHint ? null : llmComplete,
          apiKey: fromHint ? "" : apiKey,
          model,
        }));
      if (!relevant) {
        if (rejected.length < 8) {
          rejected.push({ title: direct.title, query: title, wikiLang, reason: "not-relevant" });
        }
        continue;
      }
      const url = await downloadQuestionImageToUploads(direct.url, { owner });
      return {
        ok: true,
        url,
        query: title,
        sourceUrl: direct.url,
        articleTitle: direct.title,
        triedQueries: queries,
        rejected,
        matchType: fromHint ? "direct-hint" : "direct-title",
        durationMs: Date.now() - startedAt,
      };
    }
  }

  for (const query of queries) {
    const candidates = await searchWikipediaImageCandidates(query, langCode);
    if (!candidates.length) continue;

    for (const candidate of candidates.slice(0, MAX_RELEVANCE_CANDIDATES)) {
      const relevant = await isArticleRelevantToQuestion({
        questionText,
        articleTitle: candidate.title,
        searchQuery: query,
        langCode,
        llmComplete,
        apiKey,
        model,
      });
      if (!relevant) {
        if (rejected.length < 8) {
          rejected.push({
            title: candidate.title,
            query,
            wikiLang: candidate.wikiLang,
            reason: "not-relevant",
          });
        }
        continue;
      }

      const url = await downloadQuestionImageToUploads(candidate.url, { owner });
      return {
        ok: true,
        url,
        query,
        sourceUrl: candidate.url,
        articleTitle: candidate.title,
        triedQueries: queries,
        rejected,
        matchType: "search",
        durationMs: Date.now() - startedAt,
      };
    }
  }

  return {
    ok: false,
    reason: rejected.length ? "not-relevant" : "no-results",
    query: queries[0] || targets.directTitles[0] || "",
    triedQueries: queries,
    directTitles: targets.directTitles,
    rejected,
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  buildOnlineImageSearchQuery,
  extractWikipediaArticleTargets,
  lookupWikipediaImageByTitle,
  searchWikipediaImageUrl,
  searchWikipediaImageCandidates,
  searchWikimediaImageUrl: searchWikipediaImageUrl,
  downloadQuestionImageToUploads,
  findAndSaveQuestionImage,
  isArticleRelevantToQuestion,
  fallbackSearchQuery,
  isLatinSearchQuery,
  searchQueryVariants,
  wikipediaSearchLanguages,
};
