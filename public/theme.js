(function attachKoeScopeTheme(global) {
  const STORAGE_KEY = "koescope:theme";
  const THEMES = new Set(["light", "dark"]);

  function readSavedTheme() {
    try {
      const saved = global.localStorage?.getItem(STORAGE_KEY);
      return THEMES.has(saved) ? saved : "light";
    } catch {
      return "light";
    }
  }

  function saveTheme(theme) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, theme);
    } catch {
      // LocalStorage can be unavailable in private or embedded contexts.
    }
  }

  function applyTheme(theme, { persist = false } = {}) {
    const normalized = THEMES.has(theme) ? theme : "light";
    global.document.documentElement.dataset.theme = normalized;
    if (persist) saveTheme(normalized);
    syncButtons(normalized);
    return normalized;
  }

  function nextTheme() {
    return global.document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  }

  function syncButtons(theme = global.document.documentElement.dataset.theme || "light") {
    const buttons = global.document.querySelectorAll?.("[data-theme-toggle]") ?? [];
    for (const button of buttons) {
      const isDark = theme === "dark";
      button.textContent = isDark ? "Light" : "Dark";
      button.setAttribute("aria-pressed", isDark ? "true" : "false");
      button.setAttribute("title", isDark ? "Switch to light theme" : "Switch to dark theme");
    }
  }

  function bindButtons() {
    const buttons = global.document.querySelectorAll?.("[data-theme-toggle]") ?? [];
    for (const button of buttons) {
      if (button.dataset.themeBound === "1") continue;
      button.dataset.themeBound = "1";
      button.addEventListener("click", () => applyTheme(nextTheme(), { persist: true }));
    }
    syncButtons();
  }

  applyTheme(readSavedTheme());

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", bindButtons, { once: true });
  } else {
    bindButtons();
  }

  global.KoeScopeTheme = {
    apply: (theme) => applyTheme(theme, { persist: true }),
    current: () => global.document.documentElement.dataset.theme || "light",
    storageKey: STORAGE_KEY,
  };
})(window);

