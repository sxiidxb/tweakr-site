// @ts-check
/** @type {import("./types.d.ts")} */
// deno-lint-ignore-file

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = new Set([
  "https://sxiidxb.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null",
]);

const corsHeaders = (origin) => {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
};

const jsonResponse = (body, status = 200, origin = null) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
};

const isValidEmail = (s) => {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 5 || t.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
};

const isValidPaymentRef = (s) => {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 3 || t.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(t);
};

const generateLicenseKey = (tier) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = 4;
  const segLen = 5;
  const parts = [];
  for (let s = 0; s < segments; s++) {
    let seg = "";
    for (let i = 0; i < segLen; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    parts.push(seg);
  }
  const prefix = tier === "starter" ? "TWEAKR-STARTER-" : "TWEAKR-FULL-";
  return prefix + parts.join("-");
};

const isTestPayment = (paymentRef) => {
  if (!paymentRef) return false;
  const upper = paymentRef.toUpperCase();
  return (
    upper.startsWith("TEST_") ||
    upper.startsWith("MANUAL_") ||
    upper.startsWith("COUPON_") ||
    upper.includes("BYPASS")
  );
};

serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405, origin);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { email, tier, paymentRef } = body;

    if (!isValidEmail(email)) {
      return jsonResponse({ success: false, error: "Please enter a valid email address." }, 400, origin);
    }
    if (!tier || !["starter", "full"].includes(String(tier))) {
      return jsonResponse({ success: false, error: "Tier must be 'starter' or 'full'." }, 400, origin);
    }
    if (!isValidPaymentRef(paymentRef)) {
      return jsonResponse({ success: false, error: "Missing or invalid payment reference." }, 400, origin);
    }

    const skipVerification = isTestPayment(paymentRef);

    if (!skipVerification) {
      // TODO: Add real PayPal order verification here before going to production.
    }

    const normalisedEmail = email.trim().toLowerCase();
    const normalisedPaymentRef = paymentRef.trim();
    const licenseKey = generateLicenseKey(String(tier));

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
      return jsonResponse({ success: false, error: "Server misconfigured: missing database credentials." }, 200, origin);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Idempotency: same paymentRef must not mint two licenses.
    const { data: existing, error: lookupError } = await supabase
      .from("licenses")
      .select("license_key,tier,email")
      .eq("payment_ref", normalisedPaymentRef)
      .maybeSingle();

    if (lookupError) {
      console.error("DB lookup error:", lookupError);
      if (lookupError.message && lookupError.message.includes("permission denied")) {
        return jsonResponse(
          { success: false, error: "Database permission denied. Run the licenses permissions migration in the Supabase SQL Editor." },
          200, origin,
        );
      }
      return jsonResponse({ success: false, error: "Database error: " + lookupError.message }, 200, origin);
    }

    if (existing) {
      return jsonResponse({
        success: true,
        licenseKey: existing.license_key,
        tier,
        email: normalisedEmail,
        alreadyOwned: true,
      }, 200, origin);
    }

    // Strict 1-license limit: one active Tweakr Black license per email.
    // If this email already owns an active key, hand that key back instead
    // of minting a second one.
    const { data: owned, error: ownedError } = await supabase
      .from("licenses")
      .select("license_key,tier,email")
      .eq("email", normalisedEmail)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (ownedError) {
      console.error("DB owned-lookup error:", ownedError);
      return jsonResponse({ success: false, error: "Database error: " + ownedError.message }, 200, origin);
    }

    if (owned) {
      return jsonResponse({
        success: true,
        licenseKey: (owned as { license_key: string }).license_key,
        tier: (owned as { tier: string }).tier,
        email: normalisedEmail,
        alreadyOwned: true,
      }, 200, origin);
    }

    const insertRow = {
      email: normalisedEmail,
      tier,
      license_key: licenseKey,
      payment_ref: normalisedPaymentRef,
    };

    const { error: dbError } = await supabase.from("licenses").insert(insertRow);

    if (dbError) {
      console.error("DB insert error:", dbError);
      if (dbError.message && dbError.message.includes("permission denied")) {
        return jsonResponse(
          { success: false, error: "Database permission denied. Run the licenses permissions migration in the Supabase SQL Editor." },
          200, origin,
        );
      }
      return jsonResponse({ success: false, error: "Database error: " + dbError.message }, 200, origin);
    }

    return jsonResponse({
      success: true,
      licenseKey,
      tier,
      email: normalisedEmail,
    }, 200, origin);

  } catch (err) {
    console.error("Unhandled error:", err);
    const msg = err && err.message ? err.message : "Internal server error.";
    return jsonResponse({ success: false, error: msg }, 200, origin);
  }
});
