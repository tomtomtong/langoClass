// Spoken "you're up" line after a Buzz In win / lucky draw, per speak language.
const TEMPLATES = {
  yue: ({ question, name }) =>
    `今日條題目係：${question}。${name}，到你喇！喺你部機㩒錄音掣，講出答案，再㩒一次提交。`,
  zh: ({ question, name }) =>
    `今天的问题是：${question}。${name}，轮到你啦！请在你的设备上点击录音按钮，说出答案，再点一次提交。`,
  en: ({ question, name }) =>
    `Today's question is: ${question} ${name}, you're up! On your device, tap the Record button, speak your answer, then tap again to submit.`,
};

function buildBuzzinAnswerAnnouncement(topic, displayName, speakLangCode = "en") {
  const lang = String(speakLangCode || "en").trim().toLowerCase().split(/[-_]/)[0];
  const template = TEMPLATES[lang] || TEMPLATES.en;
  const question =
    String(topic || "").trim() ||
    (lang === "yue" ? "你嘅問題" : lang === "zh" ? "你的问题" : "your question");
  const name = String(displayName || "Student").trim() || "Student";
  return template({ question, name });
}

module.exports = { buildBuzzinAnswerAnnouncement };
