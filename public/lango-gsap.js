(function installLangoGsap(global) {
  "use strict";

  const gsap = global.gsap;
  if (!gsap) {
    console.warn("[lango-gsap] GSAP not found; keeping CSS animations.");
    return;
  }

  const REDUCE_MOTION =
    global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  let screenTransitionTl = null;
  let buzzinFeedbackTl = null;
  let buzzinEmptyTl = null;
  let buzzinStartTl = null;
  let waitingEnterTl = null;
  let leaderboardRevealTl = null;
  let playerLeaderboardTl = null;

  document.documentElement.classList.add("lango-gsap-ready");

  function prefersReducedMotion() {
    return (
      REDUCE_MOTION ||
      global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
    );
  }

  const LEADERBOARD_SFX = Object.freeze({
    hostFanfare: "/assets/soundeffect/login_success.mp3",
    hostPodium: "/assets/soundeffect/Page_nextbutton.mp3",
    playerCelebrate: "/assets/soundeffect/login_success.mp3",
  });

  function playLeaderboardHostSfx(src, volume = 0.85) {
    if (!src) return;
    if (typeof global.playHostSound === "function") {
      global.playHostSound(src, { volume });
      return;
    }
    try {
      const audio = new Audio(src);
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.play()?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }

  function playLeaderboardPlayerSfx(name = "celebrate", volume = 0.85) {
    if (typeof global.playPlayerSound === "function") {
      global.playPlayerSound(name, volume);
      return;
    }
    const src = LEADERBOARD_SFX.playerCelebrate;
    if (!src) return;
    try {
      const audio = new Audio(src);
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.play()?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }

  function ensureTransitionFx(layer) {
    if (!layer) return null;

    layer.classList.add("has-gsap-fx");

    let portal = layer.querySelector(".host-page-transition__portal");
    if (!portal) {
      portal = document.createElement("div");
      portal.className = "host-page-transition__portal";
      portal.setAttribute("aria-hidden", "true");
      layer.insertBefore(portal, layer.firstChild);
    }

    let sparks = layer.querySelector(".host-page-transition__sparks");
    if (!sparks) {
      sparks = document.createElement("div");
      sparks.className = "host-page-transition__sparks";
      sparks.setAttribute("aria-hidden", "true");
      portal.after(sparks);
    }

    return { portal, sparks };
  }

  function killScreenTransition() {
    if (screenTransitionTl) {
      screenTransitionTl.kill();
      screenTransitionTl = null;
    }
  }

  /**
   * Uncle Tommy portal screen transition.
   * Returns a Promise that resolves when the timeline completes.
   * Calls onCovered around the midpoint (default 0.92s of 1.18s).
   */
  function playScreenTransition(layer, { onCovered, coveredAt = 0.92, duration = 1.18 } = {}) {
    if (!layer) return Promise.resolve();
    if (prefersReducedMotion()) {
      return Promise.resolve(onCovered?.());
    }

    const fx = ensureTransitionFx(layer);
    if (!fx) return Promise.resolve(onCovered?.());

    const tommy = layer.querySelector(".join-transition-tommy.is-active");
    const { portal, sparks } = fx;

    killScreenTransition();
    gsap.killTweensOf([portal, sparks, tommy].filter(Boolean));

    layer.classList.add("is-playing");

    gsap.set(portal, { scale: 0, rotation: -28, autoAlpha: 0, force3D: true });
    gsap.set(sparks, { scale: 0.72, rotation: -8, autoAlpha: 0, force3D: true });
    if (tommy) {
      // Cast uses CSS grid centering; animate from optical center (art bias compensated).
      gsap.set(tommy, {
        x: "3%",
        y: "42%",
        scale: 0.52,
        rotation: -5,
        autoAlpha: 0,
        force3D: true,
      });
    }

    return new Promise((resolve) => {
      let covered = false;
      const cover = () => {
        if (covered) return;
        covered = true;
        try {
          onCovered?.();
        } catch (err) {
          console.error("[lango-gsap] onCovered failed", err);
        }
      };

      screenTransitionTl = gsap.timeline({
        defaults: { ease: "power2.inOut" },
        onComplete: () => {
          layer.classList.remove("is-playing");
          if (tommy) {
            gsap.set(tommy, { clearProps: "transform,opacity,visibility" });
          }
          gsap.set([portal, sparks], { clearProps: "transform,opacity,visibility" });
          screenTransitionTl = null;
          resolve();
        },
      });

      const tl = screenTransitionTl;

      tl.to(
        portal,
        { scale: 1.35, rotation: 8, autoAlpha: 1, duration: duration * 0.38, ease: "power2.inOut" },
        0
      )
        .to(portal, { rotation: 18, duration: duration * 0.38, ease: "none" }, duration * 0.38)
        .to(
          portal,
          { scale: 0, rotation: 58, autoAlpha: 0, duration: duration * 0.24, ease: "power2.in" },
          duration * 0.76
        );

      tl.to(
        sparks,
        { scale: 1.08, rotation: 8, autoAlpha: 1, duration: duration * 0.34, ease: "power2.out" },
        duration * 0.34
      ).to(
        sparks,
        { scale: 0.72, rotation: -8, autoAlpha: 0, duration: duration * 0.24, ease: "power2.in" },
        duration * 0.76
      );

      if (tommy) {
        tl.to(
          tommy,
          {
            y: "-8%",
            scale: 1.08,
            rotation: 1,
            autoAlpha: 1,
            duration: duration * 0.31,
            ease: "power3.out",
          },
          0.03
        )
          .to(
            tommy,
            { y: "2%", scale: 0.98, rotation: -1, duration: duration * 0.2, ease: "power2.inOut" },
            duration * 0.34
          )
          .to(
            tommy,
            { y: "0%", scale: 1, rotation: 0, duration: duration * 0.22, ease: "power2.out" },
            duration * 0.52
          )
          .to(
            tommy,
            {
              y: "-14%",
              scale: 0.96,
              rotation: 2,
              autoAlpha: 0,
              duration: duration * 0.2,
              ease: "power2.in",
            },
            duration * 0.78
          );
      }

      tl.add(cover, Math.min(coveredAt, duration));
    });
  }

  function playBuzzinFeedbackEnter(screen) {
    if (!screen || prefersReducedMotion()) return null;

    const title = screen.querySelector(".host-buzzin-feedback-title");
    const leaderboard = screen.querySelector(".host-buzzin-feedback-leaderboard");
    const realtime = screen.querySelector(".host-buzzin-feedback-realtime");
    const targets = [title, leaderboard, realtime].filter(Boolean);
    if (!targets.length) return null;

    if (buzzinFeedbackTl) buzzinFeedbackTl.kill();
    gsap.killTweensOf(targets);

    gsap.set(title, { y: -12, autoAlpha: 0 });
    gsap.set(leaderboard, { x: -32, autoAlpha: 0 });
    gsap.set(realtime, { x: 32, autoAlpha: 0 });

    buzzinFeedbackTl = gsap.timeline({
      defaults: { ease: "power3.out", force3D: true },
      onComplete: () => {
        gsap.set(targets, { clearProps: "transform,opacity,visibility" });
        buzzinFeedbackTl = null;
      },
    });

    if (title) buzzinFeedbackTl.to(title, { y: 0, autoAlpha: 1, duration: 0.5 }, 0);
    if (leaderboard) {
      buzzinFeedbackTl.to(leaderboard, { x: 0, autoAlpha: 1, duration: 0.58 }, 0.06);
    }
    if (realtime) {
      buzzinFeedbackTl.to(realtime, { x: 0, autoAlpha: 1, duration: 0.58 }, 0.1);
    }

    return buzzinFeedbackTl;
  }

  function playBuzzinEmptyEnter(screen) {
    if (!screen || prefersReducedMotion()) return null;

    const title = screen.querySelector(".host-buzzin-title");
    const card = screen.querySelector(".host-buzzin-empty-card");
    const targets = [title, card].filter(Boolean);
    if (!targets.length) return null;

    if (buzzinEmptyTl) buzzinEmptyTl.kill();
    gsap.killTweensOf(targets);

    gsap.set(title, { y: -10, autoAlpha: 0 });
    gsap.set(card, { y: 18, autoAlpha: 0 });

    buzzinEmptyTl = gsap.timeline({
      defaults: { ease: "power3.out", force3D: true },
      onComplete: () => {
        gsap.set(targets, { clearProps: "transform,opacity,visibility" });
        buzzinEmptyTl = null;
      },
    });

    if (title) buzzinEmptyTl.to(title, { y: 0, autoAlpha: 1, duration: 0.52 }, 0);
    if (card) buzzinEmptyTl.to(card, { y: 0, autoAlpha: 1, duration: 0.62 }, 0.08);

    return buzzinEmptyTl;
  }

  function ensureBuzzinStartBurst(screen) {
    if (!screen) return null;
    let burst = screen.querySelector(".host-buzzin-start-burst");
    if (!burst) {
      burst = document.createElement("div");
      burst.className = "host-buzzin-start-burst";
      burst.setAttribute("aria-hidden", "true");
      burst.innerHTML =
        '<span class="host-buzzin-start-burst__flash"></span><span class="host-buzzin-start-burst__ring"></span>';
      screen.appendChild(burst);
    }
    return burst;
  }

  function playBuzzinTimerPop(timerWrap) {
    if (!timerWrap || prefersReducedMotion()) return null;
    gsap.killTweensOf(timerWrap);
    gsap.set(timerWrap, { scale: 0.55, autoAlpha: 0, force3D: true });
    return gsap.to(timerWrap, {
      scale: 1,
      autoAlpha: 1,
      duration: 0.42,
      ease: "back.out(1.8)",
      force3D: true,
      onComplete: () => {
        gsap.set(timerWrap, { clearProps: "transform,opacity,visibility" });
      },
    });
  }

  /**
   * Start Buzz punch: button pop → yellow burst → question card punch.
   * Calls onBurst near the peak so join can open mid-effect.
   */
  function playBuzzinStartEffect(screen, { onBurst, burstAt = 0.28 } = {}) {
    if (!screen) {
      return Promise.resolve(onBurst?.());
    }
    if (prefersReducedMotion()) {
      return Promise.resolve(onBurst?.());
    }

    const button = screen.querySelector("#btn-host-buzzin-start");
    const card = screen.querySelector(".host-buzzin-question-card");
    const burst = ensureBuzzinStartBurst(screen);
    const flash = burst?.querySelector(".host-buzzin-start-burst__flash");
    const ring = burst?.querySelector(".host-buzzin-start-burst__ring");
    const targets = [button, card, flash, ring].filter(Boolean);

    if (buzzinStartTl) buzzinStartTl.kill();
    gsap.killTweensOf(targets);

    screen.classList.add("is-starting-buzz");
    button?.classList.remove("is-ready");

    if (burst) {
      gsap.set(burst, { autoAlpha: 1 });
    }
    if (flash) {
      gsap.set(flash, { scale: 0.2, autoAlpha: 0, force3D: true });
    }
    if (ring) {
      gsap.set(ring, { scale: 0.35, autoAlpha: 0, force3D: true });
    }
    if (button) {
      gsap.set(button, { scale: 1, force3D: true });
    }
    if (card) {
      gsap.set(card, { scale: 1, y: 0, force3D: true });
    }

    return new Promise((resolve, reject) => {
      let burstCalled = false;
      let burstPromise = Promise.resolve();
      const fireBurst = () => {
        if (burstCalled) return;
        burstCalled = true;
        burstPromise = Promise.resolve(onBurst?.()).then(() => {
          const timerWrap = screen.querySelector("#host-buzzin-timer-wrap");
          if (timerWrap && !timerWrap.hidden) {
            playBuzzinTimerPop(timerWrap);
          }
        });
      };

      buzzinStartTl = gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => {
          screen.classList.remove("is-starting-buzz");
          if (burst) gsap.set(burst, { autoAlpha: 0 });
          gsap.set(targets, { clearProps: "transform,opacity,visibility" });
          buzzinStartTl = null;
          burstPromise.then(resolve, reject);
        },
      });

      const tl = buzzinStartTl;

      if (button) {
        tl.to(button, { scale: 1.12, duration: 0.14, ease: "power2.out" }, 0);
        tl.to(button, { scale: 0.94, duration: 0.16, ease: "power2.inOut" }, 0.14);
        tl.to(button, { scale: 1, duration: 0.22, ease: "back.out(2)" }, 0.3);
      }

      if (flash) {
        tl.to(flash, { scale: 1.15, autoAlpha: 0.9, duration: 0.18, ease: "power2.out" }, 0.1);
        tl.to(flash, { scale: 2.4, autoAlpha: 0, duration: 0.42, ease: "power2.out" }, 0.26);
      }

      if (ring) {
        tl.to(ring, { scale: 0.85, autoAlpha: 0.95, duration: 0.12, ease: "power2.out" }, 0.12);
        tl.to(ring, { scale: 2.8, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 0.22);
      }

      if (card) {
        tl.to(card, { scale: 1.045, y: -6, duration: 0.16, ease: "power2.out" }, 0.18);
        tl.to(card, { scale: 1, y: 0, duration: 0.34, ease: "elastic.out(1, 0.55)" }, 0.34);
      }

      tl.add(fireBurst, Math.max(0, Number(burstAt) || 0.28));
    });
  }

  function playWaitingEnter(screen) {
    if (!screen) return null;

    screen.classList.remove("is-gsap-entered");

    if (prefersReducedMotion()) {
      screen.classList.add("is-gsap-entered");
      return null;
    }

    const wizard = screen.querySelector(".waiting-wizard");
    const panel = screen.querySelector(".waiting-students-panel");
    const targets = [wizard, panel].filter(Boolean);
    if (!targets.length) {
      screen.classList.add("is-gsap-entered");
      return null;
    }

    if (waitingEnterTl) waitingEnterTl.kill();
    gsap.killTweensOf(targets);

    gsap.set(targets, { y: 18, autoAlpha: 0 });

    waitingEnterTl = gsap.timeline({
      defaults: { ease: "power2.out", force3D: true },
      onComplete: () => {
        screen.classList.add("is-gsap-entered");
        gsap.set(targets, { clearProps: "transform,opacity,visibility" });
        waitingEnterTl = null;
      },
    });

    if (wizard) waitingEnterTl.to(wizard, { y: 0, autoAlpha: 1, duration: 0.7 }, 0);
    if (panel) waitingEnterTl.to(panel, { y: 0, autoAlpha: 1, duration: 0.65 }, 0.12);

    return waitingEnterTl;
  }

  function formatPts(n) {
    const value = Math.max(0, Number(n) || 0).toLocaleString();
    if (typeof window !== "undefined" && window.LangoI18n?.t) {
      return window.LangoI18n.t("leaderboard.pts", { n: value });
    }
    return `${value} pts`;
  }

  function countUpScore(el, target, duration = 0.55) {
    if (!el) return;
    const end = Math.max(0, Number(target) || 0);
    const usePts =
      /\bpts\b/i.test(el.textContent || "") ||
      el.classList.contains("host-leaderboard__score") ||
      el.classList.contains("player-leaderboard__score") ||
      el.classList.contains("player-leaderboard__points") ||
      el.id === "player-current-points";
    const usePct = el.classList.contains("host-fast-result-score");
    const formatValue = (n) => {
      if (usePts) return formatPts(n);
      if (usePct) return `${n}%`;
      return String(n.toLocaleString());
    };
    if (prefersReducedMotion()) {
      el.textContent = formatValue(end);
      return;
    }
    const state = { value: 0 };
    gsap.to(state, {
      value: end,
      duration,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = formatValue(Math.round(state.value));
      },
      onComplete: () => {
        el.textContent = formatValue(end);
      },
    });
  }

  /**
   * Host ceremony: Tommy + pulse (phase A), podium 3→2→1 with count-up,
   * then rankings fade in (phase B).
   */
  function playLeaderboardReveal(root, { boardRoot } = {}) {
    const screen =
      root?.classList?.contains("host-leaderboard") ||
      root?.classList?.contains("host-fast-result-screen")
        ? root
        : root?.closest?.(".host-leaderboard, .host-fast-result-screen") || root;
    const board =
      boardRoot?.querySelector?.(".host-leaderboard__arena") ||
      boardRoot?.querySelector?.(".host-fast-result-arena") ||
      screen?.querySelector?.(
        ".host-leaderboard__board:not([hidden]) .host-leaderboard__arena, .host-fast-result-board .host-fast-result-arena"
      ) ||
      root?.querySelector?.(".host-leaderboard__arena, .host-fast-result-arena") ||
      root;
    if (!board && !screen) return null;

    const tommy = screen?.querySelector?.("[data-reveal='tommy']");
    const pulse = screen?.querySelector?.("[data-reveal='pulse'], .host-fast-result-pulse, .host-mcq-result-pulse");
    const podium = [...(board?.querySelectorAll?.("[data-reveal='podium']") || [])].sort(
      (a, b) => Number(a.dataset.revealOrder || 0) - Number(b.dataset.revealOrder || 0)
    );
    const ranks = [...(board?.querySelectorAll?.("[data-reveal='rank']") || [])];
    const sheet =
      board?.querySelector?.(".host-leaderboard__sheet") ||
      board?.querySelector?.(".host-fast-result-sheet");
    const scoreEls = [...(board?.querySelectorAll?.("[data-score-value]") || [])];
    const ceremony = [tommy, pulse].filter(Boolean);

    const formatScoreEl = (el, value) => {
      const num = Number(value || 0);
      if (el.classList.contains("host-leaderboard__score")) return formatPts(num);
      if (el.classList.contains("host-fast-result-score")) return `${num}%`;
      return String(num.toLocaleString());
    };

    const finalizeScores = () => {
      scoreEls.forEach((el) => {
        el.textContent = formatScoreEl(el, el.dataset.scoreValue);
      });
    };

    if (prefersReducedMotion()) {
      finalizeScores();
      playLeaderboardHostSfx(LEADERBOARD_SFX.hostFanfare, 0.8);
      return null;
    }

    if (leaderboardRevealTl) leaderboardRevealTl.kill();
    gsap.killTweensOf([...ceremony, ...podium, ...ranks, sheet].filter(Boolean));

    if (tommy) gsap.set(tommy, { y: 28, autoAlpha: 0, scale: 0.92, force3D: true });
    if (pulse) gsap.set(pulse, { y: 12, autoAlpha: 0, force3D: true });
    if (sheet) gsap.set(sheet, { y: 48, autoAlpha: 0, force3D: true });
    gsap.set(podium, { y: 36, scale: 0.92, autoAlpha: 0, force3D: true });
    gsap.set(ranks, { y: 18, autoAlpha: 0, force3D: true });
    scoreEls.forEach((el) => {
      el.textContent = formatScoreEl(el, 0);
    });

    leaderboardRevealTl = gsap.timeline({
      defaults: { ease: "back.out(1.55)", force3D: true },
      onComplete: () => {
        gsap.set([...ceremony, ...podium, ...ranks, sheet].filter(Boolean), {
          clearProps: "transform,opacity,visibility",
        });
        leaderboardRevealTl = null;
      },
    });

    // Phase A — spotlight + fanfare
    leaderboardRevealTl.add(
      () => playLeaderboardHostSfx(LEADERBOARD_SFX.hostFanfare, 0.9),
      0
    );
    if (tommy) {
      leaderboardRevealTl.to(tommy, { y: 0, autoAlpha: 1, scale: 1, duration: 0.55 }, 0);
    }
    if (pulse) {
      leaderboardRevealTl.to(pulse, { y: 0, autoAlpha: 1, duration: 0.4, ease: "power2.out" }, 0.12);
    }

    const podiumStart = tommy || pulse ? 0.35 : 0;
    podium.forEach((row, index) => {
      const at = podiumStart + index * 0.28;
      leaderboardRevealTl.to(row, { y: 0, scale: 1, autoAlpha: 1, duration: 0.55 }, at);
      leaderboardRevealTl.add(
        () => playLeaderboardHostSfx(LEADERBOARD_SFX.hostPodium, 0.55),
        at
      );
      const scoreEl = row.querySelector("[data-score-value]");
      if (scoreEl) {
        leaderboardRevealTl.add(
          () => countUpScore(scoreEl, scoreEl.dataset.scoreValue, 0.5),
          at + 0.18
        );
      }
    });

    // Phase B — sheet + rest of class
    const ranksAt = podiumStart + Math.max(0.55, podium.length * 0.28 + 0.12);
    if (sheet) {
      leaderboardRevealTl.to(
        sheet,
        { y: 0, autoAlpha: 1, duration: 0.45, ease: "power2.out" },
        ranksAt
      );
    }
    if (ranks.length) {
      leaderboardRevealTl.to(
        ranks,
        { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.06, ease: "power2.out" },
        ranksAt + 0.08
      );
      ranks.forEach((row, index) => {
        const scoreEl = row.querySelector("[data-score-value]");
        if (scoreEl) {
          leaderboardRevealTl.add(
            () => countUpScore(scoreEl, scoreEl.dataset.scoreValue, 0.35),
            ranksAt + index * 0.06 + 0.12
          );
        }
      });
    }

    return leaderboardRevealTl;
  }

  function playPlayerLeaderboardEnter(screen) {
    if (!screen) return null;
    const me = screen.querySelector("#player-me-hero");
    const pointsEl = screen.querySelector("#player-current-points");
    const rows = screen.querySelectorAll(
      ".player-leaderboard__board:not([hidden]) .player-leaderboard__row"
    );
    const targets = [me, ...rows].filter(Boolean);
    if (!targets.length) return null;

    const scoreTarget = Number(pointsEl?.dataset?.scoreValue || 0);
    if (prefersReducedMotion()) {
      if (pointsEl) pointsEl.textContent = formatPts(scoreTarget);
      playLeaderboardPlayerSfx("celebrate", 0.85);
      return null;
    }

    if (playerLeaderboardTl) playerLeaderboardTl.kill();
    gsap.killTweensOf(targets);

    if (me) gsap.set(me, { y: 22, autoAlpha: 0, scale: 0.95, force3D: true });
    gsap.set(rows, { y: 14, autoAlpha: 0, force3D: true });
    if (pointsEl) pointsEl.textContent = formatPts(0);

    playerLeaderboardTl = gsap.timeline({
      defaults: { ease: "power2.out", force3D: true },
      onComplete: () => {
        gsap.set(targets, { clearProps: "transform,opacity,visibility" });
        playerLeaderboardTl = null;
      },
    });

    if (me) {
      playerLeaderboardTl.add(() => playLeaderboardPlayerSfx("celebrate", 0.9), 0);
      playerLeaderboardTl.to(me, { y: 0, autoAlpha: 1, scale: 1, duration: 0.52 }, 0);
      if (pointsEl) {
        playerLeaderboardTl.add(() => countUpScore(pointsEl, scoreTarget, 0.55), 0.18);
      }
    }
    if (rows.length) {
      playerLeaderboardTl.to(
        rows,
        { y: 0, autoAlpha: 1, duration: 0.38, stagger: 0.07 },
        me ? 0.22 : 0
      );
    }
    return playerLeaderboardTl;
  }

  function playEnterIfNeeded(screenId) {
    const waiting = document.querySelector("#screen-waiting");
    if (screenId === "waiting") {
      playWaitingEnter(waiting);
    } else if (waiting) {
      waiting.classList.remove("is-gsap-entered");
      if (waitingEnterTl) {
        waitingEnterTl.kill();
        waitingEnterTl = null;
      }
    }
  }

  let cmsScreenTl = null;
  let cmsListTl = null;
  let cmsTabTl = null;

  function killCmsTweens(kind) {
    if (kind === "screen" || kind === "all") {
      if (cmsScreenTl) {
        cmsScreenTl.kill();
        cmsScreenTl = null;
      }
    }
    if (kind === "list" || kind === "all") {
      if (cmsListTl) {
        cmsListTl.kill();
        cmsListTl = null;
      }
    }
    if (kind === "tab" || kind === "all") {
      if (cmsTabTl) {
        cmsTabTl.kill();
        cmsTabTl = null;
      }
    }
  }

  function playCmsScreenEnter(screen) {
    if (!screen) return null;
    killCmsTweens("screen");

    const focus =
      screen.querySelector(".cms-panel-login, .cms-header, .cms-edit-chrome") || screen;

    if (prefersReducedMotion()) {
      gsap.set([screen, focus], { clearProps: "opacity,visibility,transform" });
      return null;
    }

    cmsScreenTl = gsap.timeline({
      defaults: { ease: "power2.out" },
      onComplete: () => {
        gsap.set([screen, focus], { clearProps: "opacity,visibility,transform" });
      },
    });

    gsap.set(screen, { autoAlpha: 1 });
    cmsScreenTl.fromTo(
      focus,
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.38 },
      0
    );

    const secondary = screen.querySelector(
      ".cms-edit-surface, .cms-tabs, .cms-course-list, .cms-section-list, .cms-exercise-list"
    );
    if (secondary && secondary !== focus) {
      cmsScreenTl.fromTo(
        secondary,
        { autoAlpha: 0, y: 10 },
        { autoAlpha: 1, y: 0, duration: 0.32 },
        0.08
      );
    }

    return cmsScreenTl;
  }

  function playCmsListReveal(container) {
    if (!container) return null;
    killCmsTweens("list");

    const items = container.querySelectorAll(
      ".cms-course-card, .cms-section-card, .cms-exercise-card, .cms-empty"
    );
    if (!items.length) return null;

    if (prefersReducedMotion()) {
      gsap.set(items, { clearProps: "opacity,visibility,transform" });
      return null;
    }

    cmsListTl = gsap.fromTo(
      items,
      { autoAlpha: 0, y: 12 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.34,
        stagger: 0.045,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
      }
    );
    return cmsListTl;
  }

  function playCmsTabEnter(panel) {
    if (!panel) return null;
    killCmsTweens("tab");

    if (prefersReducedMotion()) {
      gsap.set(panel, { clearProps: "opacity,visibility,transform" });
      return null;
    }

    cmsTabTl = gsap.fromTo(
      panel,
      { autoAlpha: 0, y: 8 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.28,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
      }
    );
    return cmsTabTl;
  }

  global.addEventListener("lango:screen-change", (event) => {
    playEnterIfNeeded(event.detail?.screenId);
  });

  global.LangoGsap = Object.freeze({
    ready: true,
    ensureTransitionFx,
    playScreenTransition,
    killScreenTransition,
    playBuzzinFeedbackEnter,
    playBuzzinEmptyEnter,
    playBuzzinStartEffect,
    playBuzzinTimerPop,
    playWaitingEnter,
    playLeaderboardReveal,
    playPlayerLeaderboardEnter,
    playCmsScreenEnter,
    playCmsListReveal,
    playCmsTabEnter,
  });
})(window);
