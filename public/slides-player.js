// Plays a "slides" exercise on the host screen: one slide at a time, bullets
// that come in one by one, optional picture and optional voice clip. It looks
// and moves like the Uncle Tommy lecture (lecture-player.js): the same reveal
// styles (blur, rise, pop, highlighter), the same 0.3 s "out" before a change,
// and rings and pills that glide to new places when the layout changes between
// a title card and a content slide.
//
//   const player = LangoSlidesPlayer.mount(element, exercise, { onEnd });
//   player.destroy();
//
// Everything teachers type is put in with textContent, never as HTML.
(function installLangoSlidesPlayer(global) {
  "use strict";

  const STAGE_W = 1280;
  const STAGE_H = 720;
  // GSAP's eases as cubic-beziers, with the lecture's durations (STYLES in lecture-player.js).
  const OUT_MS = 300; // out:   power3.in
  const EASE_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)"; // up: expo.out, 0.6 s
  const EASE_POWER4 = "cubic-bezier(0.165, 0.84, 0.44, 1)"; // blur: power4.out, 0.35 s
  const EASE_POWER3_IN = "cubic-bezier(0.55, 0.055, 0.675, 0.19)";
  const EASE_BACK = "cubic-bezier(0.34, 1.6, 0.64, 1)"; // pop: back.out, 0.55 s
  const EASE_INOUT = "ease-in-out"; // mark: power2.inOut, 0.5 s
  const DECOR = ["ring-pu", "ring-ye", "ring-te", "ring-bl", "pill-pu", "pill-ye", "pill-ma"];

  function t(key, vars, fallback) {
    const text = global.LangoI18n?.t?.(key, vars);
    return text && text !== key ? text : fallback;
  }

  function resolve(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    return typeof global.resolvedMediaUrl === "function" ? global.resolvedMediaUrl(value) : value;
  }

  function reducedMotion() {
    return Boolean(global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  // Runs a Web Animation unless the visitor asked for less motion.
  function move(node, keyframes, options) {
    if (!node || reducedMotion() || typeof node.animate !== "function") return null;
    return node.animate(keyframes, { fill: "backwards", ...options });
  }

  function slidesOf(exercise) {
    return (Array.isArray(exercise?.items) ? exercise.items : [])
      .map((item) => ({
        title: String(item?.title || "").trim(),
        bullets: (Array.isArray(item?.bullets) ? item.bullets : [])
          .map((line) => String(line || "").trim())
          .filter(Boolean),
        image: String(item?.image || "").trim(),
        audioUrl: String(item?.audioUrl || "").trim(),
      }))
      .filter((slide) => slide.title || slide.bullets.length || slide.image);
  }

  // A slide with only a title is a "title card"; the rest are "content" slides.
  function layoutOf(slide) {
    return slide && !slide.bullets.length && !slide.image ? "card" : "content";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mount(container, exercise, options = {}) {
    const slides = slidesOf(exercise);
    const narrate = exercise?.narrate !== false;
    const root = el("div", "lsp");
    const frame = el("div", "lsp-frame");
    const stage = el("div", "lsp-stage");
    const decor = el("div", "lsp-decor");
    decor.setAttribute("aria-hidden", "true");
    DECOR.forEach((name) => decor.append(el("span", `lsp-d lsp-${name}`)));
    const slideEl = el("section", "lsp-slide");
    const titleEl = el("h2", "lsp-title");
    const bodyEl = el("div", "lsp-body");
    const listEl = el("ul", "lsp-bullets");
    const figure = el("figure", "lsp-figure");
    const img = el("img", "lsp-image");
    img.alt = "";
    figure.append(img);
    bodyEl.append(listEl, figure);
    slideEl.append(titleEl, bodyEl);
    stage.append(decor, slideEl);
    frame.append(stage);

    const bar = el("div", "lsp-bar");
    const prevBtn = el("button", "lsp-btn lsp-prev");
    prevBtn.type = "button";
    prevBtn.setAttribute("aria-label", t("slides.prev", null, "Previous"));
    prevBtn.append(el("span", "lsp-arrow lsp-arrow-left"));
    const dots = el("div", "lsp-dots");
    const status = el("p", "lsp-status");
    status.setAttribute("aria-live", "polite");
    const nextBtn = el("button", "lsp-btn lsp-next");
    nextBtn.type = "button";
    nextBtn.setAttribute("aria-label", t("slides.next", null, "Next"));
    nextBtn.append(el("span", "lsp-arrow lsp-arrow-right"));
    bar.append(prevBtn, dots, status, nextBtn);
    root.append(frame, bar);
    container.replaceChildren(root);

    let index = 0;
    let shown = 0;
    let audio = null;
    let ended = false;
    let destroyed = false;
    let advanceTimer = 0;
    let swapId = 0;
    let pending = false;
    let bulletTimers = [];
    const autoAdvance = options.autoAdvance !== false;

    const dotEls = slides.map((_, i) => {
      const dot = el("button", "lsp-dot");
      dot.type = "button";
      dot.setAttribute("aria-label", t("slides.goTo", { n: i + 1 }, `Slide ${i + 1}`));
      dot.addEventListener("click", () => go(i));
      dots.append(dot);
      return dot;
    });

    function cancelAdvance() {
      clearTimeout(advanceTimer);
      advanceTimer = 0;
    }

    function stopAudio() {
      cancelAdvance();
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio = null;
    }

    function playAudio(slide) {
      stopAudio();
      const url = narrate ? resolve(slide?.audioUrl) : "";
      if (!url) return;
      const clip = new Audio(url);
      audio = clip;
      // With a voice, the deck turns the page by itself after a short pause. Any
      // press of Next, Back or a dot cancels it, and the teacher stays in charge.
      if (autoAdvance) {
        clip.addEventListener("ended", () => {
          if (destroyed || audio !== clip) return;
          cancelAdvance();
          advanceTimer = setTimeout(() => {
            if (!destroyed && audio === clip) forward();
          }, 1500);
        });
      }
      clip.play().catch(() => {
        /* The browser may block autoplay; the teacher can press Next. */
      });
    }

    function clearBulletTimers() {
      bulletTimers.forEach(clearTimeout);
      bulletTimers = [];
    }

    // stagger: the points come in one after another instead of already being there.
    function render({ stagger = false } = {}) {
      const slide = slides[index];
      if (!slide) return;
      clearBulletTimers();
      titleEl.textContent = slide.title;
      const items = slide.bullets.map((line) => el("li", "lsp-bullet", line));
      listEl.replaceChildren(...items);
      items.forEach((li, i) => {
        if (i >= shown) return;
        if (!stagger || reducedMotion()) li.classList.add("is-in");
        else bulletTimers.push(setTimeout(() => li.classList.add("is-in"), 520 + i * 260));
      });
      slideEl.classList.toggle("has-image", Boolean(slide.image));
      slideEl.classList.toggle("has-bullets", slide.bullets.length > 0);
      slideEl.classList.toggle("has-title", Boolean(slide.title));
      slideEl.classList.toggle("is-card", layoutOf(slide) === "card");
      if (slide.image) img.src = resolve(slide.image);
      else img.removeAttribute("src");
      dotEls.forEach((dot, i) => {
        dot.classList.toggle("is-current", i === index);
        dot.classList.toggle("is-done", i < index);
        if (i === index) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
      status.textContent = t("slides.progress", { n: index + 1, total: slides.length }, `${index + 1} / ${slides.length}`);
      prevBtn.disabled = index === 0 && shown === 0;
      root.classList.toggle("is-last", index === slides.length - 1 && shown >= slide.bullets.length);
    }

    // What moves when a slide arrives, as in the lecture: a content slide's title
    // blurs in at 0.2 s, a title card rises in; the highlighter strokes under
    // the title and the picture pops in.
    function enter() {
      if (layoutOf(slides[index]) === "card") {
        move(titleEl, [
          { opacity: 0, transform: "translateY(28px)", filter: "blur(6px)" },
          { opacity: 1, transform: "none", filter: "blur(0px)" },
        ], { duration: 600, delay: 200, easing: EASE_EXPO });
      } else {
        move(titleEl, [
          { opacity: 0, filter: "blur(10px)" },
          { opacity: 1, filter: "blur(0px)" },
        ], { duration: 350, delay: 200, easing: EASE_POWER4 });
      }
      move(titleEl, [{ backgroundSize: "0% 100%" }, { backgroundSize: "100% 100%" }], {
        duration: 500,
        delay: 550,
        easing: EASE_INOUT,
      });
      move(figure, [
        { opacity: 0, transform: "scale(0.6)" },
        { opacity: 1, transform: "none" },
      ], { duration: 550, delay: 450, easing: EASE_BACK });
    }

    // The rings and pills glide to the other layout only when the layout changes.
    function setLayout() {
      stage.dataset.layout = layoutOf(slides[index]);
    }

    // Slide out (blur and rise), then slide in. A newer change overtakes an older
    // one, and what finally shows is always the latest state.
    function swap(applyState) {
      const id = ++swapId;
      const finish = () => {
        if (destroyed || id !== swapId) return;
        pending = false;
        applyState();
        enter();
      };
      const out = move(slideEl, [
        { opacity: 1, transform: "none", filter: "blur(0px)" },
        { opacity: 0, transform: "translateY(-18px)", filter: "blur(8px)" },
      ], { duration: OUT_MS, easing: EASE_POWER3_IN, fill: "forwards" });
      pending = true;
      if (!out) {
        finish();
        return;
      }
      out.finished
        .then(() => {
          if (id === swapId) out.cancel();
          finish();
        })
        .catch(() => {
          /* cancelled by a newer change */
        });
    }

    function show(target, { revealAll }) {
      index = target;
      const slide = slides[index];
      shown = revealAll || (slide.audioUrl && narrate) ? slide.bullets.length : 0;
      setLayout();
      swap(() => {
        render({ stagger: shown > 0 });
        playAudio(slide);
      });
    }

    function go(target) {
      cancelAdvance();
      const next = Math.max(0, Math.min(slides.length - 1, target));
      if (next !== index) {
        show(next, { revealAll: true });
        return;
      }
      // The same slide again: show it complete.
      shown = slides[index] ? slides[index].bullets.length : 0;
      if (!pending) render();
      if (!audio) playAudio(slides[index]);
    }

    function forward() {
      cancelAdvance();
      const slide = slides[index];
      if (!slide) return;
      if (shown < slide.bullets.length) {
        shown += 1;
        if (!pending) render();
        return;
      }
      if (index < slides.length - 1) {
        show(index + 1, { revealAll: false });
        return;
      }
      if (!ended) {
        ended = true;
        options.onEnd?.();
        root.dispatchEvent(new CustomEvent("slides-ended", { bubbles: true }));
      }
    }

    function back() {
      cancelAdvance();
      const slide = slides[index];
      if (shown > 0 && !(narrate && slide?.audioUrl)) {
        shown -= 1;
        if (!pending) render();
        return;
      }
      if (index > 0) go(index - 1);
    }

    function onKey(event) {
      if (destroyed || event.defaultPrevented) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        forward();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        back();
      }
    }

    function fit() {
      const w = frame.clientWidth;
      const h = frame.clientHeight;
      if (!w || !h) return;
      const scale = Math.min(w / STAGE_W, h / STAGE_H);
      stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }

    prevBtn.addEventListener("click", back);
    nextBtn.addEventListener("click", forward);
    stage.addEventListener("click", forward);
    document.addEventListener("keydown", onKey);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(frame);
    global.addEventListener("resize", fit);

    if (!slides.length) {
      titleEl.textContent = "";
      status.textContent = "";
    } else {
      const first = slides[0];
      shown = first.audioUrl && narrate ? first.bullets.length : 0;
      setLayout();
      render({ stagger: shown > 0 });
      enter();
      playAudio(first);
    }
    fit();
    requestAnimationFrame(fit);

    return {
      get index() {
        return index;
      },
      count: slides.length,
      next: forward,
      prev: back,
      goTo: go,
      destroy() {
        destroyed = true;
        swapId += 1;
        clearBulletTimers();
        stopAudio();
        document.removeEventListener("keydown", onKey);
        global.removeEventListener("resize", fit);
        observer?.disconnect();
        container.replaceChildren();
      },
    };
  }

  global.LangoSlidesPlayer = { mount, slidesOf };
})(typeof window !== "undefined" ? window : globalThis);
