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

  function navHTML(signedIn, email, isAdmin) {
    if (signedIn) {
      // Truncate long emails so the pill stays tidy.
      const e = (email || "").length > 24 ? (email.slice(0, 18) + "…") : (email || "");
      const adminPill = isAdmin
        ? `<a href="` + sitePath("admin") + `" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide text-[#00f2fe] border border-[#00f2fe]/40 bg-[#00f2fe]/5 hover:bg-[#00f2fe]/15 transition-all">Admin</a>`
        : "";
      return `
        <a href="` + sitePath("account") + `" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium tracking-wide border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-all">
          <svg class="w-3.5 h-3.5 text-[#00f2fe]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          My Licenses
          <span class="text-gray-400 font-light hidden sm:inline">· ${escapeHtml(e)}</span>
        </a>
        ${adminPill}
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

  // ---- Notifications bell (everyone): announcements + own report statuses.
  var SEEN_KEY = "tweakr_notices_seen";

  function getSeen() {
    try { return parseInt(localStorage.getItem(SEEN_KEY) || "0", 10) || 0; } catch (e) { return 0; }
  }
  function setSeen(v) {
    try { localStorage.setItem(SEEN_KEY, String(v)); } catch (e) {}
  }

  async function loadNotices() {
    var out = { announcements: [], reports: [] };
    try {
      var r = await fetch(window.tweakrAuth.endpoint + "?action=get-announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: "all" })
      });
      var d = await r.json();
      if (d && d.success) out.announcements = d.announcements || [];
    } catch (e) {}
    var session = window.tweakrAuth.getSession();
    if (session && typeof window.tweakrAuth.fetchMyFeedback === "function") {
      try {
        var res = await window.tweakrAuth.fetchMyFeedback();
        if (res && res.success) out.reports = res.feedback || [];
      } catch (e) {}
    }
    return out;
  }

  function newestTs(notices) {
    var max = 0;
    notices.announcements.forEach(function (a) {
      var t = Date.parse(a.created_at || "") || 0;
      if (t > max) max = t;
    });
    notices.reports.forEach(function (f) {
      var t = Date.parse(f.created_at || "") || 0;
      if (t > max) max = t;
    });
    return max;
  }

  function renderPanel(notices) {
    var html = "";
    if (notices.announcements.length) {
      html += '<p class="px-1 pb-2 text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium">Updates</p>';
      html += notices.announcements.slice(0, 5).map(function (a) {
        return '<div class="rounded-xl border border-[#00f2fe]/25 bg-[#00f2fe]/5 px-3 py-2.5 mb-2 text-[13px] text-gray-200 font-light">' +
          escapeHtml(a.message) + "</div>";
      }).join("");
    }
    var session = window.tweakrAuth.getSession();
    if (session) {
      html += '<p class="px-1 pb-2 pt-1 text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium">Your reports</p>';
      if (!notices.reports.length) {
        html += '<p class="px-1 text-[13px] text-gray-500 font-light">Nothing submitted yet.</p>';
      } else {
        html += notices.reports.slice(0, 8).map(function (f) {
          var color = f.status === "resolved" ? "text-[#7ef0d0]" : f.status === "dismissed" ? "text-gray-500" : f.status === "in_progress" ? "text-[#f0d27e]" : "text-[#ff8a8a]";
          return '<div class="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 mb-2">' +
            '<p class="text-[13px] text-white font-medium truncate">' + escapeHtml(f.title) + "</p>" +
            '<p class="text-[11px] ' + color + ' mt-0.5">' + escapeHtml(String(f.status).replace("_", " ")) + " · " + escapeHtml(f.tier) + "</p></div>";
        }).join("");
      }
    } else {
      html += '<p class="px-1 pt-1 text-[12px] text-gray-500 font-light">Sign in to track your own reports here.</p>';
    }
    if (!html) html = '<p class="px-1 text-[13px] text-gray-500 font-light">All quiet. Check back soon.</p>';
    return html;
  }

  function mountBell(host) {
    var wrap = document.createElement("span");
    wrap.className = "relative inline-flex";
    wrap.innerHTML =
      '<button id="tweakrBell" aria-label="Notifications" class="relative inline-flex items-center p-2 rounded-full border border-white/10 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 transition-all">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>' +
      '<span id="tweakrBellDot" class="hidden absolute top-1 right-1 h-2 w-2 rounded-full bg-[#00f2fe]" style="box-shadow:0 0 8px rgba(0,242,254,0.8)"></span></button>' +
      '<div id="tweakrBellPanel" class="hidden absolute right-0 top-10 z-50 w-80 max-w-[85vw] squircle glass-panel p-4 max-h-96 overflow-y-auto tweakr-scroll">' +
      '<p class="text-gray-500 text-[13px] font-light px-1">Loading…</p></div>';
    host.prepend(wrap);

    var btn = wrap.querySelector("#tweakrBell");
    var panel = wrap.querySelector("#tweakrBellPanel");
    var dot = wrap.querySelector("#tweakrBellDot");
    var loaded = false;

    function refreshDot() {
      loadNotices().then(function (n) {
        if (newestTs(n) > getSeen()) dot.classList.remove("hidden");
      });
    }
    refreshDot();

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var opening = panel.classList.contains("hidden");
      panel.classList.toggle("hidden");
      if (!opening) return;
      if (!loaded) {
        loadNotices().then(function (n) {
          loaded = true;
          panel.innerHTML = renderPanel(n);
          setSeen(Date.now());
          dot.classList.add("hidden");
        });
      } else {
        setSeen(Date.now());
        dot.classList.add("hidden");
      }
    });
    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) panel.classList.add("hidden");
    });
  }

  ready(function () {
    const host = document.getElementById("authNav");
    if (!host || !window.tweakrAuth) return;
    mountBell(host);
    const session = window.tweakrAuth.getSession();
    const isAdmin = !!(window.tweakrAuth.isAdmin && window.tweakrAuth.isAdmin());
    host.insertAdjacentHTML("beforeend", navHTML(!!session, session && session.user && session.user.email, isAdmin));
  });
})();
