"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    update();
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      try { if (localStorage.getItem("flexflow-theme")) return; } catch { /* Continue without storage. */ }
      root.dataset.theme = preference.matches ? "dark" : "light";
      update();
    };
    preference.addEventListener("change", followSystem);
    return () => preference.removeEventListener("change", followSystem);
  }, []);

  const toggle = () => {
    const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("flexflow-theme", next); } catch { /* Storage can be disabled. */ }
    setTheme(next);
  };

  return <button type="button" className={`theme-toggle${compact ? " theme-toggle-compact" : ""}`} onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><span>{theme === "dark" ? "Light" : "Dark"}</span></button>;
}
