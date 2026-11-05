// Cloudflare Turnstile for login and join. LangoTurnstile.headers() resolves to
// { "X-Turnstile-Token": token } (or {} while the Worker has no site key set).
// The widget stays hidden unless Cloudflare needs the visitor to click it.
(function () {
  let configPromise = null;
  let scriptPromise = null;

  function siteKey() {
    if (!configPromise) {
      configPromise = fetch("/api/turnstile", { headers: { Accept: "application/json" } })
        .then((res) => (res.ok ? res.json() : {}))
        .then((data) => String(data?.siteKey || ""))
        .catch(() => "");
    }
    return configPromise;
  }

  function loadScript() {
    if (window.turnstile) return Promise.resolve();
    if (!scriptPromise) {
      scriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          scriptPromise = null;
          reject(new Error("Could not load the security check."));
        };
        document.head.appendChild(script);
      });
    }
    return scriptPromise;
  }

  function host() {
    let el = document.getElementById("lango-turnstile");
    if (!el) {
      el = document.createElement("div");
      el.id = "lango-turnstile";
      el.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;";
      document.body.appendChild(el);
    }
    return el;
  }

  // Each token works once, so every call runs a fresh challenge.
  async function token() {
    const key = await siteKey();
    if (!key) return "";
    await loadScript();
    return new Promise((resolve, reject) => {
      const el = host();
      el.innerHTML = "";
      let widgetId = null;
      const done = (fn, value) => {
        try {
          if (widgetId != null) window.turnstile.remove(widgetId);
        } catch {}
        fn(value);
      };
      widgetId = window.turnstile.render(el, {
        sitekey: key,
        appearance: "interaction-only",
        callback: (value) => done(resolve, value),
        "error-callback": () => done(reject, new Error("Security check failed. Please try again.")),
        "timeout-callback": () => done(reject, new Error("Security check timed out. Please try again.")),
      });
    });
  }

  async function headers() {
    const value = await token();
    return value ? { "X-Turnstile-Token": value } : {};
  }

  window.LangoTurnstile = { token, headers };
})();
