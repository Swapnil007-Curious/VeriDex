// Theme: Night is the default; Day ("paper") is a choice (html[data-theme="light"]), remembered in
// the preferences. The address-bar colour follows.

export type Theme = "dark" | "light";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#F6E3B4" : "#120806";
}

export function themeToggleLabel(): string {
  return currentTheme() === "light" ? "Switch to the night theme" : "Switch to the day theme";
}
