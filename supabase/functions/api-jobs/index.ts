import { corsHeaders } from "../_shared/cors.ts";
import { createLogger, createTracer } from "../_shared/otel.ts";

// =============================================================================
// PostgREST proxy with OTEL instrumentation
//
// Proxies GET requests to PostgREST /rest/v1/jobs, forwarding all query
// parameters and relevant headers. Each request emits an OTLP trace span
// (for p99 latency and request count) and structured log records (for
// debugging and status-code breakdowns).
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Headers to forward from the client request to PostgREST
const FORWARD_REQUEST_HEADERS = [
  "Accept",
  "Accept-Profile",
  "Prefer",
  "Range",
] as const;

// Headers to forward from the PostgREST response back to the client
const FORWARD_RESPONSE_HEADERS = [
  "Content-Range",
  "Content-Type",
  "Preference-Applied",
] as const;

Deno.serve(async (req: Request) => {
  const logger = createLogger("api-jobs");
  const tracer = createTracer("api-jobs");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const span = tracer.startSpan("GET /api/jobs", {
    "http.method": "GET",
    "http.route": "/api/jobs",
    "http.url": req.url,
  });

  try {
    // Forward query parameters to PostgREST
    const url = new URL(req.url);
    const postgrestUrl = `${SUPABASE_URL}/rest/v1/jobs${url.search}`;

    // Build PostgREST request headers
    const headers: Record<string, string> = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };

    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = req.headers.get(name);
      if (value) headers[name] = value;
    }

    const startMs = performance.now();
    const upstream = await fetch(postgrestUrl, { headers });
    const durationMs = Math.round(performance.now() - startMs);

    const status = upstream.status;
    span.setAttribute("http.status_code", status);
    span.setAttribute("http.request.duration_ms", durationMs);
    span.end(status);

    logger.info("Request completed", {
      "http.method": "GET",
      "http.request.duration_ms": durationMs,
      "http.route": "/api/jobs",
      "http.status_code": status,
    });

    // Build response headers
    const responseHeaders = new Headers(corsHeaders);
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

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
