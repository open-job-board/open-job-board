import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import { getJobDetail, searchJobs } from "./helpers.ts";

/**
 * These tests exercise the api-job-detail Edge Function proxy.
 * The proxy forwards POST requests to PostgREST /rest/v1/rpc/get_job_detail
 * with OTEL instrumentation. Tests rely on seed data from supabase/seed.sql.
 */
describe("api-job-detail (Edge Function proxy)", () => {
  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  it("returns health check on GET", async () => {
    const res = await getJobDetail({}, { method: "GET" });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.endpoint, "api-job-detail");
    assertEquals(body.status, "ok");
  });

  // -------------------------------------------------------------------------
  // CORS
  // -------------------------------------------------------------------------
  it("responds to CORS preflight", async () => {
    const res = await getJobDetail({}, { method: "OPTIONS" });
    assertEquals(res.status, 204);
    assertExists(res.headers.get("access-control-allow-origin"));
    await res.body?.cancel();
  });

  // -------------------------------------------------------------------------
  // Method enforcement
  // -------------------------------------------------------------------------
  it("rejects unsupported methods", async () => {
    const res = await getJobDetail({}, { method: "PUT" });
    assertEquals(res.status, 405);
    const body = await res.json();
    assertEquals(body.error, "Method not allowed");
  });

  // -------------------------------------------------------------------------
  // Job detail retrieval
  // -------------------------------------------------------------------------
  it("returns full job details for a valid ID", async () => {
    // Get a job ID from the search edge function
    const searchRes = await searchJobs({
      source_filter: "seed",
      page_size: 1,
    });
    assertEquals(searchRes.status, 200);
    const [searchJob] = await searchRes.json();
    assertExists(searchJob, "Need at least one seed job");

    // Fetch full detail through the edge function
    const res = await getJobDetail({ job_id: searchJob.id });
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
    const res = await getJobDetail({
      job_id: "00000000-0000-0000-0000-000000000000",
    });
    assertEquals(res.status, 200);
    const details = await res.json();
    assertEquals(details.length, 0);
  });

  it("returns contact info in full detail", async () => {
    const searchRes = await searchJobs({
      source_filter: "seed",
      page_size: 1,
    });
    const [searchJob] = await searchRes.json();
    const res = await getJobDetail({ job_id: searchJob.id });
    const [job] = await res.json();
    assert("contact" in job, "get_job_detail should include contact field");
  });

  it("returns company details in full detail", async () => {
    const searchRes = await searchJobs({
      query: "backend",
      source_filter: "seed",
      page_size: 1,
    });
    const [searchJob] = await searchRes.json();
    const res = await getJobDetail({ job_id: searchJob.id });
    const [job] = await res.json();
    assertExists(job.company_name);
    assertExists(job.company_website);
    assert("company_sector" in job);
    assert("company_anecdote" in job);
    assert("company_locations" in job);
  });
});
