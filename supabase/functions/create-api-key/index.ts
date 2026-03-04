import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/otel.ts";

// =============================================================================
// Validation
// =============================================================================

const CreateKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address").max(320),
});

// =============================================================================
// Handler
// =============================================================================

Deno.serve(async (req: Request) => {
  const logger = createLogger("create-api-key");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Health check
  if (req.method === "GET") {
    return json({ status: "ok", endpoint: "create-api-key" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";

    logger.info("Request received", {
      "client.address": clientIp,
      "http.method": req.method,
      "http.url": req.url,
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Rate limit by IP: max 5 key creations per minute
    const { data: allowed, error: rateError } = await supabase.rpc(
      "check_rate_limit",
      { p_identifier: `ip:${clientIp}:create-key`, p_limit: 5, p_window_secs: 60 },
    );

    if (rateError) {
      logger.error("Rate limit check failed", {
        "error.code": rateError.code,
        "error.message": rateError.message,
      });
      return json({ error: "Internal server error" }, 500);
    }

    if (!allowed) {
      logger.warn("Rate limit exceeded", {
        identifier: `ip:${clientIp}:create-key`,
      });
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

    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn("Invalid JSON body");
      return json({ error: "Invalid JSON body" }, 400);
    }

    // Validate
    const parsed = CreateKeySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("Validation failed", {
        "error.count": parsed.error.issues.length,
      });
      return json(
        { error: "Validation failed", details: parsed.error.flatten() },
        422,
      );
    }

    // Generate random API key: ojb_ prefix + 32 random hex bytes (64 chars)
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const keyPlain =
      "ojb_" +
      Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    // Hash it
    const keyHash = await sha256hex(keyPlain);

    // Store hash in database
    const { error: insertError } = await supabase.from("api_keys").insert({
      key_hash: keyHash,
      name: parsed.data.name,
      owner_email: parsed.data.email,
    });

    if (insertError) {
      logger.error("API key insert failed", {
        "error.code": insertError.code,
        "error.message": insertError.message,
      });
      return json({ error: "Failed to create API key" }, 500);
    }

    logger.info("API key created successfully", {
      name: parsed.data.name,
    });

    return json(
      {
        key: keyPlain,
        name: parsed.data.name,
        rate_limit: 100,
        message: "Save this key now — it will not be shown again.",
      },
      201,
    );
  } catch (err) {
    logger.error("Unhandled error", {
      "error.message": err instanceof Error ? err.message : String(err),
      "error.type": err instanceof Error ? err.constructor.name : typeof err,
    });
    return json({ error: "Internal server error" }, 500);
  } finally {
    await logger.flush();
  }
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
