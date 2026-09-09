const SIMPLIFIED_CHINESE_CHARS =
  /[这国们时说会个还问图书长开关听语华现从让给进远东电画产业页风龙马鸟鱼见车无云专两为乐习买卖学对头来发广东门时]/;

/** Clearly Mandarin-only wording — rare in natural Cantonese quiz text. */
const STRONG_MANDARIN_MARKERS_YUE =
  /(?:怎样|什么|这个|那个|以及|通过|进行|已经|他们|我们|你们|为什么|如何|是否|并且|但是|关于|其中|应该|认为|实际|目前|描述|社区|连接|追溯到|这些|那些|哪个|哪些|非常|因为|所以|如果|可以|需要|现在|还是|没有)/;

/** Shared written-Chinese words — only treat as Mandarin when no Cantonese particles are present. */
const WEAK_MANDARIN_MARKERS_YUE = /(?:还是|现在|没有|可以|需要|如果|因为|所以|非常|认为|应该)/;

/** Spoken Cantonese particles / vocabulary that indicate the line is already Cantonese. */
const CANTONESE_PARTICLE_MARKERS_YUE = /[嘅咩唔喺噉乜邊個邊度係哋佢睇講]/;

const MANDARIN_ONLY_MARKERS_YUE = STRONG_MANDARIN_MARKERS_YUE;

function usesSimplifiedChinese(text) {
  return SIMPLIFIED_CHINESE_CHARS.test(String(text || ""));
}

function containsMandarinWording(text) {
  const sample = String(text || "").trim();
  if (!sample) return false;
  if (usesSimplifiedChinese(sample)) return true;
  if (STRONG_MANDARIN_MARKERS_YUE.test(sample)) return true;
  if (CANTONESE_PARTICLE_MARKERS_YUE.test(sample)) return false;
  return WEAK_MANDARIN_MARKERS_YUE.test(sample);
}

/** Extra markers that often cause Mandarin-style TTS unless rewritten. */
const MANDARIN_TTS_PREP_MARKERS_YUE =
  /(?:怎样|什么|这个|那个|以及|通过|进行|已经|他们|我们|你们|为什么|如何|是否|并且|但是|关于|其中|应该|认为|实际|目前|描述|社区|连接|追溯到|还是|现在|没有|这些|那些|哪个|哪些)/;

function needsCantoneseSpeechPrep(text) {
  const sample = String(text || "").trim();
  if (!sample) return false;
  if (usesSimplifiedChinese(sample)) return true;
  if (STRONG_MANDARIN_MARKERS_YUE.test(sample)) return true;
  if (CANTONESE_PARTICLE_MARKERS_YUE.test(sample)) {
    return /描述/.test(sample);
  }
  return MANDARIN_TTS_PREP_MARKERS_YUE.test(sample);
}

function cantoneseSpeechPromptHint() {
  return (
    "Use spoken Hong Kong Cantonese (廣東話口語), NOT Mandarin (普通話) or mainland written Chinese. " +
    "Prefer: 咩/什麼, 點樣, 呢個, 嗰個, 同, 冇, 喺, 嘅, 佢, 哋, 講/形容, 睇, 鍾意, 細個. " +
    "Avoid mainland Mandarin-only words like 通过, 进行, 以及, 并且, 什么, 这个, 怎样, 描述, 这些, 那些."
  );
}

async function prepareCantoneseSpeechText(text, { llmComplete, apiKey, model } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return trimmed;
  if (typeof llmComplete !== "function" || !apiKey) return trimmed;

  try {
    const content = await llmComplete(
      apiKey,
      model,
      [
        {
          role: "system",
          content:
            "Rewrite quiz lines into natural spoken Hong Kong Cantonese for text-to-speech. " +
            "Keep Traditional Chinese characters. Keep meaning and place names accurate. Keep it concise. " +
            "Use spoken Cantonese grammar (e.g. 係, 嘅, 咩, 點樣, 呢個, 嗰個, 冇, 喺). " +
            "Return ONLY the rewritten line with no quotes or explanation.",
        },
        {
          role: "user",
          content: `${cantoneseSpeechPromptHint()}\n\nLine:\n${trimmed}`,
        },
      ],
      120
    );
    const rewritten = String(content || "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return rewritten || trimmed;
  } catch {
    return trimmed;
  }
}

module.exports = {
  containsMandarinWording,
  needsCantoneseSpeechPrep,
  usesSimplifiedChinese,
  cantoneseSpeechPromptHint,
  prepareCantoneseSpeechText,
  MANDARIN_ONLY_MARKERS_YUE,
};
