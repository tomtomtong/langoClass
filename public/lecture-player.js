// Plays a Lango lecture (lecture.json from scripts/export-lecture.mjs) live in the browser:
// scene HTML with GSAP reveals cued to the ElevenLabs character timings, voice through Web Audio.
// Timing follows Uncle toomy vrm/tools/build.mjs, so the lecture never has to be rendered to MP4.
//
//   const player = await LangoLecturePlayer.mount(element, "/uploads/lectures/<id>/lecture.json");
//   element.addEventListener("lecture-ended", ...);
//
// The lecture's HTML and CSS are inserted as they are, so only load lectures we made.
(function installLangoLecturePlayer(global) {
  "use strict";

  const SCRIPT_URL = document.currentScript?.src || global.location.href;
  const STAGE_W = 1920;
  const STAGE_H = 1080;
  const LEAD = 0.35;
  const TAIL = 0.75;

  const STYLES = {
    up: [{ opacity: 0, y: 28, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "expo.out" }],
    blur: [{ opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.35, ease: "power4.out" }],
    pop: [{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.8)" }],
    strike: [{ scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power2.inOut" }],
    mark: [{ backgroundSize: "0% 100%" }, { backgroundSize: "100% 100%", duration: 0.5, ease: "power2.inOut" }],
    out: [{ opacity: 1, y: 0, filter: "blur(0px)" }, { opacity: 0, y: -18, filter: "blur(8px)", duration: 0.3, ease: "power3.in", immediateRender: false }],
  };

  // A = big Uncle Tommy on the right (title cards), B = small Tommy bottom-right (content slides).
  const POS = {
    tommy: { A: { x: 0, y: 0, scale: 1 }, B: { x: 230, y: 290, scale: 0.48 } },
    "tommy-deco": { A: { opacity: 1 }, B: { opacity: 0 } },
    blob: { A: { opacity: 0 }, B: { opacity: 1 } },
    "ring-pu": { A: { x: 0, y: 0 }, B: { x: 820, y: 770 } },
    "ring-ye": { A: { x: 0, y: 0 }, B: { x: 520, y: -150 } },
    "ring-te": { A: { x: 0, y: 0 }, B: { x: 620, y: -40 } },
    "ring-bl": { A: { x: 0, y: 0, opacity: 0 }, B: { x: 0, y: 0, opacity: 1 } },
  };

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
    fullscreen:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  };

  const BACKDROP = `
    <div id="bg-ground">
      <svg id="blob" viewBox="0 0 1920 1080" width="1920" height="1080"><path d="M 760 0 L 1920 0 L 1920 820 C 1800 800 1700 700 1640 600 C 1560 470 1500 420 1360 380 C 1180 330 1060 300 960 200 C 880 120 800 70 760 0 Z" fill="#eef4fc"/></svg>
      <div class="ring" id="ring-pu"></div>
      <div class="ring" id="ring-ye"></div>
      <div class="ring" id="ring-te"></div>
      <div class="ring" id="ring-bl"></div>
    </div>
    <div id="tommy">
      <div id="tommy-deco">
        <div class="pillshape" id="pill-pu"></div>
        <div class="pillshape" id="pill-ye"></div>
        <div class="pillshape" id="pill-ma"></div>
      </div>
      <div id="tommy-frame"></div>
    </div>`;

  const r3 = (n) => Math.round(n * 1000) / 1000;
  const clock = (s) => {
    const whole = Math.max(0, Math.floor(s));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };

  // Seconds into a scene's voice where `cue` is spoken: a number, or a phrase of the narration ("phrase#2" = 2nd time).
  function cueTime(scene, cue) {
    if (typeof cue === "number") return cue;
    const [phrase, nth = "1"] = String(cue).split("#");
    let idx = -1;
    for (let i = 0; i < Number(nth); i += 1) {
      idx = scene.narration.indexOf(phrase, idx + 1);
      if (idx < 0) throw new Error(`cue "${cue}" is not in the narration of scene ${scene.id}`);
    }
    return scene.alignment.character_start_times_seconds[idx];
  }

  function decode(ctx, data) {
    // Callback form: older Safari has no promise version.
    return new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
  }

  class LecturePlayer {
    constructor(host, src) {
      this.host = host;
      this.src = src;
      this.root = host.shadowRoot || host.attachShadow({ mode: "open" });
      this.scenes = [];
      this.sources = [];
      this.duration = 0;
      this.position = 0;
      this.playing = false;
      this.resumeAfterScrub = false;
      this.idleTimer = 0;
      this.tick = this.tick.bind(this);
      this.renderShell();
    }

    url(rel) {
      return new URL(rel, this.src).href;
    }

    renderShell() {
      const asset = (name) => new URL(name, SCRIPT_URL).href;
      this.root.innerHTML = `
        <link rel="stylesheet" href="${asset("lecture-stage.css")}" />
        <link rel="stylesheet" href="${asset("lecture-player.css")}" />
        <style data-lecture-css></style>
        <div class="frame" tabindex="0" role="region">
          <div class="stage">${BACKDROP}</div>
          <button class="overlay loading" type="button" disabled>
            <span class="spinner"></span><span class="overlay-text">Loading lecture…</span>
          </button>
          <div class="controls">
            <button class="ctl" type="button" data-act="toggle" aria-label="Play">${ICONS.play}</button>
            <span class="time">0:00 / 0:00</span>
            <input class="scrub" type="range" min="0" max="0" step="0.01" value="0" aria-label="Seek" />
            <button class="ctl" type="button" data-act="fullscreen" aria-label="Full screen">${ICONS.fullscreen}</button>
          </div>
        </div>`;

      const q = (sel) => this.root.querySelector(sel);
      this.frame = q(".frame");
      this.stage = q(".stage");
      this.overlay = q(".overlay");
      this.toggleBtn = q('[data-act="toggle"]');
      this.timeEl = q(".time");
      this.scrub = q(".scrub");

      this.overlay.addEventListener("click", () => this.play());
      this.toggleBtn.addEventListener("click", () => this.toggle());
      q('[data-act="fullscreen"]').addEventListener("click", () => this.toggleFullscreen());
      this.stage.addEventListener("click", () => this.toggle());
      this.scrub.addEventListener("pointerdown", () => {
        if (this.playing) {
          this.resumeAfterScrub = true;
          this.pause();
        }
      });
      this.scrub.addEventListener("input", () => this.seek(Number(this.scrub.value)));
      this.scrub.addEventListener("change", () => {
        if (this.resumeAfterScrub) this.play();
        this.resumeAfterScrub = false;
      });
      this.frame.addEventListener("keydown", (event) => this.onKey(event));
      this.frame.addEventListener("pointermove", () => this.wake());

      this.resizer = new ResizeObserver(([entry]) => this.fit(entry.contentRect.width, entry.contentRect.height));
      this.resizer.observe(this.frame);
    }

    async load(lecture) {
      const gsap = global.gsap;
      this.lecture = lecture;
      this.frame.setAttribute("aria-label", lecture.title || "Lecture");
      this.root.querySelector("[data-lecture-css]").textContent = lecture.css || "";

      if (lecture.logo) {
        const logo = document.createElement("img");
        logo.id = "logo";
        logo.alt = "Lango";
        logo.src = this.url(lecture.logo);
        this.root.querySelector("#bg-ground").appendChild(logo);
      }
      const tommyFrame = this.root.querySelector("#tommy-frame");
      const tommyVideo = (src) => {
        const video = document.createElement("video");
        video.className = "tommy-vid";
        video.src = this.url(src);
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        tommyFrame.appendChild(video);
        return video;
      };
      // "gif" lectures loop one talking clip; "3d" lectures have a lip-synced clip per scene.
      if (lecture.tommy) {
        this.tommyLoop = tommyVideo(lecture.tommy);
        this.tommyLoop.loop = true;
      }

      const AudioCtx = global.AudioContext || global.webkitAudioContext;
      this.ctx = new AudioCtx();
      const buffers = await Promise.all(
        lecture.scenes.map(async (scene) => {
          const res = await fetch(this.url(scene.voice));
          if (!res.ok) throw new Error(`Voice for scene ${scene.id} failed to load (${res.status}).`);
          return decode(this.ctx, await res.arrayBuffer());
        })
      );

      let t = 0;
      this.scenes = lecture.scenes.map((scene, i) => {
        const lead = scene.lead ?? LEAD;
        const voice = buffers[i].duration;
        const dur = r3(lead + voice + (scene.tail ?? TAIL));
        const el = document.createElement("div");
        el.className = "scene";
        const body =
          scene.layout === "B"
            ? `<h1 class="title" id="${scene.id}-title">${scene.title || ""}</h1><div class="body">${scene.html}</div>`
            : scene.html;
        el.innerHTML = `<div class="scene-root"><div class="content" id="${scene.id}-content">${body}</div></div>`;
        this.stage.appendChild(el);
        const timed = { ...scene, lead, voice, dur, start: r3(t), buffer: buffers[i], el };
        if (scene.tommy) {
          timed.tommyEl = tommyVideo(scene.tommy);
          timed.tommyEl.style.visibility = i === 0 ? "visible" : "hidden";
        }
        t += dur;
        return timed;
      });
      this.duration = r3(t);
      this.timeline = this.buildTimeline(gsap);
      this.timeline.time(0);

      this.scrub.max = String(this.duration);
      this.updateUi();
      this.showOverlay("play", "Play lecture");
      this.host.dispatchEvent(new CustomEvent("lecture-ready", { detail: { duration: this.duration } }));
    }

    buildTimeline(gsap) {
      const tl = gsap.timeline({ paused: true });
      const add = (timeline, scope, sel, style, at) => {
        const targets = scope.querySelectorAll(sel);
        if (!targets.length || !style) {
          console.warn(`[lecture] nothing to animate for ${sel}`);
          return;
        }
        timeline.fromTo(targets, { ...style[0] }, { ...style[1] }, at);
      };

      // The first scene and layout are on screen from the start; later ones are switched on by the timeline.
      const first = this.scenes[0];
      first.el.style.visibility = "visible";
      for (const [id, st] of Object.entries(POS)) {
        const el = this.root.getElementById?.(id) || this.root.querySelector(`#${id}`);
        if (el) gsap.set(el, st[first.layout] || st.B);
      }

      this.scenes.forEach((scene, i) => {
        const last = i === this.scenes.length - 1;
        const shown = [scene.el, scene.tommyEl].filter(Boolean);
        if (i > 0) tl.set(shown, { visibility: "visible" }, scene.start);
        if (!last) tl.set(shown, { visibility: "hidden" }, r3(scene.start + scene.dur));

        const st = gsap.timeline();
        if (scene.title && scene.layout === "B") add(st, scene.el, `#${scene.id}-title`, STYLES.blur, 0.2);
        for (const [sel, cue, style, offset = 0] of scene.reveals || []) {
          let at;
          try {
            at = r3(Math.max(0.1, scene.lead + cueTime(scene, cue) - 0.08 + offset));
          } catch (error) {
            console.warn(`[lecture] ${error.message}`);
            continue;
          }
          add(st, scene.el, sel, STYLES[style], at);
        }
        if (!last) add(st, scene.el, `#${scene.id}-content`, STYLES.out, r3(scene.dur - 0.4));
        tl.add(st, scene.start);
      });

      for (let i = 1; i < this.scenes.length; i += 1) {
        const from = this.scenes[i - 1].layout;
        const to = this.scenes[i].layout;
        if (from === to || !POS.tommy[from] || !POS.tommy[to]) continue;
        const at = r3(this.scenes[i].start - 0.45);
        for (const [id, st] of Object.entries(POS)) {
          const el = this.root.querySelector(`#${id}`);
          if (el) tl.fromTo(el, { ...st[from] }, { ...st[to], duration: 0.9, ease: "power2.inOut", immediateRender: false }, at);
        }
      }
      tl.set({}, {}, this.duration);
      return tl;
    }

    now() {
      return this.playing ? this.ctx.currentTime - this.clockStart : this.position;
    }

    play() {
      if (this.playing || !this.timeline) return;
      if (this.position >= this.duration - 0.05) this.seek(0);
      // resume() must start inside the click for Safari, so nothing is awaited before it.
      const resumed = this.ctx.resume();
      this.clockStart = this.ctx.currentTime - this.position;
      this.playing = true;
      this.hideOverlay();
      resumed.then(() => {
        if (!this.playing) return;
        this.clockStart = this.ctx.currentTime - this.position;
        this.scheduleVoices(this.position);
        global.gsap.ticker.add(this.tick);
        this.syncTommy();
      });
      this.updateUi();
      this.wake();
    }

    pause() {
      if (!this.playing) return;
      this.position = Math.min(this.now(), this.duration);
      this.playing = false;
      global.gsap.ticker.remove(this.tick);
      this.stopVoices();
      this.syncTommy();
      this.updateUi();
      this.wake();
    }

    toggle() {
      if (this.playing) this.pause();
      else this.play();
    }

    seek(seconds) {
      const t = Math.max(0, Math.min(this.duration, seconds));
      this.position = t;
      if (this.playing) {
        this.clockStart = this.ctx.currentTime - t;
        this.scheduleVoices(t);
      }
      this.timeline?.time(t);
      this.syncTommy();
      this.updateUi();
    }

    tick() {
      const t = this.now();
      if (t >= this.duration) {
        this.finish();
        return;
      }
      this.timeline.time(t);
      this.syncTommy();
      this.updateUi();
    }

    finish() {
      this.pause();
      this.seek(this.duration);
      this.showOverlay("replay", "Watch again");
      this.host.dispatchEvent(new CustomEvent("lecture-ended"));
    }

    scheduleVoices(from) {
      this.stopVoices();
      const now = this.ctx.currentTime;
      for (const scene of this.scenes) {
        const voiceStart = scene.start + scene.lead;
        if (voiceStart + scene.voice <= from) continue;
        const source = this.ctx.createBufferSource();
        source.buffer = scene.buffer;
        source.connect(this.ctx.destination);
        source.start(now + Math.max(0, voiceStart - from), Math.max(0, from - voiceStart));
        this.sources.push(source);
      }
    }

    stopVoices() {
      for (const source of this.sources) {
        try {
          source.stop();
        } catch {
          // never started
        }
        source.disconnect();
      }
      this.sources = [];
    }

    syncTommy() {
      const t = this.now();
      if (this.tommyLoop) {
        if (this.playing && this.tommyLoop.paused) this.tommyLoop.play().catch(() => {});
        if (!this.playing && !this.tommyLoop.paused) this.tommyLoop.pause();
      }
      for (const scene of this.scenes) {
        const video = scene.tommyEl;
        if (!video) continue;
        const inside = t >= scene.start && t < scene.start + scene.dur;
        const want = t - scene.start;
        if (!inside || !this.playing) {
          if (!video.paused) video.pause();
          if (inside) video.currentTime = want;
        } else if (video.paused) {
          video.currentTime = want;
          video.play().catch(() => {});
        } else if (Math.abs(video.currentTime - want) > 0.3) {
          video.currentTime = want;
        }
      }
    }

    updateUi() {
      const t = Math.min(this.now(), this.duration);
      this.timeEl.textContent = `${clock(t)} / ${clock(this.duration)}`;
      this.scrub.value = String(t);
      this.scrub.style.setProperty("--p", `${this.duration ? (t / this.duration) * 100 : 0}%`);
      this.toggleBtn.innerHTML = this.playing ? ICONS.pause : ICONS.play;
      this.toggleBtn.setAttribute("aria-label", this.playing ? "Pause" : "Play");
    }

    showOverlay(icon, label) {
      this.overlay.hidden = false;
      this.overlay.disabled = false;
      this.overlay.className = "overlay";
      this.overlay.setAttribute("aria-label", label);
      this.overlay.innerHTML = `<span class="overlay-icon ${icon}">${ICONS[icon]}</span><span class="overlay-text">${label}</span>`;
    }

    hideOverlay() {
      this.overlay.hidden = true;
    }

    showError(message) {
      this.overlay.hidden = false;
      this.overlay.disabled = true;
      this.overlay.className = "overlay error";
      this.overlay.textContent = message;
    }

    // Controls fade out while the lecture plays and the pointer is still.
    wake() {
      this.frame.classList.remove("idle");
      clearTimeout(this.idleTimer);
      if (this.playing) this.idleTimer = setTimeout(() => this.frame.classList.add("idle"), 2500);
    }

    onKey(event) {
      if (event.target === this.scrub && event.key.startsWith("Arrow")) return;
      const keys = {
        " ": () => this.toggle(),
        k: () => this.toggle(),
        ArrowLeft: () => this.seek(this.now() - 5),
        ArrowRight: () => this.seek(this.now() + 5),
        f: () => this.toggleFullscreen(),
      };
      const run = keys[event.key];
      if (!run) return;
      event.preventDefault();
      run();
      this.wake();
    }

    toggleFullscreen() {
      if (this.root.fullscreenElement || document.fullscreenElement) {
        document.exitFullscreen?.();
        return;
      }
      (this.frame.requestFullscreen || this.frame.webkitRequestFullscreen)?.call(this.frame);
    }

    fit(width, height) {
      const scale = Math.min(width / STAGE_W, height / STAGE_H);
      const x = (width - STAGE_W * scale) / 2;
      const y = (height - STAGE_H * scale) / 2;
      this.stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }

    destroy() {
      this.pause();
      clearTimeout(this.idleTimer);
      this.resizer.disconnect();
      this.timeline?.kill();
      this.ctx?.close();
      this.root.innerHTML = "";
    }
  }

  async function mount(host, src) {
    if (!global.gsap) throw new Error("Load GSAP before lecture-player.js.");
    const player = new LecturePlayer(host, new URL(src, global.location.href).href);
    try {
      const res = await fetch(player.src);
      if (!res.ok) throw new Error(`Lecture failed to load (${res.status}).`);
      await player.load(await res.json());
    } catch (error) {
      player.showError(error instanceof Error ? error.message : String(error));
      throw error;
    }
    return player;
  }

  global.LangoLecturePlayer = { mount };
})(window);
