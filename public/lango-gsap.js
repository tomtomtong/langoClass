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
  let waitingEnterTl = null;

  document.documentElement.classList.add("lango-gsap-ready");

  function prefersReducedMotion() {
    return (
      REDUCE_MOTION ||
      global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
    );
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
    playWaitingEnter,
  });
})(window);
