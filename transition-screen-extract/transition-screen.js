(function installLangoTransitionScreen(global) {
  "use strict";

  const scriptUrl = document.currentScript?.src;
  const packageBaseUrl = scriptUrl
    ? new URL(".", scriptUrl)
    : new URL("./", global.location.href);
  const defaultImageUrl = new URL(
    "assets/uncletommy-transitionscreen.png",
    packageBaseUrl
  ).href;

  const DEFAULT_DURATION = 2600;
  const DEFAULT_COVERED_AT = 420;
  let transitionQueue = Promise.resolve();
  let layer = null;

  function wait(milliseconds) {
    return new Promise((resolve) => global.setTimeout(resolve, milliseconds));
  }

  function waitForBody() {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  function emit(name, detail) {
    global.dispatchEvent(
      new CustomEvent(`lango-transition:${name}`, { detail })
    );
  }

  function getLayer() {
    if (layer?.isConnected) return layer;

    layer = document.createElement("div");
    layer.className = "lango-transition-screen";
    layer.dataset.fit = "cover";
    layer.setAttribute("aria-hidden", "true");

    const image = document.createElement("img");
    image.className = "lango-transition-screen__image";
    image.src = defaultImageUrl;
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;

    layer.appendChild(image);
    document.body.appendChild(layer);
    return layer;
  }

  function normalizeOptions(input) {
    if (typeof input === "function") return { onCovered: input };
    return input && typeof input === "object" ? input : {};
  }

  async function runTransition(input) {
    const options = normalizeOptions(input);
    const duration = Math.max(1, Number(options.duration) || DEFAULT_DURATION);
    const coveredAt = Math.min(
      duration,
      Math.max(0, Number(options.coveredAt) || DEFAULT_COVERED_AT)
    );
    const respectsReducedMotion = options.respectReducedMotion !== false;
    const reduceMotion =
      respectsReducedMotion &&
      global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (reduceMotion) {
      await options.onCovered?.();
      return;
    }

    await waitForBody();
    const overlay = getLayer();
    const image = overlay.querySelector(".lango-transition-screen__image");

    image.src = options.imageUrl || defaultImageUrl;
    overlay.dataset.fit = options.fit === "contain" ? "contain" : "cover";
    overlay.style.setProperty("--lango-transition-duration", `${duration}ms`);
    overlay.classList.remove("is-playing");
    void overlay.offsetWidth;

    const startedAt = performance.now();
    overlay.classList.add("is-playing");
    emit("start", { duration, coveredAt });

    try {
      await wait(coveredAt);
      emit("covered", { duration, coveredAt });
      await options.onCovered?.();

      const elapsed = performance.now() - startedAt;
      await wait(Math.max(0, duration - elapsed));
    } finally {
      overlay.classList.remove("is-playing");
      emit("end", { duration, coveredAt });
    }
  }

  function play(options) {
    transitionQueue = transitionQueue
      .catch(() => {})
      .then(() => runTransition(options));
    return transitionQueue;
  }

  function destroy() {
    layer?.remove();
    layer = null;
  }

  global.LangoTransitionScreen = Object.freeze({
    play,
    destroy,
    defaultImageUrl,
  });
})(window);
