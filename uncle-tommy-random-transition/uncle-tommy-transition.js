(function installUncleTommyTransition(global) {
  "use strict";

  const scriptUrl = document.currentScript?.src;
  const packageBaseUrl = scriptUrl
    ? new URL(".", scriptUrl)
    : new URL("./", global.location.href);
  const defaultImageUrls = [1, 2, 3, 4].map(
    (pose) => new URL(`assets/user_uncletommy_${pose}.png`, packageBaseUrl).href
  );

  const DEFAULT_DURATION = 1180;
  const DEFAULT_COVERED_AT = 920;
  let transitionQueue = Promise.resolve();
  let previousPoseIndex = -1;
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
      new CustomEvent(`uncle-tommy-transition:${name}`, { detail })
    );
  }

  function getLayer() {
    if (layer?.isConnected) return layer;

    layer = document.createElement("div");
    layer.className = "uncle-tommy-transition";
    layer.setAttribute("aria-hidden", "true");

    const cast = document.createElement("div");
    cast.className = "uncle-tommy-transition__cast";

    defaultImageUrls.forEach((src, index) => {
      const image = document.createElement("img");
      image.className = "uncle-tommy-transition__character";
      image.src = src;
      image.alt = "";
      image.decoding = "async";
      image.loading = "eager";
      image.draggable = false;
      image.dataset.pose = String(index + 1);
      cast.appendChild(image);
    });

    layer.appendChild(cast);
    document.body.appendChild(layer);
    return layer;
  }

  function selectPose(overlay, requestedPose) {
    const characters = [...overlay.querySelectorAll(".uncle-tommy-transition__character")];
    let nextIndex = Number(requestedPose) - 1;

    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= characters.length) {
      nextIndex = Math.floor(Math.random() * characters.length);
      if (characters.length > 1 && nextIndex === previousPoseIndex) {
        nextIndex =
          (nextIndex + 1 + Math.floor(Math.random() * (characters.length - 1))) %
          characters.length;
      }
    }

    previousPoseIndex = nextIndex;
    characters.forEach((character, index) => {
      character.classList.toggle("is-active", index === nextIndex);
    });
    return nextIndex + 1;
  }

  function normalizeOptions(input) {
    if (typeof input === "function") return { onCovered: input };
    return input && typeof input === "object" ? input : {};
  }

  async function runTransition(input) {
    const options = normalizeOptions(input);
    const duration = Math.max(300, Number(options.duration) || DEFAULT_DURATION);
    const coveredAt = Math.min(
      duration,
      Math.max(0, Number(options.coveredAt) || DEFAULT_COVERED_AT)
    );
    const reduceMotion =
      options.respectReducedMotion !== false &&
      global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (reduceMotion) {
      await options.onCovered?.();
      return null;
    }

    await waitForBody();
    const overlay = getLayer();
    const pose = selectPose(overlay, options.pose);

    overlay.style.setProperty("--uncle-tommy-transition-duration", `${duration}ms`);
    overlay.style.setProperty(
      "--uncle-tommy-character-duration",
      `${Math.max(200, duration - 100)}ms`
    );
    overlay.classList.remove("is-playing");
    void overlay.offsetWidth;

    const startedAt = performance.now();
    overlay.classList.add("is-playing");
    emit("start", { duration, coveredAt, pose });

    try {
      await wait(coveredAt);
      emit("covered", { duration, coveredAt, pose });
      await options.onCovered?.(pose);

      const elapsed = performance.now() - startedAt;
      await wait(Math.max(0, duration - elapsed));
      return pose;
    } finally {
      overlay.classList.remove("is-playing");
      emit("end", { duration, coveredAt, pose });
    }
  }

  function play(options) {
    transitionQueue = transitionQueue
      .catch(() => {})
      .then(() => runTransition(options));
    return transitionQueue;
  }

  function preload() {
    defaultImageUrls.forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }

  function destroy() {
    layer?.remove();
    layer = null;
    previousPoseIndex = -1;
  }

  global.UncleTommyTransition = Object.freeze({
    play,
    preload,
    destroy,
    imageUrls: [...defaultImageUrls],
  });
})(window);
