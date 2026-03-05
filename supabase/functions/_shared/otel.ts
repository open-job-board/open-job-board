// =============================================================================
// Lightweight OTLP/HTTP JSON log + trace exporter for Deno
// Implements the OpenTelemetry Log and Trace Data Models via OTLP/HTTP protocol
// directly, avoiding heavy SDK dependencies in the serverless environment.
// =============================================================================

const OTEL_ENDPOINT = Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") ??
  "http://otel.forgen.tech";

// OTLP severity numbers (https://opentelemetry.io/docs/specs/otel/logs/data-model/#severity-fields)
const SeverityNumber = {
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
} as const;

type SeverityName = keyof typeof SeverityNumber;

interface OtelAttribute {
  key: string;
  value: {
    boolValue?: boolean;
    doubleValue?: number;
    intValue?: string;
    stringValue?: string;
  };
}

interface OtelLogRecord {
  attributes: OtelAttribute[];
  body: { stringValue: string };
  severityNumber: number;
  severityText: string;
  spanId?: string;
  timeUnixNano: string;
  traceId?: string;
}

// ---------------------------------------------------------------------------
// Attribute encoding
// ---------------------------------------------------------------------------

function toAttribute(key: string, value: unknown): OtelAttribute {
  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

function encodeAttributes(
  attrs: Record<string, unknown>,
): OtelAttribute[] {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => toAttribute(k, v))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Collects log records during a single request lifecycle and flushes them
 * to the OTLP endpoint in one batch.
 *
 * Usage:
 *   const logger = createLogger("submit-job");
 *   logger.info("request received", { method: "POST" });
 *   // ... handle request ...
 *   await logger.flush();
 */
export class Logger {
  private records: OtelLogRecord[] = [];
  private resourceAttributes: OtelAttribute[];
  private scopeName: string;
  private traceId: string;

  constructor(scopeName: string) {
    this.scopeName = scopeName;
    this.traceId = crypto.randomUUID().replaceAll("-", "");
    this.resourceAttributes = encodeAttributes({
      "deployment.environment": Deno.env.get("ENVIRONMENT") ?? "production",
      "service.name": "open-job-board",
      "service.version": "1.0.0",
    });
  }

  /** Current trace ID — useful for including in error responses. */
  get currentTraceId(): string {
    return this.traceId;
  }

  debug(message: string, attrs: Record<string, unknown> = {}): void {
    this.record("DEBUG", message, attrs);
  }

  error(message: string, attrs: Record<string, unknown> = {}): void {
    this.record("ERROR", message, attrs);
  }

  info(message: string, attrs: Record<string, unknown> = {}): void {
    this.record("INFO", message, attrs);
  }

  warn(message: string, attrs: Record<string, unknown> = {}): void {
    this.record("WARN", message, attrs);
  }

  /**
   * Send all buffered log records to the OTLP collector.
   * Call this once at the end of request handling (in a `finally` block).
   */
  async flush(): Promise<void> {
    if (this.records.length === 0) return;

    const payload = {
      resourceLogs: [
        {
          resource: { attributes: this.resourceAttributes },
          scopeLogs: [
            {
              logRecords: this.records,
              scope: { name: this.scopeName, version: "1.0.0" },
            },
          ],
        },
      ],
    };

    const records = this.records;
    this.records = [];

    try {
      const response = await fetch(`${OTEL_ENDPOINT}/v1/logs`, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        console.error(
          `OTLP export failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      // Log export failure to stderr so it's visible in Supabase logs,
      // but never let telemetry errors crash the request.
      console.error("OTLP export error:", err);
      // Restore records so a retry is possible (best-effort)
      this.records = records.concat(this.records);
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private record(
    severity: SeverityName,
    message: string,
    attrs: Record<string, unknown>,
  ): void {
    this.records.push({
      attributes: encodeAttributes(attrs),
      body: { stringValue: message },
      severityNumber: SeverityNumber[severity],
      severityText: severity,
      timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
      traceId: this.traceId,
    });
  }
}

// ---------------------------------------------------------------------------
// Tracer (OTLP/HTTP JSON trace exporter)
// ---------------------------------------------------------------------------

interface OtelSpan {
  attributes: OtelAttribute[];
  endTimeUnixNano: string;
  kind: number;
  name: string;
  spanId: string;
  startTimeUnixNano: string;
  status: { code: number; message?: string };
  traceId: string;
}

/**
 * Records start/end time and attributes for a single OTEL span.
 *
 * Usage:
 *   const span = tracer.startSpan("GET /api/jobs", { "http.method": "GET" });
 *   // ... do work ...
 *   span.setAttribute("http.status_code", 200);
 *   span.end();
 */
export class SpanBuilder {
  private attributes: Record<string, unknown>;
  private name: string;
  private spanId: string;
  private startTimeNano: string;
  private tracer: Tracer;
  private traceId: string;

  constructor(
    tracer: Tracer,
    name: string,
    traceId: string,
    attrs: Record<string, unknown>,
  ) {
    this.attributes = attrs;
    this.name = name;
    this.spanId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    this.startTimeNano = String(BigInt(Date.now()) * 1_000_000n);
    this.tracer = tracer;
    this.traceId = traceId;
  }

  /** Finalize the span with an optional HTTP status code to set error status. */
  end(httpStatusCode?: number): void {
    const endTimeNano = String(BigInt(Date.now()) * 1_000_000n);
    const isError = httpStatusCode !== undefined && httpStatusCode >= 400;

    this.tracer.addSpan({
      attributes: encodeAttributes(this.attributes),
      endTimeUnixNano: endTimeNano,
      kind: 2, // SERVER
      name: this.name,
      spanId: this.spanId,
      startTimeUnixNano: this.startTimeNano,
      status: {
        code: isError ? 2 : 1, // ERROR : OK
        ...(isError ? { message: `HTTP ${httpStatusCode}` } : {}),
      },
      traceId: this.traceId,
    });
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }
}

/**
 * Collects trace spans during a single request lifecycle and flushes them
 * to the OTLP endpoint in one batch.
 *
 * Usage:
 *   const tracer = createTracer("api-jobs");
 *   const span = tracer.startSpan("GET /api/jobs");
 *   // ... handle request ...
 *   span.setAttribute("http.status_code", 200);
 *   span.end();
 *   await tracer.flush();
 */
export class Tracer {
  private resourceAttributes: OtelAttribute[];
  private scopeName: string;
  private spans: OtelSpan[] = [];
  private traceId: string;

  constructor(scopeName: string) {
    this.scopeName = scopeName;
    this.traceId = crypto.randomUUID().replaceAll("-", "");
    this.resourceAttributes = encodeAttributes({
      "deployment.environment": Deno.env.get("ENVIRONMENT") ?? "production",
      "service.name": "open-job-board",
      "service.version": "1.0.0",
    });
  }

  /** Current trace ID — useful for correlating logs and spans. */
  get currentTraceId(): string {
    return this.traceId;
  }

  /** @internal Called by SpanBuilder.end() to register a completed span. */
  addSpan(span: OtelSpan): void {
    this.spans.push(span);
  }

  startSpan(
    name: string,
    attrs: Record<string, unknown> = {},
  ): SpanBuilder {
    return new SpanBuilder(this, name, this.traceId, attrs);
  }

  /**
   * Send all buffered spans to the OTLP collector.
   * Call this once at the end of request handling (in a `finally` block).
   */
  async flush(): Promise<void> {
    if (this.spans.length === 0) return;

    const payload = {
      resourceSpans: [
        {
          resource: { attributes: this.resourceAttributes },
          scopeSpans: [
            {
              scope: { name: this.scopeName, version: "1.0.0" },
              spans: this.spans,
            },
          ],
        },
      ],
    };

    const spans = this.spans;
    this.spans = [];

    try {
      const response = await fetch(`${OTEL_ENDPOINT}/v1/traces`, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        console.error(
          `OTLP trace export failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      console.error("OTLP trace export error:", err);
      this.spans = spans.concat(this.spans);
    }
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Create a new Logger scoped to the given function name. */
export function createLogger(scopeName: string): Logger {
  return new Logger(scopeName);
}

/** Create a new Tracer scoped to the given function name. */
export function createTracer(scopeName: string): Tracer {
  return new Tracer(scopeName);
}
