// Applies the theme before first paint so there is no flash. A file, not inline, so the CSP needs no hash.
try {
  var t = localStorage.getItem("mado.theme") || "system";
  var a = localStorage.getItem("mado.accent");
  var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (a && a.charAt(0) === "#") document.documentElement.style.setProperty("--user-accent", a);
} catch (e) {}
