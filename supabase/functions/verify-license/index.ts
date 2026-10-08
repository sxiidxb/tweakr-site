import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Public verification endpoint. Uses service_role SERVER-SIDE only,
// so the desktop app never ships any Supabase key.
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { key } = await req.json();
    if (typeof key !== "string") {
      return jsonResponse({ success: false, error: "Missing license key.", code: "BAD_KEY" });
    }
    const clean = key.trim().toUpperCase();
    if (
      !clean || clean.length > 64 || !/^[A-Z0-9-]+$/.test(clean) ||
      (!clean.startsWith("TWEAKR-STARTER-") && !clean.startsWith("TWEAKR-FULL-"))
    ) {
      return jsonResponse({ success: false, error: "Enter a valid license key.", code: "BAD_KEY" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
      return jsonResponse(
        { success: false, error: "License server misconfigured.", code: "SERVER_ERROR" },
        200,
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase
      .from("licenses")
      .select("tier,is_active")
      .eq("license_key", clean)
      .maybeSingle();

    if (error) {
      console.error("Verify lookup error:", error);
      return jsonResponse(
        { success: false, error: `Database error: ${error.message}`, code: "SERVER_ERROR" },
        200,
      );
    }
    if (!data) {
      return jsonResponse(
        { success: false, error: "Invalid license key.", code: "INVALID_KEY" },
        200,
      );
    }

    const rec = data as { tier: string; is_active: boolean };
    if (!rec.is_active || (rec.tier !== "starter" && rec.tier !== "full")) {
      return jsonResponse(
        { success: false, error: "License key has been revoked.", code: "REVOKED_KEY" },
        200,
      );
    }

    return jsonResponse({ success: true, tier: rec.tier });
  } catch (err) {
    console.error("Unhandled error:", err);
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error.",
        code: "SERVER_ERROR",
      },
      200,
    );
  }
});
