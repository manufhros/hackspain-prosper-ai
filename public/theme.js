// Run before styles to avoid a light flash when the saved theme is dark.
(() => {
  let preference = "system";
  let reduced = false;
  try {
    preference = localStorage.getItem("lucia-theme") || "system";
    reduced = localStorage.getItem("lucia-reduce-motion") === "true";
  } catch {
    /* Private storage may be unavailable. */
  }
  document.documentElement.dataset.theme =
    preference === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.reducedMotion = String(reduced);
})();
