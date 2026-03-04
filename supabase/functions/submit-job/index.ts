import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/otel.ts";

// =============================================================================
// Zod validation schema (mirrors the protobuf JobOfferParsed definition)
// =============================================================================

const ContactSchema = z.object({
  name:  z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(50).optional(),
}).optional();

const OriginSchema = z.object({
  source:    z.string().min(1).max(200),
  reference: z.string().max(500).optional(),
  contact:   ContactSchema,
});

const CompanySchema = z.object({
  name:     z.string().max(300).optional(),
  website:  z.string().url().max(2000).optional(),
  sector:   z.string().max(200).optional(),
  anecdote: z.string().max(2000).optional(),
  location: z.array(z.string().max(200)).max(20).default([]),
}).optional();

const RemoteOptionsSchema = z.object({
  full: z.boolean().optional(),
  days: z.number().int().min(0).max(7).optional(),
}).optional();

const LocationSchema = z.object({
  city:    z.string().max(200).optional(),
  country: z.string().max(200).optional(),
  remote:  RemoteOptionsSchema,
}).optional();

const RequirementsSchema = z.object({
  qualifications: z.array(z.string().max(500)).max(50).default([]),
  hard_skills:    z.array(z.string().max(200)).max(100).default([]),
  soft_skills:    z.array(z.string().max(200)).max(50).default([]),
  others:         z.array(z.string().max(500)).max(50).default([]),
}).optional();

const SalarySchema = z.object({
  currency: z.string().max(10).optional(),
  min:      z.number().min(0).optional(),
  max:      z.number().min(0).optional(),
  period:   z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]).optional(),
}).optional();

const JobSubmissionSchema = z.object({
  origin:           OriginSchema,
  title:            z.string().min(2).max(500),
  description:      z.string().min(10).max(100000),
  responsibilities: z.array(z.string().max(500)).max(50).default([]),
  company:          CompanySchema,
  employment_type:  z.string().max(100).optional(),
  location:         LocationSchema,
  requirements:     RequirementsSchema,
  salary:           SalarySchema,
  benefits:         z.array(z.string().max(300)).max(50).default([]),
  posted_at:        z.string().datetime().optional(),
  parsed_at:        z.string().datetime().optional(),
});

// =============================================================================
// Handler
// =============================================================================

Deno.serve(async (req: Request) => {
  const logger = createLogger("submit-job");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Health check
  if (req.method === "GET") {
    return json({ status: "ok", endpoint: "submit-job" }, 200);
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

    // Supabase service role client (bypasses RLS for internal writes)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Determine rate-limit identifier: API key (if valid) or IP address
    const apiKeyHeader = req.headers.get("x-api-key");

    let rateLimit = 10;          // anonymous: 10 req/min
    let identifier = `ip:${clientIp}`;
    let authenticated = false;

    if (apiKeyHeader) {
      const keyHash = await sha256hex(apiKeyHeader);
      const { data: keyRecord } = await supabase
        .from("api_keys")
        .select("id, rate_limit, is_active")
        .eq("key_hash", keyHash)
        .eq("is_active", true)
        .maybeSingle();

      if (keyRecord) {
        rateLimit  = keyRecord.rate_limit;
        identifier = `key:${keyHash}`;
        authenticated = true;
        // Update last_used in the background (fire-and-forget)
        supabase
          .from("api_keys")
          .update({ last_used: new Date().toISOString() })
          .eq("id", keyRecord.id)
          .then(() => {});
      }
      // Invalid key → silently fall back to IP-based limit
    }

    logger.info("Rate limit check", {
      authenticated,
      identifier,
      "rate_limit.max": rateLimit,
    });

    // Check rate limit
    const { data: allowed, error: rateError } = await supabase.rpc(
      "check_rate_limit",
      { p_identifier: identifier, p_limit: rateLimit, p_window_secs: 60 },
    );

    if (rateError) {
      logger.error("Rate limit check failed", {
        "error.message": rateError.message,
        "error.code": rateError.code,
      });
      return json({ error: "Internal server error" }, 500);
    }

    if (!allowed) {
      logger.warn("Rate limit exceeded", { identifier });
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Retry after 60 seconds." }),
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

    // Validate against schema
    const parsed = JobSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("Validation failed", {
        "error.count": parsed.error.issues.length,
      });
      return json(
        { error: "Validation failed", details: parsed.error.flatten() },
        422,
      );
    }

    const job = parsed.data;

    // Map proto-shaped input → flat DB row
    const row = {
      source:            job.origin.source,
      reference:         job.origin.reference ?? null,
      contact:           job.origin.contact ?? null,
      title:             job.title,
      description:       job.description,
      responsibilities:  job.responsibilities,
      benefits:          job.benefits,
      employment_type:   job.employment_type ?? null,
      company_name:      job.company?.name ?? null,
      company_website:   job.company?.website ?? null,
      company_sector:    job.company?.sector ?? null,
      company_anecdote:  job.company?.anecdote ?? null,
      company_locations: job.company?.location ?? [],
      location_city:     job.location?.city ?? null,
      location_country:  job.location?.country ?? null,
      remote_full:       job.location?.remote?.full ?? null,
      remote_days:       job.location?.remote?.days ?? null,
      requirements:      job.requirements ?? null,
      salary_currency:   job.salary?.currency ?? null,
      salary_min:        job.salary?.min ?? null,
      salary_max:        job.salary?.max ?? null,
      salary_period:     job.salary?.period ?? null,
      posted_at:         job.posted_at ?? null,
      parsed_at:         job.parsed_at ?? null,
    };

    const { data, error: insertError } = await supabase
      .from("jobs")
      .insert(row)
      .select("id, created_at")
      .single();

    if (insertError) {
      // Unique constraint violation = duplicate source+reference
      if (insertError.code === "23505") {
        logger.warn("Duplicate job submission", {
          reference: job.origin.reference,
          source: job.origin.source,
        });
        return json(
          { error: "Duplicate job: this source + reference already exists." },
          409,
        );
      }
      logger.error("Job insert failed", {
        "error.code": insertError.code,
        "error.message": insertError.message,
      });
      return json({ error: "Internal server error" }, 500);
    }

    logger.info("Job submitted successfully", {
      "job.id": data.id,
      source: job.origin.source,
      title: job.title,
    });

    return json({ id: data.id, created_at: data.created_at }, 201);
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
  const data    = encoder.encode(input);
  const buf     = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
