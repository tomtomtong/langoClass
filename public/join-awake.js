// Two small things that keep a phone working through a class (the students' join page):
//  1. The screen stays on. A student who sits and listens for a few minutes would otherwise see the
//     phone go dark, lose the connection and miss the next question.
//  2. The microphone is switched on once, with a kind card, after they have joined. The browser's
//     own permission box appears the first time anything records, which is the worst moment (a
//     question is open and the clock is running), and a wrong tap on "Don't allow" blocks the class.
(function () {
  "use strict";

  const MIC_FLAG = "lango_mic_ready";
  const t = (key) => window.LangoI18n?.t?.(key) ?? key;

  // ---- Screen stays on ----
  let lock = null;
  async function keepAwake() {
    if (lock || document.visibilityState !== "visible" || !navigator.wakeLock?.request) return;
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => {
        lock = null;
      });
    } catch {
      /* not allowed here (battery saver, older browser): the class still works */
    }
  }
  document.addEventListener("visibilitychange", () => void keepAwake());
  // Some browsers only allow it after a tap.
  document.addEventListener("pointerdown", () => void keepAwake(), { passive: true });
  void keepAwake();

  // ---- Microphone, asked for once, kindly ----
  async function micState() {
    try {
      const status = await navigator.permissions?.query({ name: "microphone" });
      if (status?.state) return status.state; // granted, prompt or denied
    } catch {
      /* Safari cannot ask: fall back to what we remember */
    }
    try {
      return localStorage.getItem(MIC_FLAG) === "1" ? "granted" : "prompt";
    } catch {
      return "prompt";
    }
  }

  function removeCard() {
    document.getElementById("join-mic-card")?.remove();
  }

  function showCard(blocked) {
    if (document.getElementById("join-mic-card")) return;
    const card = document.createElement("div");
    card.id = "join-mic-card";
    card.className = "join-mic-card";
    card.setAttribute("role", "dialog");
    const title = document.createElement("h3");
    title.textContent = t("join.micTitle");
    const body = document.createElement("p");
    body.textContent = t(blocked ? "join.micBlocked" : "join.micBody");
    card.append(title, body);
    if (!blocked) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "join-mic-btn";
      button.textContent = `🎤 ${t("join.micButton")}`;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
          try {
            localStorage.setItem(MIC_FLAG, "1");
          } catch {
            /* private mode */
          }
          title.textContent = `✅ ${t("join.micDone")}`;
          body.remove();
          button.remove();
          setTimeout(removeCard, 1800);
        } catch {
          card.remove();
          showCard(true);
        }
      });
      card.append(button);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "join-mic-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.addEventListener("click", removeCard);
    card.append(close);
    document.body.append(card);
  }

  // Offer it once the student is in the room (the "You: name" badge appears), never before.
  let offered = false;
  const timer = setInterval(async () => {
    const badge = document.getElementById("join-name-badge");
    if (offered || !badge || badge.hidden || !navigator.mediaDevices?.getUserMedia) return;
    offered = true;
    clearInterval(timer);
    const state = await micState();
    if (state === "granted") return;
    showCard(state === "denied");
  }, 1000);
})();
