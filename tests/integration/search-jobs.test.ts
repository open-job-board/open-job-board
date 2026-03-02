import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import { rpc } from "./helpers.ts";

/**
 * These tests exercise the search_jobs and get_job_detail RPC functions.
 * They rely on the 10 seed jobs from supabase/seed.sql.
 */
describe("search_jobs RPC", () => {
  // -------------------------------------------------------------------------
  // Basic search
  // -------------------------------------------------------------------------
  it("returns results for a keyword query", async () => {
    const res = await rpc("search_jobs", { query: "backend engineer" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(Array.isArray(jobs));
    assert(jobs.length > 0, "Expected at least one result for 'backend engineer'");
  });

  it("returns a rank field for relevance", async () => {
    const res = await rpc("search_jobs", { query: "backend" });
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
    const res = await rpc("search_jobs", { query: "engineer" });
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
    const res = await rpc("search_jobs", { query: "xyzzyplugh42" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assertEquals(jobs.length, 0);
  });

  // -------------------------------------------------------------------------
  // Filters without keyword
  // -------------------------------------------------------------------------
  it("returns all jobs when no query or filters specified", async () => {
    const res = await rpc("search_jobs", {});
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Should return seed jobs with no filters");
  });

  it("filters by country without keyword", async () => {
    const res = await rpc("search_jobs", { country: "Germany" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected German jobs");
    for (const job of jobs) {
      assertEquals(job.location_country, "Germany");
    }
  });

  it("filters by city", async () => {
    const res = await rpc("search_jobs", { city: "Paris" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected Paris jobs from seed");
    for (const job of jobs) {
      assertEquals(job.location_city, "Paris");
    }
  });

  it("filters by remote", async () => {
    const res = await rpc("search_jobs", { remote: true });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected remote jobs from seed");
    for (const job of jobs) {
      assertEquals(job.remote_full, true);
    }
  });

  it("filters by employment type", async () => {
    const res = await rpc("search_jobs", { employment: "part-time" });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length > 0, "Expected part-time seed jobs");
    for (const job of jobs) {
      assertEquals(job.employment_type, "part-time");
    }
  });

  it("filters by salary range", async () => {
    const res = await rpc("search_jobs", {
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
    const res = await rpc("search_jobs", { source_filter: "seed" });
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
    const res = await rpc("search_jobs", {
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
    const res = await rpc("search_jobs", {
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
    const res1 = await rpc("search_jobs", {
      source_filter: "seed",
      page_num: 1,
      page_size: 3,
    });
    const res2 = await rpc("search_jobs", {
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

    // No overlap
    const ids1 = new Set(page1.map((j: { id: string }) => j.id));
    for (const job of page2) {
      assert(!ids1.has(job.id), "Pages should not overlap");
    }
  });

  it("caps page_size at 100", async () => {
    const res = await rpc("search_jobs", { page_size: 999 });
    assertEquals(res.status, 200);
    const jobs = await res.json();
    assert(jobs.length <= 100, "Should cap at 100 results");
  });
});

describe("get_job_detail RPC", () => {
  it("returns full job details for a valid ID", async () => {
    // First get a job ID from search
    const searchRes = await rpc("search_jobs", {
      source_filter: "seed",
      page_size: 1,
    });
    assertEquals(searchRes.status, 200);
    const [searchJob] = await searchRes.json();
    assertExists(searchJob, "Need at least one seed job");

    // Now fetch full detail
    const res = await rpc("get_job_detail", { job_id: searchJob.id });
    assertEquals(res.status, 200);
    const details = await res.json();
    assert(Array.isArray(details));
    assertEquals(details.length, 1);

    const job = details[0];
    assertEquals(job.id, searchJob.id);
    assertExists(job.title);
    assertExists(job.description);
    assertExists(job.source);
    assertExists(job.created_at);
    // Full detail should include JSONB fields
    assert(job.responsibilities !== undefined);
    assert(job.benefits !== undefined);
    assert(job.requirements !== undefined);
  });

  it("returns empty array for non-existent ID", async () => {
    const res = await rpc("get_job_detail", {
      job_id: "00000000-0000-0000-0000-000000000000",
    });
    assertEquals(res.status, 200);
    const details = await res.json();
    assertEquals(details.length, 0);
  });

  it("returns contact info in full detail", async () => {
    // Seed job 1 doesn't have contact, but the full-field submission test creates one with contact
    // Let's just verify the contact field exists in the response shape
    const searchRes = await rpc("search_jobs", {
      source_filter: "seed",
      page_size: 1,
    });
    const [searchJob] = await searchRes.json();
    const res = await rpc("get_job_detail", { job_id: searchJob.id });
    const [job] = await res.json();
    // contact field should be present (null or object)
    assert("contact" in job, "get_job_detail should include contact field");
  });

  it("returns company details in full detail", async () => {
    const searchRes = await rpc("search_jobs", {
      query: "backend",
      source_filter: "seed",
      page_size: 1,
    });
    const [searchJob] = await searchRes.json();
    const res = await rpc("get_job_detail", { job_id: searchJob.id });
    const [job] = await res.json();
    assertExists(job.company_name);
    assertExists(job.company_website);
    assert("company_sector" in job);
    assert("company_anecdote" in job);
    assert("company_locations" in job);
  });
});
