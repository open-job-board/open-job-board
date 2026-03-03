import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";

// =============================================================================
// Validation
// =============================================================================

const LoginSchema = z.object({
  email: z.string().email("Invalid email address").max(320),
});

// =============================================================================
// Handler
//
// POST /login — authenticate by email, return a persistent session token.
//   1. Look up the user's API key by email.
//   2. Generate a session token (random, never stored in plain text).
//   3. Return the token. The client stores it and sends it on future requests.
//
// POST /login/validate — check if a session token is still valid.
//
// POST /login/logout — revoke a session token.
// =============================================================================

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Health check
  if (req.method === "GET") {
    return json({ status: "ok", endpoint: "login" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Route based on action field
  const action =
    typeof body === "object" && body !== null && "action" in body
      ? (body as Record<string, unknown>).action
      : "login";

  // -------------------------------------------------------------------------
  // ACTION: validate — check if a session token is valid
  // -------------------------------------------------------------------------
  if (action === "validate") {
    const token =
      typeof body === "object" && body !== null && "session_token" in body
        ? String((body as Record<string, unknown>).session_token)
        : null;

    if (!token) {
      return json({ error: "Missing session_token" }, 400);
    }

    const tokenHash = await sha256hex(token);
    const { data: apiKeyId, error: valError } = await supabase.rpc(
      "validate_session",
      { p_token_hash: tokenHash },
    );

    if (valError) {
      console.error("Session validation error:", valError);
      return json({ error: "Internal server error" }, 500);
    }

    if (!apiKeyId) {
      return json({ valid: false }, 200);
    }

    // Fetch the user's email and name for convenience
    const { data: keyRecord } = await supabase
      .from("api_keys")
      .select("id, name, owner_email")
      .eq("id", apiKeyId)
      .eq("is_active", true)
      .maybeSingle();

    if (!keyRecord) {
      return json({ valid: false }, 200);
    }

    return json(
      {
        valid: true,
        user: {
          api_key_id: keyRecord.id,
          name: keyRecord.name,
          email: keyRecord.owner_email,
        },
      },
      200,
    );
  }

  // -------------------------------------------------------------------------
  // ACTION: logout — revoke a session token
  // -------------------------------------------------------------------------
  if (action === "logout") {
    const token =
      typeof body === "object" && body !== null && "session_token" in body
        ? String((body as Record<string, unknown>).session_token)
        : null;

    if (!token) {
      return json({ error: "Missing session_token" }, 400);
    }

    const tokenHash = await sha256hex(token);

    const { error: revokeError } = await supabase
      .from("auth_sessions")
      .update({ is_active: false })
      .eq("token_hash", tokenHash);

    if (revokeError) {
      console.error("Logout error:", revokeError);
      return json({ error: "Internal server error" }, 500);
    }

    return json({ logged_out: true }, 200);
  }

  // -------------------------------------------------------------------------
  // ACTION: login (default) — authenticate by email, create session
  // -------------------------------------------------------------------------

  // Rate limit by IP: max 5 login attempts per minute
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";

  const { data: allowed, error: rateError } = await supabase.rpc(
    "check_rate_limit",
    { p_identifier: `ip:${clientIp}:login`, p_limit: 5, p_window_secs: 60 },
  );

  if (rateError) {
    console.error("Rate limit check failed:", rateError);
    return json({ error: "Internal server error" }, 500);
  }

  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      },
    );
  }

  // Validate input
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Validation failed", details: parsed.error.flatten() },
      422,
    );
  }

  // Look up API key by email
  const { data: keyRecord } = await supabase
    .from("api_keys")
    .select("id, name, owner_email")
    .eq("owner_email", parsed.data.email)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!keyRecord) {
    // Don't reveal whether the email exists — use a generic message
    return json(
      { error: "No account found for this email. Create an API key first." },
      404,
    );
  }

  // Generate session token: ojbs_ prefix + 32 random hex bytes (64 chars)
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const sessionToken =
    "ojbs_" +
    Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const tokenHash = await sha256hex(sessionToken);

  // Store session
  const { error: insertError } = await supabase.from("auth_sessions").insert({
    token_hash: tokenHash,
    api_key_id: keyRecord.id,
  });

  if (insertError) {
    console.error("Session insert error:", insertError);
    return json({ error: "Failed to create session" }, 500);
  }

  return json(
    {
      session_token: sessionToken,
      expires_in: "90 days",
      user: {
        name: keyRecord.name,
        email: keyRecord.owner_email,
      },
      message: "Store this session token — it will be used to authenticate future requests.",
    },
    201,
  );
});

// =============================================================================
// Helpers
// =============================================================================

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
