import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateLicenseKey(tier: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = 4;
  const segLen = 5;
  const parts: string[] = [];
  for (let s = 0; s < segments; s++) {
    let seg = "";
    for (let i = 0; i < segLen; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    parts.push(seg);
  }
  // Must match desktop sanitize() in src-tauri/src/commands/license.rs:
  // TWEAKR-STARTER-… or TWEAKR-FULL-…
  const prefix = tier === "starter" ? "TWEAKR-STARTER-" : "TWEAKR-FULL-";
  return prefix + parts.join("-");
}

function isTestPayment(paymentRef: string): boolean {
  if (!paymentRef) return false;
  const upper = paymentRef.toUpperCase();
  return upper.startsWith("TEST_") || upper.startsWith("MANUAL_") || upper.includes("BYPASS");
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse body
    const { email, tier, paymentRef } = await req.json();

    // --- Input validation ---
    if (!email || typeof email !== "string") {
      return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
    }
    if (!tier || !["starter", "full"].includes(tier)) {
      return jsonResponse({ success: false, error: "Tier must be 'starter' or 'full'." }, 400);
    }
    if (!paymentRef || typeof paymentRef !== "string") {
      return jsonResponse({ success: false, error: "Missing or invalid paymentRef." }, 400);
    }

    // --- Payment verification gate ---
    const skipVerification = isTestPayment(paymentRef);

    if (!skipVerification) {
      // TODO: Add real PayPal order verification here when going to production.
      // For now we allow all refs through; in production you would call
      // the PayPal Orders API to confirm capture status before proceeding.
    }

    // --- Generate license key (prefixed per tier, must match desktop validator) ---
    const licenseKey = generateLicenseKey(tier);

    // --- Insert into Supabase ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
      return jsonResponse(
        { success: false, error: "Server misconfigured: missing database credentials." },
        200,
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Idempotency: same paymentRef must not mint two licenses (also fixes
    // double-click / retry after the "permission denied" alert).
    const { data: existing, error: lookupError } = await supabase
      .from("licenses")
      .select("license_key,tier,email")
      .eq("payment_ref", paymentRef)
      .maybeSingle();

    if (lookupError) {
      console.error("DB lookup error:", lookupError);
      if (lookupError.message?.includes("permission denied")) {
        return jsonResponse(
          {
            success: false,
            error:
              "Database permission denied for table licenses. Run supabase/migrations/20261008000000_fix_licenses_permissions.sql in the SQL Editor (GRANT ALL ON public.licenses TO service_role).",
          },
          200,
        );
      }
      return jsonResponse(
        { success: false, error: `Database error: ${lookupError.message}` },
        200,
      );
    }

    if (existing) {
      return jsonResponse({
        success: true,
        licenseKey: (existing as { license_key: string }).license_key,
        tier,
        email,
      });
    }

    const { error: dbError } = await supabase.from("licenses").insert({
      email,
      tier,
      license_key: licenseKey,
      payment_ref: paymentRef,
    });

    if (dbError) {
      console.error("DB insert error:", dbError);
      if (dbError.message?.includes("permission denied")) {
        return jsonResponse(
          {
            success: false,
            error:
              "Database permission denied for table licenses. Run supabase/migrations/20261008000000_fix_licenses_permissions.sql in the SQL Editor (GRANT ALL ON public.licenses TO service_role).",
          },
          200,
        );
      }
      return jsonResponse(
        { success: false, error: `Database error: ${dbError.message}` },
        200,
      );
    }

    // --- Success ---
    return jsonResponse({
      success: true,
      licenseKey,
      tier,
      email,
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return jsonResponse(
      { success: false, error: err instanceof Error ? err.message : "Internal server error." },
      200
    );
  }
});
