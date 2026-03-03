import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// =============================================================================
// send-matches Edge Function
//
// Designed to be invoked by Supabase pg_cron (or manually with service role).
// Flow:
//   1. Find all schedules that are due (next_run_at <= now)
//   2. For each, find best matching jobs (excluding already-sent)
//   3. POST results to the user's webhook_url
//   4. Record sent matches and advance the schedule
// =============================================================================

interface DueSchedule {
  schedule_id: string;
  user_profile_id: string;
  max_matches: number;
  interval_minutes: number;
  cron_expression: string | null;
  webhook_url: string;
}

interface MatchedJob {
  job_id: string;
  title: string;
  company_name: string | null;
  location_city: string | null;
  location_country: string | null;
  remote_full: boolean | null;
  employment_type: string | null;
  salary_currency: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: string | null;
  posted_at: string | null;
  score: number;
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Health check
  if (req.method === "GET") {
    return json({ status: "ok", endpoint: "send-matches" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Only allow service role or internal cron invocation
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Supabase cron sends the service role key as Bearer token
  if (!authHeader.includes(serviceRoleKey)) {
    return json({ error: "Unauthorized — service role required" }, 403);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  // Step 1: Find due schedules
  const { data: dueSchedules, error: schedError } = await supabase.rpc(
    "get_due_schedules",
  );

  if (schedError) {
    console.error("Error fetching due schedules:", schedError);
    return json({ error: "Failed to fetch due schedules" }, 500);
  }

  if (!dueSchedules || dueSchedules.length === 0) {
    return json({ processed: 0, message: "No schedules due" }, 200);
  }

  const results: Array<{
    schedule_id: string;
    matches_found: number;
    webhook_status: number | null;
    error?: string;
  }> = [];

  // Step 2-4: Process each due schedule
  for (const sched of dueSchedules as DueSchedule[]) {
    try {
      // Find best matches for this user
      const { data: matches, error: matchError } = await supabase.rpc(
        "find_best_matches",
        {
          p_user_profile_id: sched.user_profile_id,
          p_limit: sched.max_matches,
        },
      );

      if (matchError) {
        console.error(
          `Error finding matches for ${sched.user_profile_id}:`,
          matchError,
        );
        results.push({
          schedule_id: sched.schedule_id,
          matches_found: 0,
          webhook_status: null,
          error: "match_query_failed",
        });
        // Still advance the schedule to avoid retrying forever
        await supabase.rpc("advance_schedule", {
          p_schedule_id: sched.schedule_id,
        });
        continue;
      }

      const matchedJobs = (matches ?? []) as MatchedJob[];

      if (matchedJobs.length === 0) {
        // No new matches — advance schedule and skip webhook
        await supabase.rpc("advance_schedule", {
          p_schedule_id: sched.schedule_id,
        });
        results.push({
          schedule_id: sched.schedule_id,
          matches_found: 0,
          webhook_status: null,
        });
        continue;
      }

      // Send webhook
      let webhookStatus: number | null = null;
      try {
        const webhookResponse = await fetch(sched.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "new_matches",
            user_profile_id: sched.user_profile_id,
            matches: matchedJobs,
            delivered_at: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(10000), // 10s timeout
        });
        webhookStatus = webhookResponse.status;
        // Drain the body to free resources
        await webhookResponse.body?.cancel();
      } catch (webhookErr) {
        console.error(
          `Webhook failed for ${sched.user_profile_id}:`,
          webhookErr,
        );
        webhookStatus = null;
      }

      // Record sent matches (even if webhook failed — prevents re-sending)
      const matchRecords = matchedJobs.map((m) => ({
        job_id: m.job_id,
        score: m.score,
      }));

      await supabase.rpc("record_sent_matches", {
        p_user_profile_id: sched.user_profile_id,
        p_matches: matchRecords,
      });

      // Advance schedule
      await supabase.rpc("advance_schedule", {
        p_schedule_id: sched.schedule_id,
      });

      results.push({
        schedule_id: sched.schedule_id,
        matches_found: matchedJobs.length,
        webhook_status: webhookStatus,
      });
    } catch (err) {
      console.error(`Unexpected error for schedule ${sched.schedule_id}:`, err);
      results.push({
        schedule_id: sched.schedule_id,
        matches_found: 0,
        webhook_status: null,
        error: "unexpected_error",
      });
      // Advance even on failure to avoid infinite retry
      await supabase
        .rpc("advance_schedule", { p_schedule_id: sched.schedule_id })
        .catch(() => {});
    }
  }

  return json(
    {
      processed: results.length,
      results,
    },
    200,
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
