import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import { fetchJobs } from "./helpers.ts";

/**
 * These tests exercise the api-jobs Edge Function proxy.
 * The proxy forwards GET requests to PostgREST /rest/v1/jobs with OTEL
 * instrumentation. Tests rely on seed data from supabase/seed.sql.
 */
describe("api-jobs (Edge Function proxy)", () => {
  // -------------------------------------------------------------------------
  // Basic listing
  // -------------------------------------------------------------------------
  it("lists jobs without filters", async () => {
    const res = await fetchJobs();
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(Array.isArray(jobs));
    assert(jobs.length > 0, "Expected at least one job from seed data");
  });

  it("returns expected columns", async () => {
    const res = await fetchJobs("limit=1");
    assertEquals(res.status, 200);
    const [job] = await res.json();
    assertExists(job.id);
    assertExists(job.title);
    assertExists(job.source);
    assertExists(job.created_at);
  });

  // -------------------------------------------------------------------------
  // CORS
  // -------------------------------------------------------------------------
  it("responds to CORS preflight", async () => {
    const res = await fetchJobs("", { method: "OPTIONS" });
    assertEquals(res.status, 204);
    assertExists(res.headers.get("access-control-allow-origin"));
    await res.body?.cancel();
  });

  // -------------------------------------------------------------------------
  // Method enforcement
  // -------------------------------------------------------------------------
  it("rejects non-GET/OPTIONS methods", async () => {
    const res = await fetchJobs("", { method: "POST" });
    assertEquals(res.status, 405);
    const body = await res.json();
    assertEquals(body.error, "Method not allowed");
  });

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------
  it("filters by country", async () => {
    const res = await fetchJobs("location_country=eq.Germany");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected Germany seed jobs");
    for (const job of jobs) {
      assertEquals(job.location_country, "Germany");
    }
  });

  it("filters by city", async () => {
    const res = await fetchJobs("location_city=eq.Berlin");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected Berlin seed jobs");
    for (const job of jobs) {
      assertEquals(job.location_city, "Berlin");
    }
  });

  it("filters by remote_full", async () => {
    const res = await fetchJobs("remote_full=eq.true");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected remote seed jobs");
    for (const job of jobs) {
      assertEquals(job.remote_full, true);
    }
  });

  it("filters by employment_type", async () => {
    const res = await fetchJobs("employment_type=eq.part-time");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected part-time seed jobs");
    for (const job of jobs) {
      assertEquals(job.employment_type, "part-time");
    }
  });

  it("filters by salary range", async () => {
    const res = await fetchJobs("salary_min=gte.80000&salary_max=lte.150000");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    for (const job of jobs) {
      if (job.salary_min !== null) {
        assert(job.salary_min >= 80000, `salary_min ${job.salary_min} should be >= 80000`);
      }
      if (job.salary_max !== null) {
        assert(job.salary_max <= 150000, `salary_max ${job.salary_max} should be <= 150000`);
      }
    }
  });

  it("filters by source", async () => {
    const res = await fetchJobs("source=eq.seed");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected seed-sourced jobs");
    for (const job of jobs) {
      assertEquals(job.source, "seed");
    }
  });

  it("combines multiple filters", async () => {
    const res = await fetchJobs("location_country=eq.Germany&remote_full=eq.true&source=eq.seed");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected German remote seed jobs");
    for (const job of jobs) {
      assertEquals(job.location_country, "Germany");
      assertEquals(job.remote_full, true);
    }
  });

  it("returns empty array for non-matching filter", async () => {
    const res = await fetchJobs("location_country=eq.Narnia");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assertEquals(jobs.length, 0);
  });

  // -------------------------------------------------------------------------
  // Fuzzy search with ilike
  // -------------------------------------------------------------------------
  it("supports ilike title search", async () => {
    const res = await fetchJobs("title=ilike.*engineer*");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected seed jobs with 'engineer' in title");
    for (const job of jobs) {
      assert(
        job.title.toLowerCase().includes("engineer"),
        `Title "${job.title}" should contain 'engineer'`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  it("supports limit parameter", async () => {
    const res = await fetchJobs("limit=3&source=eq.seed");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length <= 3, `Expected at most 3 jobs, got ${jobs.length}`);
  });

  it("supports offset parameter", async () => {
    const res1 = await fetchJobs("source=eq.seed&limit=3&offset=0&order=reference.asc");
    const res2 = await fetchJobs("source=eq.seed&limit=3&offset=3&order=reference.asc");

    assertEquals(res1.status, 200);
    assertEquals(res2.status, 200);

    const page1 = await res1.json();
    const page2 = await res2.json();

    assertEquals(page1.length, 3);
    assert(page2.length > 0, "Expected second page to have results");

    const ids1 = new Set(page1.map((j: { id: string }) => j.id));
    for (const job of page2) {
      assert(!ids1.has(job.id), "Pages should not have overlapping jobs");
    }
  });

  // -------------------------------------------------------------------------
  // Ordering
  // -------------------------------------------------------------------------
  it("supports ordering by posted_at desc", async () => {
    const res = await fetchJobs("source=eq.seed&order=posted_at.desc.nullslast");
    assertEquals(res.status, 200);
    const jobs = await res.json();
    for (let i = 1; i < jobs.length; i++) {
      if (jobs[i - 1].posted_at && jobs[i].posted_at) {
        assert(
          jobs[i - 1].posted_at >= jobs[i].posted_at,
          "Jobs should be ordered by posted_at DESC",
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  // Column selection
  // -------------------------------------------------------------------------
  it("supports select to limit returned columns", async () => {
    const res = await fetchJobs("select=id,title&limit=1");
    assertEquals(res.status, 200);
    const [job] = await res.json();
    assertExists(job.id);
    assertExists(job.title);
    assertEquals(job.description, undefined);
    assertEquals(job.source, undefined);
  });

  // -------------------------------------------------------------------------
  // Response headers
  // -------------------------------------------------------------------------
  it("forwards Content-Type header from PostgREST", async () => {
    const res = await fetchJobs("limit=1");
    assertEquals(res.status, 200);
    const ct = res.headers.get("content-type");
    assert(ct !== null && ct.includes("application/json"), "Expected JSON content type");
    await res.json(); // consume body
  });
});
