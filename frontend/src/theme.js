// Three-way theme: "light" | "dark" | "auto" (follows the OS via
// prefers-color-scheme). Persisted in localStorage; applied purely by
// toggling a data-theme attribute that main.css already keys off of -
// "auto" is expressed as the *absence* of the attribute, not its own value,
// so the existing @media (prefers-color-scheme: dark) block keeps working
// unmodified for that case.

const STORAGE_KEY = "lumio-theme";
const ORDER = ["light", "dark", "auto"];

function apply(theme) {
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function getTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return ORDER.includes(stored) ? stored : "auto";
}

export function setTheme(theme) {
  const next = ORDER.includes(theme) ? theme : "auto";
  localStorage.setItem(STORAGE_KEY, next);
  apply(next);
  return next;
}

// Fixed cycle order regardless of the starting point: Light -> Dark -> Auto.
export function cycleTheme() {
  const current = getTheme();
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  return setTheme(next);
}

// Called once from main.js's boot sequence so the stored preference is
// live before the login/setup screens render, not just after the
// dashboard mounts.
export function initTheme() {
  apply(getTheme());
}
