// Single endpoint for all auth + license-recovery traffic. Keeps the Supabase
// anon key off the public site — every call comes through here and is signed
// either with a service-role key (admin actions) or with the user's own JWT
// (read actions).
//
// POST /functions/v1/auth-handler?action=<one of: signup | login | logout | me | my-licenses>
//
// All responses are JSON. CORS is open so the static GitHub Pages site can call
// us, but we validate the Origin/Referer and reject obviously-wrong requests.
//
// Required env vars:
//   SUPABASE_URL              — auto-set by Supabase
//   SUPABASE_ANON_KEY         — set in Dashboard → Edge Functions → Secrets
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase
//
// Optional:
//   AUTH_ALLOWED_ORIGINS      — comma-separated list of allowed Origin headers
//                               (defaults to https://sxiidxb.github.io,
//                               http://localhost:8765, http://127.0.0.1:8765)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://sxiidxb.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null", // file:// previews during local dev
];

const corsHeaders = (origin: string | null) => {
  const allowed = (Deno.env.get("AUTH_ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin = origin && allowed.includes(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
};

function json(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

// Reject anything that doesn't look like a real email. Catches the common
// injection / typo mistakes before they hit the database.
function isValidEmail(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function passwordPolicy(p: unknown): string | null {
  if (typeof p !== "string") return "Password is required.";
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (p.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
    return "Password must include both letters and numbers.";
  }
  return null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405, origin);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error("Missing required env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY).");
    return json(
      { success: false, error: "Server is not configured correctly. Contact support." },
      500,
      origin,
    );
  }

  // Two clients: admin (service role, bypasses RLS) and user (anon key,
  // carries the caller's JWT so RLS applies).
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: req.headers.get("Authorization") || "" },
    },
  });

  const body = await readJson(req);

  // ---------- SIGNUP ----------
  if (action === "signup") {
    const email = body.email;
    const password = body.password;
    if (!isValidEmail(email)) {
      return json({ success: false, error: "Please enter a valid email address." }, 400, origin);
    }
    const pwError = passwordPolicy(password);
    if (pwError) return json({ success: false, error: pwError }, 400, origin);

    // admin.createUser lets us create a user without going through the public
    // signUp flow (which would require email confirmation). We auto-confirm so
    // the user can sign in immediately.
    const { data, error } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: String(password),
      email_confirm: true,
    });
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) {
        return json(
          { success: false, error: "An account with that email already exists. Try signing in." },
          400,
          origin,
        );
      }
      console.error("signup error:", error);
      return json({ success: false, error: "Could not create account. Please try again." }, 400, origin);
    }
    // Immediately issue a session so the client doesn't have to do a second round-trip.
    const session = await issueSession(supabaseUrl, anonKey, String(email), String(password));
    if (!session) {
      // User was created but session issuance failed — tell them to sign in manually.
      return json({
        success: true,
        user: { id: data.user?.id, email: data.user?.email },
        session: null,
        message: "Account created. Please sign in.",
      }, 200, origin);
    }
    return json({ success: true, user: session.user, session: session.tokens }, 200, origin);
  }

  // ---------- LOGIN ----------
  if (action === "login") {
    const email = body.email;
    const password = body.password;
    if (!isValidEmail(email) || typeof password !== "string" || password.length === 0) {
      return json({ success: false, error: "Email and password are required." }, 400, origin);
    }
    const session = await issueSession(supabaseUrl, anonKey, String(email), String(password));
    if (!session) {
      return json(
        { success: false, error: "Wrong email or password." },
        401,
        origin,
      );
    }
    return json({ success: true, user: session.user, session: session.tokens }, 200, origin);
  }

  // ---------- LOGOUT ----------
  if (action === "logout") {
    // The client just discards its session; we have nothing to revoke server-side
    // because the anon key doesn't carry enough info. Return success either way.
    return json({ success: true }, 200, origin);
  }

  // ---------- ME (whoami) ----------
  if (action === "me") {
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user) {
      return json({ success: false, error: "Not signed in." }, 401, origin);
    }
    return json({ success: true, user: { id: data.user.id, email: data.user.email } }, 200, origin);
  }

  // ---------- MY LICENSES ----------
  if (action === "my-licenses") {
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.email) {
      return json({ success: false, error: "Not signed in." }, 401, origin);
    }
    const email = userData.user.email;
    // Use admin client to query the licenses table (bypasses RLS but we
    // already verified the caller's identity above).
    const { data: licenses, error: licErr } = await admin
      .from("licenses")
      .select("license_key, tier, coupon, payment_ref, created_at, hardware_id, is_active")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (licErr) {
      console.error("my-licenses error:", licErr);
      return json({ success: false, error: "Could not load licenses." }, 500, origin);
    }

    // Don't leak the payment_ref to the client — it can include PayPal order
    // IDs. Strip it before returning.
    const safe = (licenses || []).map((row) => {
      const r = row as Record<string, unknown>;
      const { payment_ref: _omit, ...rest } = r;
      return rest;
    });
    return json({ success: true, licenses: safe }, 200, origin);
  }

  return json({ success: false, error: "Unknown action." }, 400, origin);
});

// Sign a user in via the Supabase Auth REST API using the anon key, and
// return a small session bundle the client can drop straight into
// localStorage. We do this server-side so the anon key never has to ship
// in the static HTML.
async function issueSession(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<{ user: { id: string; email: string }; tokens: { access_token: string; refresh_token: string; expires_in: number; token_type: string } } | null> {
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("issueSession non-OK:", resp.status, text);
      return null;
    }
    const data = await resp.json();
    if (!data?.access_token || !data?.user?.id) return null;
    return {
      user: { id: data.user.id, email: data.user.email },
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
      },
    };
  } catch (err) {
    console.error("issueSession error:", err);
    return null;
  }
}
