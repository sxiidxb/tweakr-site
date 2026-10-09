// Tweakr — minimal top-right nav injection.
// Reads the session from tweakrAuth and inserts a single pill that adapts
// (My Licenses + email chip on the right when signed in, "Sign in" + "Sign
// up" when not). Pages call it by adding an empty <div id="authNav"></div>
// and including this script.
//
// We update via DOM injection (not innerHTML rewrites) so the pages can drop
// the placeholder wherever they like.

(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  // Pages are served from clean URLs (/tweakr-site/<page>/) on GitHub Pages,
  // so relative hrefs would resolve against the page directory. Build the
  // link against the site root at runtime instead (works with or without
  // the /tweakr-site base path).
  function sitePath(p) {
    var path = window.location.pathname || "";
    var base = path.indexOf("/tweakr-site/") === 0 ? "/tweakr-site" : "";
    return base + "/" + p;
  }

  function navHTML(signedIn, email) {
    if (signedIn) {
      // Truncate long emails so the pill stays tidy.
      const e = (email || "").length > 24 ? (email.slice(0, 18) + "…") : (email || "");
      return `
        <a href="` + sitePath("account") + `" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium tracking-wide border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-all">
          <svg class="w-3.5 h-3.5 text-[#00f2fe]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          My Licenses
          <span class="text-gray-400 font-light hidden sm:inline">· ${escapeHtml(e)}</span>
        </a>
      `;
    }
    return `
      <a href="` + sitePath("login") + `" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium tracking-wide text-gray-300 hover:text-white transition-colors">Sign in</a>
      <a href="` + sitePath("signup") + `" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide text-[#00f2fe] border border-[#00f2fe]/40 bg-[#00f2fe]/5 hover:bg-[#00f2fe]/15 hover:border-[#00f2fe] transition-all">Sign up</a>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  ready(function () {
    const host = document.getElementById("authNav");
    if (!host || !window.tweakrAuth) return;
    const session = window.tweakrAuth.getSession();
    host.innerHTML = navHTML(!!session, session && session.user && session.user.email);
  });
})();
