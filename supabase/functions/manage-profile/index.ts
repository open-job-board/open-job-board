import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

// =============================================================================
// Zod validation schemas
// =============================================================================

const ProfileSchema = z.object({
  title_keywords: z.array(z.string().max(200)).max(20).optional(),
  skills: z.array(z.string().max(200)).max(50).optional(),
  location_country: z.string().max(200).optional(),
  location_city: z.string().max(200).optional(),
  remote_only: z.boolean().optional(),
  employment_type: z
    .enum(["full-time", "part-time", "contract", "freelance", "internship"])
    .optional(),
  salary_min: z.number().min(0).optional(),
  salary_currency: z.string().max(10).optional(),
  salary_period: z
    .enum(["hourly", "daily", "weekly", "monthly", "yearly"])
    .optional(),
  webhook_url: z.string().url().max(2000).optional(),
  active_looking: z.boolean().optional(),
});

const ScheduleSchema = z.object({
  interval_minutes: z.number().int().min(5).max(10080).optional(),
  cron_expression: z.string().max(100).optional(),
  max_matches: z.number().int().min(1).max(50).optional(),
  is_active: z.boolean().optional(),
});

const UpsertSchema = z.object({
  profile: ProfileSchema,
  schedule: ScheduleSchema.optional(),
});

// =============================================================================
// Handler
// =============================================================================

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Supabase service role client
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Authenticate via session token or API key
  const auth = await authenticateRequest(req, supabase);
  if (!auth) {
    return json(
      { error: "Authentication required. Provide X-Session-Token or X-API-Key header." },
      401,
    );
  }

  const apiKeyId = auth.apiKeyId;

  // -------------------------------------------------------------------------
  // GET — retrieve current profile + schedule
  // -------------------------------------------------------------------------
  if (req.method === "GET") {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("api_key_id", apiKeyId)
      .maybeSingle();

    if (!profile) {
      return json({ profile: null, schedule: null }, 200);
    }

    const { data: schedule } = await supabase
      .from("match_schedules")
      .select("*")
      .eq("user_profile_id", profile.id)
      .maybeSingle();

    return json({ profile, schedule }, 200);
  }

  // -------------------------------------------------------------------------
  // DELETE — remove profile, schedule, and sent matches (cascades)
  // -------------------------------------------------------------------------
  if (req.method === "DELETE") {
    const { error: delError } = await supabase
      .from("user_profiles")
      .delete()
      .eq("api_key_id", apiKeyId);

    if (delError) {
      console.error("Delete error:", delError);
      return json({ error: "Internal server error" }, 500);
    }

    return json({ deleted: true }, 200);
  }

  // -------------------------------------------------------------------------
  // POST — create or update profile + schedule
  // -------------------------------------------------------------------------
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Validation failed", details: parsed.error.flatten() },
      422,
    );
  }

  const { profile: profileInput, schedule: scheduleInput } = parsed.data;

  // Upsert profile
  const profileRow = {
    api_key_id: apiKeyId,
    title_keywords: profileInput.title_keywords ?? null,
    skills: profileInput.skills ?? null,
    location_country: profileInput.location_country ?? null,
    location_city: profileInput.location_city ?? null,
    remote_only: profileInput.remote_only ?? false,
    employment_type: profileInput.employment_type ?? null,
    salary_min: profileInput.salary_min ?? null,
    salary_currency: profileInput.salary_currency ?? null,
    salary_period: profileInput.salary_period ?? null,
    webhook_url: profileInput.webhook_url ?? null,
    active_looking: profileInput.active_looking ?? false,
  };

  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("api_key_id", apiKeyId)
    .maybeSingle();

  let profile;

  if (existingProfile) {
    const { data, error } = await supabase
      .from("user_profiles")
      .update(profileRow)
      .eq("id", existingProfile.id)
      .select()
      .single();

    if (error) {
      console.error("Profile update error:", error);
      return json({ error: "Internal server error" }, 500);
    }
    profile = data;
  } else {
    const { data, error } = await supabase
      .from("user_profiles")
      .insert(profileRow)
      .select()
      .single();

    if (error) {
      console.error("Profile insert error:", error);
      return json({ error: "Internal server error" }, 500);
    }
    profile = data;
  }

  // Upsert schedule if provided
  let schedule = null;
  if (scheduleInput) {
    const scheduleRow = {
      user_profile_id: profile.id,
      interval_minutes: scheduleInput.interval_minutes ?? 1440,
      cron_expression: scheduleInput.cron_expression ?? null,
      max_matches: scheduleInput.max_matches ?? 10,
      is_active: scheduleInput.is_active ?? true,
    };

    const { data: existingSchedule } = await supabase
      .from("match_schedules")
      .select("id")
      .eq("user_profile_id", profile.id)
      .maybeSingle();

    if (existingSchedule) {
      const { data, error } = await supabase
        .from("match_schedules")
        .update(scheduleRow)
        .eq("id", existingSchedule.id)
        .select()
        .single();

      if (error) {
        console.error("Schedule update error:", error);
        return json({ error: "Internal server error" }, 500);
      }
      schedule = data;
    } else {
      const { data, error } = await supabase
        .from("match_schedules")
        .insert(scheduleRow)
        .select()
        .single();

      if (error) {
        console.error("Schedule insert error:", error);
        return json({ error: "Internal server error" }, 500);
      }
      schedule = data;
    }
  }

  const status = existingProfile ? 200 : 201;
  return json({ profile, schedule }, status);
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
