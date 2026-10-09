// Admin-only operations for the Tweakr site admin dashboard (/admin).
// Every request must carry the admin's Supabase user JWT:
//   Authorization: Bearer <access_token>
// The token's user email MUST be quifflethebest@gmail.com — anything else
// gets 403 before any database or auth-admin call runs.
//
// POST /functions/v1/admin-ops  { action, ...params }
// Actions:
//   purchasers | revoke_license {license_key, is_active} | reset_hwid {license_key}
//   users | ban {email, reason?} | unban {email} | delete_user {user_id}
//   feedback {status?} | set_feedback {id, status}
//   announcements | announce {audience, message} | set_announcement {id, active}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ADMIN_EMAIL = "quifflethebest@gmail.com";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://sxiidxb.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null",
];

const corsHeaders = (origin: string | null) => {
  const allowed = (Deno.env.get("AUTH_ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);
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

function missingTable(err: { message?: string } | null): boolean {
  const m = (err?.message || "").toLowerCase();
  return m.includes("does not exist") || m.includes("schema cache");
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error("Missing required env vars.");
    return json({ success: false, error: "Server is not configured correctly." }, 500, origin);
  }

  // ---- Admin gate: verify the caller's JWT and email ----
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const callerEmail = (userData?.user?.email || "").toLowerCase();
  if (userErr || callerEmail !== ADMIN_EMAIL) {
    return json({ success: false, error: "Admin access only.", code: "FORBIDDEN" }, 403, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action;

  // ---------- PURCHASERS ----------
  if (action === "purchasers") {
    const { data, error } = await admin
      .from("licenses")
      .select("email, tier, license_key, coupon, payment_ref, hardware_id, is_active, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    return json({ success: true, purchasers: data || [] }, 200, origin);
  }

  // ---------- REVOKE / REACTIVATE LICENSE (kill switch) ----------
  if (action === "revoke_license") {
    const key = body.license_key;
    if (typeof key !== "string" || !key) {
      return json({ success: false, error: "license_key is required." }, 400, origin);
    }
    const isActive = body.is_active === true;
    const { error } = await admin
      .from("licenses")
      .update({ is_active: isActive })
      .eq("license_key", key.trim().toUpperCase());
    if (error) return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    return json({ success: true, is_active: isActive }, 200, origin);
  }

  // ---------- RESET HWID ----------
  if (action === "reset_hwid") {
    const key = body.license_key;
    if (typeof key !== "string" || !key) {
      return json({ success: false, error: "license_key is required." }, 400, origin);
    }
    const { error } = await admin
      .from("licenses")
      .update({ hardware_id: null })
      .eq("license_key", key.trim().toUpperCase());
    if (error) return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    return json({ success: true }, 200, origin);
  }

  // ---------- USERS ----------
  if (action === "users") {
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) return json({ success: false, error: "Could not list users: " + error.message }, 500, origin);
    const users = (data?.users || []).map((u) => ({
      id: u.id, email: u.email, created_at: u.created_at,
      banned: (u as { banned_until?: string }).banned_until || null,
    }));
    const { data: bans } = await admin.from("bans").select("email, reason, created_at");
    const banMap: Record<string, { reason: string | null }> = {};
    for (const b of (bans || []) as { email: string; reason: string | null }[]) {
      banMap[b.email.toLowerCase()] = { reason: b.reason };
    }
    return json({ success: true, users, bans: banMap }, 200, origin);
  }

  // ---------- BAN / UNBAN (email block list enforced at login + signup) ----------
  if (action === "ban" || action === "unban") {
    const email = body.email;
    if (typeof email !== "string" || !email.includes("@")) {
      return json({ success: false, error: "Valid email is required." }, 400, origin);
    }
    const norm = email.trim().toLowerCase();
    if (norm === ADMIN_EMAIL) {
      return json({ success: false, error: "You cannot ban yourself." }, 400, origin);
    }
    if (action === "ban") {
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : null;
      const { error } = await admin.from("bans").upsert({ email: norm, reason });
      if (error) {
        if (missingTable(error)) {
          return json({ success: false, error: "Run migration 20261008000004_beta_admin.sql first." }, 500, origin);
        }
        return json({ success: false, error: "Database error: " + error.message }, 500, origin);
      }
      return json({ success: true, banned: true }, 200, origin);
    }
    const { error } = await admin.from("bans").delete().eq("email", norm);
    if (error) return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    return json({ success: true, banned: false }, 200, origin);
  }

  // ---------- DELETE USER ----------
  if (action === "delete_user") {
    const userId = body.user_id;
    if (typeof userId !== "string" || !userId) {
      return json({ success: false, error: "user_id is required." }, 400, origin);
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ success: false, error: "Could not delete user: " + error.message }, 500, origin);
    return json({ success: true }, 200, origin);
  }

  // ---------- FEEDBACK INBOX ----------
  if (action === "feedback") {
    let q = admin.from("feedback").select("*").order("created_at", { ascending: false }).limit(500);
    if (body.status === "new" || body.status === "reviewed" || body.status === "resolved") {
      q = q.eq("status", body.status as string);
    }
    if (body.tier === "grey" || body.tier === "black") {
      q = q.eq("tier", body.tier as string);
    }
    const { data, error } = await q;
    if (error) {
      if (missingTable(error)) {
        return json({ success: false, error: "Run migration 20261008000004_beta_admin.sql first." }, 500, origin);
      }
      return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    }
    return json({ success: true, feedback: data || [] }, 200, origin);
  }

  if (action === "set_feedback") {
    const id = body.id;
    const status = body.status;
    if (typeof id !== "string" || !["new", "reviewed", "resolved"].includes(status as string)) {
      return json({ success: false, error: "Valid id and status are required." }, 400, origin);
    }
    const { error } = await admin.from("feedback").update({ status }).eq("id", id);
    if (error) return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    return json({ success: true }, 200, origin);
  }

  // ---------- ANNOUNCEMENTS ----------
  if (action === "announcements") {
    const { data, error } = await admin
      .from("announcements").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) {
      if (missingTable(error)) {
        return json({ success: false, error: "Run migration 20261008000004_beta_admin.sql first." }, 500, origin);
      }
      return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    }
    return json({ success: true, announcements: data || [] }, 200, origin);
  }

  if (action === "announce") {
    const audience = body.audience;
    const message = body.message;
    if (!["all", "grey", "black"].includes(audience as string)) {
      return json({ success: false, error: "Audience must be all, grey or black." }, 400, origin);
    }
    if (typeof message !== "string" || message.trim().length < 3 || message.trim().length > 500) {
      return json({ success: false, error: "Message must be 3–500 characters." }, 400, origin);
    }
    const { error } = await admin.from("announcements").insert({
      audience, message: message.trim(), active: true,
    });
    if (error) {
      if (missingTable(error)) {
        return json({ success: false, error: "Run migration 20261008000004_beta_admin.sql first." }, 500, origin);
      }
      return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    }
    return json({ success: true }, 200, origin);
  }

  if (action === "set_announcement") {
    const id = body.id;
    if (typeof id !== "string") {
      return json({ success: false, error: "Valid id is required." }, 400, origin);
    }
    const { error } = await admin.from("announcements").update({ active: body.active === true }).eq("id", id);
    if (error) return json({ success: false, error: "Database error: " + error.message }, 500, origin);
    return json({ success: true }, 200, origin);
  }

  return json({ success: false, error: "Unknown action." }, 400, origin);
});
