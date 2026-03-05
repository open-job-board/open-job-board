import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/otel.ts";

// =============================================================================
// Daily cleanup: delete job offers older than 7 days.
//
// Designed to be invoked by pg_cron via pg_net (HTTP POST to this function),
// or manually via a POST/GET request.
// =============================================================================

const MAX_AGE_DAYS = 7;

Deno.serve(async (req: Request) => {
  const logger = createLogger("cleanup-old-jobs");

  // Allow GET (health check / manual trigger) and POST (cron trigger)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
    const cutoffIso = cutoff.toISOString();

    logger.info("Starting cleanup", { cutoff: cutoffIso, "max_age.days": MAX_AGE_DAYS });

    // Delete jobs where posted_at is older than the cutoff, falling back to
    // created_at for jobs that have no posted_at set.
    const { count, error } = await supabase
      .from("jobs")
      .delete({ count: "exact" })
      .or(`posted_at.lt.${cutoffIso},and(posted_at.is.null,created_at.lt.${cutoffIso})`);

    if (error) {
      logger.error("Cleanup failed", {
        "error.code": error.code,
        "error.message": error.message,
      });
      return json({ error: "Cleanup failed" }, 500);
    }

    logger.info("Cleanup completed", { "deleted.count": count ?? 0 });

    return json({ deleted: count ?? 0, cutoff: cutoffIso }, 200);
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
    headers: { "Content-Type": "application/json" },
    status,
  });
}
