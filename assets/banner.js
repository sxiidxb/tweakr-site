// Tweakr — site-wide broadcast banner.
// Reads admin-published announcements and shows them above the page.
// Usage: <script src=".../assets/banner.js" data-audience="grey"></script>
// audience: "all" | "grey" | "black" — messages tagged "all" always show.

(function () {
  "use strict";

  var ENDPOINT = "https://vtonvtzhtkwksydpilwf.supabase.co/functions/v1/auth-handler?action=get-announcements";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function currentScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  }

  function init() {
    var tag = currentScript();
    var audience = (tag && tag.getAttribute("data-audience")) || "all";
    var main = document.querySelector("main");
    if (!main) return;

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience: audience })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var rows = (data && data.announcements) || [];
        if (!rows.length) return;
        var bar = document.createElement("div");
        bar.setAttribute("role", "status");
        bar.className = "w-full max-w-3xl mb-8";
        bar.innerHTML = rows.slice(0, 3).map(function (a) {
          return '<div class="squircle px-5 py-3 text-sm font-light text-center text-[#00f2fe]" ' +
            'style="background:rgba(0,242,254,0.07);border:1px solid rgba(0,242,254,0.35);box-shadow:0 0 18px rgba(0,242,254,0.15);">' +
            esc(a.message) + "</div>";
        }).join("");
        main.insertBefore(bar, main.firstChild);
      })
      .catch(function () { /* banner is best-effort — never break the page */ });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
