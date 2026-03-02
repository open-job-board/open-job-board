import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  afterAll,
  beforeEach,
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import {
  cleanupJobs,
  clearRateLimits,
  createApiKey,
  FUNCTIONS_URL,
  functionHeaders,
  makeJob,
  submitJob,
  testSource,
} from "./helpers.ts";

const TEST_SOURCE = `test-submit-${Date.now()}`;

describe("submit-job", () => {
  // Clear rate limits before each test to avoid exhaustion (limit is 10/min)
  beforeEach(async () => {
    await clearRateLimits();
  });

  afterAll(async () => {
    await cleanupJobs("test-");
  });

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  it("GET /submit-job returns health status", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/submit-job`, {
      headers: { Authorization: functionHeaders.Authorization },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ok");
    assertEquals(body.endpoint, "submit-job");
  });

  // -------------------------------------------------------------------------
  // Successful submission
  // -------------------------------------------------------------------------
  it("creates a job with minimal required fields", async () => {
    const job = makeJob({
      origin: { source: TEST_SOURCE, reference: "minimal-1" },
    });
    const res = await submitJob(job);
    assertEquals(res.status, 201);

    const body = await res.json();
    assertExists(body.id);
    assertExists(body.created_at);
    // UUID format check
    assertEquals(body.id.length, 36);
  });

  it("creates a job with all optional fields", async () => {
    const job = makeJob({
      origin: {
        source: TEST_SOURCE,
        reference: "full-1",
        contact: { name: "Jane", email: "jane@example.com", phone: "+1234567890" },
      },
      title: "Full Stack Engineer",
      description: "A comprehensive test job with all fields populated for integration testing purposes.",
      responsibilities: ["Build APIs", "Write tests"],
      company: {
        name: "TestCorp",
        website: "https://testcorp.example",
        sector: "Technology",
        anecdote: "We love testing",
        location: ["Berlin, Germany"],
      },
      employment_type: "full-time",
      location: {
        city: "Berlin",
        country: "Germany",
        remote: { full: true, days: 5 },
      },
      requirements: {
        qualifications: ["BSc in CS"],
        hard_skills: ["TypeScript", "Deno"],
        soft_skills: ["Communication"],
        others: ["Experience with Supabase"],
      },
      salary: {
        currency: "EUR",
        min: 80000,
        max: 120000,
        period: "yearly",
      },
      benefits: ["Health insurance", "Remote work"],
      posted_at: "2026-01-15T10:00:00Z",
      parsed_at: "2026-01-15T11:00:00Z",
    });

    const res = await submitJob(job);
    assertEquals(res.status, 201);

    const body = await res.json();
    assertExists(body.id);
  });

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------
  it("rejects invalid JSON body", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/submit-job`, {
      method: "POST",
      headers: functionHeaders,
      body: "{{bad json",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error, "Invalid JSON");
  });

  it("rejects missing origin", async () => {
    const res = await submitJob({
      title: "No Origin",
      description: "This job has no origin field and should fail validation.",
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error, "Validation failed");
  });

  it("rejects missing title", async () => {
    const res = await submitJob({
      origin: { source: TEST_SOURCE },
      description: "This job has no title and should fail validation.",
    });
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  it("rejects missing description", async () => {
    const res = await submitJob({
      origin: { source: TEST_SOURCE },
      title: "Missing Description",
    });
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  it("rejects too-short title (< 2 chars)", async () => {
    const res = await submitJob({
      origin: { source: TEST_SOURCE },
      title: "X",
      description: "This job has a title that is too short and should fail validation.",
    });
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  it("rejects too-short description (< 10 chars)", async () => {
    const res = await submitJob({
      origin: { source: TEST_SOURCE },
      title: "Short Desc",
      description: "Too short",
    });
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  it("rejects empty source", async () => {
    const res = await submitJob({
      origin: { source: "" },
      title: "Empty Source",
      description: "This job has an empty source and should fail validation.",
    });
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  it("rejects invalid salary period", async () => {
    const res = await submitJob(
      makeJob({
        origin: { source: TEST_SOURCE, reference: "bad-salary" },
        salary: { currency: "EUR", min: 100, max: 200, period: "biweekly" },
      }),
    );
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  it("rejects negative salary", async () => {
    const res = await submitJob(
      makeJob({
        origin: { source: TEST_SOURCE, reference: "neg-salary" },
        salary: { currency: "EUR", min: -1000, max: 200, period: "yearly" },
      }),
    );
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  it("rejects invalid company website URL", async () => {
    const res = await submitJob(
      makeJob({
        origin: { source: TEST_SOURCE, reference: "bad-url" },
        company: { name: "BadURL Corp", website: "not-a-url" },
      }),
    );
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  // -------------------------------------------------------------------------
  // Duplicate detection (409 Conflict)
  // -------------------------------------------------------------------------
  it("returns 409 for duplicate source + reference", async () => {
    const source = testSource();
    const job = makeJob({
      origin: { source, reference: "dup-ref" },
    });

    const res1 = await submitJob(job);
    assertEquals(res1.status, 201);
    await res1.json(); // consume body

    const res2 = await submitJob(job);
    assertEquals(res2.status, 409);
    const body = await res2.json();
    assertStringIncludes(body.error, "Duplicate");
  });

  // -------------------------------------------------------------------------
  // API key integration
  // -------------------------------------------------------------------------
  it("accepts submission with a valid API key", async () => {
    // Create an API key first
    const keyRes = await createApiKey({
      name: `test-submit-key-${Date.now()}`,
      email: "submit-test@example.com",
    });
    assertEquals(keyRes.status, 201);
    const { key } = await keyRes.json();

    // Submit with the key
    const job = makeJob({
      origin: { source: TEST_SOURCE, reference: `with-key-${Date.now()}` },
    });
    const res = await submitJob(job, { "X-API-Key": key });
    assertEquals(res.status, 201);
    await res.body?.cancel();
  });

  it("falls back to IP rate limit with invalid API key", async () => {
    const job = makeJob({
      origin: { source: TEST_SOURCE, reference: `bad-key-${Date.now()}` },
    });
    // An invalid key should not crash — just falls back to IP-based limiting
    const res = await submitJob(job, { "X-API-Key": "ojb_invalid_key_here" });
    assertEquals(res.status, 201);
    await res.body?.cancel();
  });

  // -------------------------------------------------------------------------
  // CORS preflight
  // -------------------------------------------------------------------------
  it("OPTIONS returns CORS headers", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/submit-job`, {
      method: "OPTIONS",
      headers: { Authorization: functionHeaders.Authorization },
    });
    assertEquals(res.status, 204);
    assertExists(res.headers.get("access-control-allow-origin"));
    await res.body?.cancel();
  });
});
