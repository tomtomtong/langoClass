// Prompts for section path-tile images. No image libraries, so the Worker can use it.
const { characterLine } = require("./characters");

function summarizeSectionContent(section) {
  const exercises = Array.isArray(section?.exercises) ? section.exercises : [];
  const snippets = [];

  for (const exercise of exercises) {
    const type = String(exercise?.type || "mcquiz").trim();
    const exerciseTitle = String(exercise?.title || "").trim();
    if (exerciseTitle && !/^(exercise|untitled)$/i.test(exerciseTitle)) {
      snippets.push(exerciseTitle);
    }

    for (const item of exercise?.items || []) {
      if (type === "buzzin") {
        const topic = String(item?.topic || "").trim();
        if (topic) snippets.push(topic);
        continue;
      }

      if (type === "video") {
        const script = String(item?.script || item?.title || item?.description || "").trim();
        if (script) snippets.push(script.slice(0, 160));
        continue;
      }

      const question = String(item?.title || item?.question || item?.topic || "").trim();
      if (question) snippets.push(question);

      const correct = (item?.options || []).find((option) => option?.isCorrect)?.text;
      if (correct) snippets.push(String(correct).trim());
    }
  }

  const unique = [...new Set(snippets.map((line) => line.trim()).filter(Boolean))];
  return unique.slice(0, 14).join("; ");
}

function buildPathTileImagePrompt(sectionTitle, options = {}) {
  const title = String(sectionTitle || "").trim() || "Language lesson";
  const character = options.character || null;
  const characterRule = character
    ? `Put the character on the island among the landmarks, clearly visible and about a third of the island's height, doing something that fits the theme (for example waving or pointing at a landmark). ${characterLine(character)} No other people or mascots. `
    : `Do NOT include any human characters, mascots, or guide figures. `;
  const courseName = String(options.courseName || "").trim();
  const sectionContent = String(options.sectionContent || options.contentSummary || "").trim();
  const courseLine = courseName ? ` Course theme: "${courseName}".` : "";
  const contentLine = sectionContent
    ? ` Lesson content to visualize: ${sectionContent}.`
    : "";

  return (
    `3D isometric floating island path tile for a language-learning app journey map. Lesson theme: "${title}".${courseLine}${contentLine} ` +
    `Circular grassy diorama island with a rocky underside, vibrant polished 3D render, premium mobile game art style. ` +
    `Arrange recognizable cultural landmarks, flags, objects, and symbols that match the lesson theme and content across the island. ` +
    characterRule +
    `Rich saturated colors, playful educational diorama, contrasting cultures or topics when relevant. ` +
    `Square 1:1 composition, clean studio lighting. No text, no letters, no numbers, no color codes, no hex values, no labels, no watermarks, no UI frames. ` +
    `Render on a solid flat magenta chroma-key background only — no gradients, no sky, no clouds, no sun, no floor shadow on the backdrop.`
  );
}

module.exports = {
  summarizeSectionContent,
  buildPathTileImagePrompt,
};
