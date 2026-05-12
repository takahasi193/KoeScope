"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";

type Theme = "light" | "dark";

const STORAGE_KEY = "koescope-theme";

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({
  theme: "light",
  toggleTheme: () => {}
});

function normalizeTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = normalizeTheme(window.localStorage.getItem(STORAGE_KEY));
    document.documentElement.dataset.theme = saved;
    setTheme(saved);
  }, []);

  const applyTheme = useCallback((nextTheme: Theme) => {
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(theme === "dark" ? "light" : "dark");
  }, [applyTheme, theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useContext(ThemeContext);
  return (
    <Button className="theme-toggle ks-hero-button" type="button" onPress={toggleTheme} aria-label="切换主题">
      {theme === "dark" ? "Dark" : "Light"}
    </Button>
  );
}
