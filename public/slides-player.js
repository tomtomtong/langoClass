// Plays a "slides" exercise on the host screen: one slide at a time, bullets
// that come in one by one, optional picture and optional voice clip.
//
//   const player = LangoSlidesPlayer.mount(element, exercise, { onEnd });
//   player.destroy();
//
// Everything teachers type is put in with textContent, never as HTML.
(function installLangoSlidesPlayer(global) {
  "use strict";

  const STAGE_W = 1280;
  const STAGE_H = 720;

  function t(key, vars, fallback) {
    const text = global.LangoI18n?.t?.(key, vars);
    return text && text !== key ? text : fallback;
  }

  function resolve(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    return typeof global.resolvedMediaUrl === "function" ? global.resolvedMediaUrl(value) : value;
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
    stage.append(slideEl);
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

    const dotEls = slides.map((_, i) => {
      const dot = el("button", "lsp-dot");
      dot.type = "button";
      dot.setAttribute("aria-label", t("slides.goTo", { n: i + 1 }, `Slide ${i + 1}`));
      dot.addEventListener("click", () => go(i));
      dots.append(dot);
      return dot;
    });

    function stopAudio() {
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio = null;
    }

    function playAudio(slide) {
      stopAudio();
      const url = narrate ? resolve(slide.audioUrl) : "";
      if (!url) return;
      audio = new Audio(url);
      audio.play().catch(() => {
        /* The browser may block autoplay; the teacher can press Next. */
      });
    }

    function render() {
      const slide = slides[index];
      if (!slide) return;
      titleEl.textContent = slide.title;
      listEl.replaceChildren(
        ...slide.bullets.map((line, i) => {
          const li = el("li", "lsp-bullet", line);
          if (i < shown) li.classList.add("is-in");
          return li;
        })
      );
      slideEl.classList.toggle("has-image", Boolean(slide.image));
      slideEl.classList.toggle("has-bullets", slide.bullets.length > 0);
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

    function go(target) {
      const next = Math.max(0, Math.min(slides.length - 1, target));
      const changed = next !== index;
      index = next;
      // Coming back to a slide shows it complete; a voice clip reads it whole.
      const slide = slides[index];
      shown = slide ? slide.bullets.length : 0;
      render();
      if (changed || !audio) playAudio(slide);
    }

    function forward() {
      const slide = slides[index];
      if (!slide) return;
      if (shown < slide.bullets.length) {
        shown += 1;
        render();
        return;
      }
      if (index < slides.length - 1) {
        index += 1;
        const entering = slides[index];
        shown = entering.audioUrl && narrate ? entering.bullets.length : 0;
        render();
        playAudio(entering);
        return;
      }
      if (!ended) {
        ended = true;
        options.onEnd?.();
        root.dispatchEvent(new CustomEvent("slides-ended", { bubbles: true }));
      }
    }

    function back() {
      const slide = slides[index];
      if (shown > 0 && !(narrate && slide?.audioUrl)) {
        shown -= 1;
        render();
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
      render();
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
