const { DEFAULT_GENERATE_MODEL } = require("./exercise-generator");
const { getUiGuidance, buildAssistantSystemPrompt } = require("./cms-ui-map");

function clipContextText(value, max = 6000) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

function summarizeSections(sections) {
  return (Array.isArray(sections) ? sections : []).slice(0, 12).map((section, index) => ({
    title: String(section?.title || `Section ${index + 1}`).trim(),
    exerciseCount: (section?.exercises || []).length,
    estimatedMinutes: section?.estimatedMinutes || null,
  }));
}

function buildAssistantUserPayload({ message, context, history }) {
  const ctx = context && typeof context === "object" ? context : {};
  const course = ctx.course || {};
  const section = ctx.section || null;
  const exercise = ctx.exercise || null;
  const uiGuidance = getUiGuidance(ctx);
  const lines = [
    uiGuidance,
    "",
    "CMS CONTEXT JSON:",
    JSON.stringify(
      {
        screen: ctx.screen || null,
        tab: ctx.tab || null,
        subview: ctx.subview || null,
        mode: ctx.mode || "general",
        pageHeading: ctx.pageHeading || null,
        course: course.id
          ? {
              id: course.id,
              name: course.name || "",
              langCode: course.langCode || "en",
              description: clipContextText(course.description, 400),
              sectionCount: course.sectionCount || 0,
            }
          : null,
        section: section
          ? {
              title: section.title || "",
              exerciseCount: section.exerciseCount || 0,
              estimatedLabel: section.estimatedLabel || null,
            }
          : null,
        exercise: exercise
          ? {
              type: exercise.type || "",
              title: exercise.title || "",
              itemCount: exercise.itemCount || 0,
            }
          : null,
        wizardStep: ctx.wizardStep || null,
        sections: summarizeSections(ctx.sections),
        selection: clipContextText(ctx.selection, 280) || null,
      },
      null,
      2
    ),
    "",
    "CONVERSATION:",
  ];

  for (const turn of (Array.isArray(history) ? history : []).slice(-8)) {
    const role = turn?.role === "assistant" ? "Assistant" : "Teacher";
    lines.push(`${role}: ${String(turn?.content || "").trim()}`);
  }

  lines.push(`Teacher: ${String(message || "").trim()}`);
  lines.push("Assistant:");
  return lines.join("\n");
}

async function answerCmsAssistant(options, llmComplete) {
  if (typeof llmComplete !== "function") {
    throw new Error("LLM complete function is required.");
  }

  const message = String(options?.message || "").trim();
  if (!message) throw new Error("Enter a message for the assistant.");

  const apiKey = String(options?.apiKey || "").trim();
  if (!apiKey) throw new Error("Configure OpenRouter in Config before using the assistant.");

  const model = String(options?.model || DEFAULT_GENERATE_MODEL).trim() || DEFAULT_GENERATE_MODEL;
  const context = options?.context || {};
  const history = Array.isArray(options?.history) ? options.history : [];

  const messages = [
    { role: "system", content: buildAssistantSystemPrompt(context) },
    {
      role: "user",
      content: buildAssistantUserPayload({ message, context, history }),
    },
  ];

  const reply = await llmComplete(apiKey, model, messages, 900);
  const content = String(reply || "").trim();
  if (!content) throw new Error("The assistant returned an empty response.");
  return { reply: content, model };
}

module.exports = {
  answerCmsAssistant,
  buildAssistantSystemPrompt,
};
