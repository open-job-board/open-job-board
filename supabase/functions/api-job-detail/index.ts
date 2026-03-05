import { corsHeaders } from "../_shared/cors.ts";
import { createLogger, createTracer } from "../_shared/otel.ts";

// =============================================================================
// PostgREST RPC proxy with OTEL instrumentation
//
// Proxies POST requests to PostgREST /rest/v1/rpc/get_job_detail, forwarding
// the JSON body. Each request emits an OTLP trace span and structured logs.
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

Deno.serve(async (req: Request) => {
  const logger = createLogger("api-job-detail");
  const tracer = createTracer("api-job-detail");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Health check
  if (req.method === "GET") {
    return json({ endpoint: "api-job-detail", status: "ok" }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const span = tracer.startSpan("POST /api/job-detail", {
    "http.method": "POST",
    "http.route": "/api/job-detail",
    "http.url": req.url,
  });

  try {
    const body = await req.text();
    const postgrestUrl = `${SUPABASE_URL}/rest/v1/rpc/get_job_detail`;

    const startMs = performance.now();
    const upstream = await fetch(postgrestUrl, {
      body,
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
      },
      method: "POST",
    });
    const durationMs = Math.round(performance.now() - startMs);

    const status = upstream.status;
    span.setAttribute("http.request.duration_ms", durationMs);
    span.setAttribute("http.status_code", status);
    span.end(status);

    logger.info("Request completed", {
      "http.method": "POST",
      "http.request.duration_ms": durationMs,
      "http.route": "/api/job-detail",
      "http.status_code": status,
    });

    const responseHeaders = new Headers(corsHeaders);
    const contentType = upstream.headers.get("Content-Type");
    if (contentType) responseHeaders.set("Content-Type", contentType);

    return new Response(upstream.body, { headers: responseHeaders, status });
  } catch (err) {
    span.setAttribute("http.status_code", 502);
    span.end(502);

    logger.error("Proxy error", {
      "error.message": err instanceof Error ? err.message : String(err),
      "error.type": err instanceof Error ? err.constructor.name : typeof err,
    });

    return json({ error: "Bad gateway" }, 502);
  } finally {
    await Promise.all([logger.flush(), tracer.flush()]);
  }
});

// =============================================================================
// Helpers
// =============================================================================

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
