import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import { searchJobs } from "./helpers.ts";

/**
 * These tests exercise the api-search Edge Function proxy.
 * The proxy forwards POST requests to PostgREST /rest/v1/rpc/search_jobs
 * with OTEL instrumentation. Tests rely on seed data from supabase/seed.sql.
 */
describe("api-search (Edge Function proxy)", () => {
  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  it("returns health check on GET", async () => {
    const res = await searchJobs({}, { method: "GET" });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.endpoint, "api-search");
    assertEquals(body.status, "ok");
  });

  // -------------------------------------------------------------------------
  // CORS
  // -------------------------------------------------------------------------
  it("responds to CORS preflight", async () => {
    const res = await searchJobs({}, { method: "OPTIONS" });
    assertEquals(res.status, 204);
    assertExists(res.headers.get("access-control-allow-origin"));
    await res.body?.cancel();
  });

  // -------------------------------------------------------------------------
  // Method enforcement
  // -------------------------------------------------------------------------
  it("rejects unsupported methods", async () => {
    const res = await searchJobs({}, { method: "PUT" });
    assertEquals(res.status, 405);
    const body = await res.json();
    assertEquals(body.error, "Method not allowed");
  });

  // -------------------------------------------------------------------------
  // Basic search
  // -------------------------------------------------------------------------
  it("returns results for a keyword query", async () => {
    const res = await searchJobs({ query: "backend engineer" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(Array.isArray(jobs));
    assert(jobs.length > 0, "Expected at least one result for 'backend engineer'");
  });

  it("returns a rank field for relevance", async () => {
    const res = await searchJobs({ query: "backend" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0);
    for (const job of jobs) {
      assertExists(job.rank);
      assert(typeof job.rank === "number");
      assert(job.rank > 0, "Rank should be positive for matching results");
    }
  });

  it("orders results by relevance", async () => {
    const res = await searchJobs({ query: "engineer" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    for (let i = 1; i < jobs.length; i++) {
      assert(
        jobs[i - 1].rank >= jobs[i].rank,
        `Results should be ordered by rank DESC: ${jobs[i - 1].rank} >= ${jobs[i].rank}`,
      );
    }
  });

  it("returns empty array for nonsense query", async () => {
    const res = await searchJobs({ query: "xyzzyplugh42" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assertEquals(jobs.length, 0);
  });

  // -------------------------------------------------------------------------
  // Filters without keyword
  // -------------------------------------------------------------------------
  it("returns all jobs when no query or filters specified", async () => {
    const res = await searchJobs({});
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Should return seed jobs with no filters");
  });

  it("filters by country without keyword", async () => {
    const res = await searchJobs({ country: "Germany" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected German jobs");
    for (const job of jobs) {
      assertEquals(job.location_country, "Germany");
    }
  });

  it("filters by city", async () => {
    const res = await searchJobs({ city: "Paris" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected Paris jobs from seed");
    for (const job of jobs) {
      assertEquals(job.location_city, "Paris");
    }
  });

  it("filters by remote", async () => {
    const res = await searchJobs({ remote: true });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected remote jobs from seed");
    for (const job of jobs) {
      assertEquals(job.remote_full, true);
    }
  });

  it("filters by employment type", async () => {
    const res = await searchJobs({ employment: "part-time" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected part-time seed jobs");
    for (const job of jobs) {
      assertEquals(job.employment_type, "part-time");
    }
  });

  it("filters by salary range", async () => {
    const res = await searchJobs({
      salary_min_val: 80000,
      salary_max_val: 140000,
    });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    for (const job of jobs) {
      if (job.salary_min !== null) {
        assert(job.salary_min >= 80000);
      }
      if (job.salary_max !== null) {
        assert(job.salary_max <= 140000);
      }
    }
  });

  it("filters by source", async () => {
    const res = await searchJobs({ source_filter: "seed" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0);
    for (const job of jobs) {
      assertEquals(job.source, "seed");
    }
  });

  // -------------------------------------------------------------------------
  // Combined keyword + filter
  // -------------------------------------------------------------------------
  it("combines keyword with country filter", async () => {
    const res = await searchJobs({
      query: "engineer",
      country: "Germany",
    });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected German engineer jobs");
    for (const job of jobs) {
      assertEquals(job.location_country, "Germany");
    }
  });

  it("combines keyword with remote filter", async () => {
    const res = await searchJobs({
      query: "security",
      remote: true,
    });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected remote security jobs");
    for (const job of jobs) {
      assertEquals(job.remote_full, true);
    }
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  it("paginates with page_num and page_size", async () => {
    const res1 = await searchJobs({
      source_filter: "seed",
      page_num: 1,
      page_size: 3,
    });
    const res2 = await searchJobs({
      source_filter: "seed",
      page_num: 2,
      page_size: 3,
    });

    assertEquals(res1.status, 200);
    assertEquals(res2.status, 200);

    const page1 = await res1.json();
    const page2 = await res2.json();

    assertEquals(page1.length, 3);
    assert(page2.length > 0, "Expected second page to have results");

    const ids1 = new Set(page1.map((j: { id: string }) => j.id));
    for (const job of page2) {
      assert(!ids1.has(job.id), "Pages should not overlap");
    }
  });

  it("caps page_size at 100", async () => {
    const res = await searchJobs({ page_size: 999 });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length <= 100, "Should cap at 100 results");
  });
});
