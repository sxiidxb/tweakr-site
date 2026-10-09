// Tweakr — tiny client-side auth helper.
//
// All auth / license-recovery calls go through a single Supabase edge function
// (auth-handler). We never talk to Supabase directly from the browser, so the
// anon key is never in the HTML.
//
// Sessions are stored in localStorage under "tweakr.session". The shape is
//   {
//     user:    { id, email },
//     tokens:  { access_token, refresh_token, expires_in, token_type },
//     savedAt: <epoch ms>
//   }
//
// Public surface:
//   auth.getSession()       -> { user, tokens } | null
//   auth.isSignedIn()       -> boolean
//   auth.signup(email, pwd) -> { success, user, session, error? }
//   auth.login(email, pwd)  -> { success, user, session, error? }
//   auth.logout()           -> void
//   auth.fetchMyLicenses()  -> { success, licenses, error? }
//   auth.endpoint           -> URL of the edge function

(function (global) {
  "use strict";

  const ENDPOINT = "https://vtonvtzhtkwksydpilwf.supabase.co/functions/v1/auth-handler";
  const STORAGE_KEY = "tweakr.session";

  function readSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.tokens || !parsed.user) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeSession(s) {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  }

  async function call(action, body, session) {
    const headers = { "Content-Type": "application/json" };
    if (session && session.tokens && session.tokens.access_token) {
      headers["Authorization"] = "Bearer " + session.tokens.access_token;
    }
    let resp;
    try {
      resp = await fetch(ENDPOINT + "?action=" + encodeURIComponent(action), {
        method: "POST",
        headers,
        body: JSON.stringify(body || {}),
      });
    } catch (err) {
      return { success: false, error: "Network error. Check your connection and try again." };
    }
    let data;
    try {
      data = await resp.json();
    } catch {
      return { success: false, error: "Server returned an unexpected response." };
    }
    return data;
  }

  const auth = {
    endpoint: ENDPOINT,
    getSession: readSession,
    isSignedIn: function () { return !!readSession(); },

    signup: async function (email, password) {
      const result = await call("signup", { email, password }, null);
      if (result && result.success && result.session && result.user) {
        writeSession({ user: result.user, tokens: result.session, savedAt: Date.now() });
      }
      return result;
    },

    login: async function (email, password) {
      const result = await call("login", { email, password }, null);
      if (result && result.success && result.session && result.user) {
        writeSession({ user: result.user, tokens: result.session, savedAt: Date.now() });
      }
      return result;
    },

    logout: async function () {
      // Best-effort server-side log (no-op if it fails; the client-side wipe is what matters)
      try { await call("logout", {}, readSession()); } catch (e) { /* noop */ }
      writeSession(null);
    },

    fetchMyLicenses: async function () {
      const session = readSession();
      if (!session) return { success: false, error: "Not signed in." };
      return await call("my-licenses", {}, session);
    },
  };

  global.tweakrAuth = auth;
})(window);
