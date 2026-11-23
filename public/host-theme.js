// Host look, chosen in Settings and saved on this device: "elderly" or standard.
// Runs in <head> before the page's own styles finish loading, so the elderly
// look appears without a flash. ?theme=elderly|standard sets it (old /hk links).
(function () {
  const KEY = "lango_host_theme";
  const asked = new URLSearchParams(location.search).get("theme");
  try {
    if (asked === "elderly" || asked === "standard") localStorage.setItem(KEY, asked);
  } catch {
    /* private mode */
  }
  let saved = "";
  try {
    saved = localStorage.getItem(KEY) || "";
  } catch {
    /* private mode */
  }
  const elderly = saved === "elderly";

  window.LANGO_HOST_THEME = elderly ? "elderly" : "";
  // Older code checks this to switch layouts, labels and default language.
  if (elderly) window.LANGO_VARIANT = "hk-elderly";

  window.setLangoHostTheme = function (theme) {
    try {
      localStorage.setItem(KEY, theme === "elderly" ? "elderly" : "standard");
    } catch {
      /* private mode */
    }
    const url = new URL(location.href);
    url.searchParams.delete("theme");
    location.replace(url.toString());
  };

  if (elderly) {
    document.documentElement.lang = "zh-HK";
    document.write(
      '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700;900&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet" />' +
        '<link rel="stylesheet" href="/hk/elderly.css" />' +
        '<link rel="stylesheet" href="/hk/elderly-v2.css" />'
    );
  } else {
    document.write('<link rel="stylesheet" href="/host-lango3-theme.css" />');
  }
})();
