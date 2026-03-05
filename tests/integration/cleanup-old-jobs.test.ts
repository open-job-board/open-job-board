import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  afterAll,
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import {
  cleanupJobs,
  clearRateLimits,
  FUNCTIONS_URL,
  functionHeaders,
  REST_URL,
  SERVICE_ROLE_KEY,
  submitJob,
} from "./helpers.ts";

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

describe("cleanup-old-jobs", () => {
  const source = `test-cleanup-${Date.now()}`;

  afterAll(async () => {
    await cleanupJobs("test-cleanup-");
  });

  // -------------------------------------------------------------------------
  // Basic invocation
  // -------------------------------------------------------------------------
  it("POST /cleanup-old-jobs returns deleted count", async () => {
    await clearRateLimits();

    const res = await fetch(`${FUNCTIONS_URL}/cleanup-old-jobs`, {
      method: "POST",
      headers: functionHeaders,
    });

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(typeof body.deleted, "number");
    assertEquals(typeof body.cutoff, "string");
  });

  // -------------------------------------------------------------------------
  // Deletes jobs with old posted_at, keeps recent ones
  // -------------------------------------------------------------------------
  it("deletes jobs with posted_at older than 7 days and keeps recent ones", async () => {
    await clearRateLimits();

    // Submit a recent job via the edge function (posted today)
    const recentRef = `ref-recent-${crypto.randomUUID().slice(0, 8)}`;
    const submitRes = await submitJob({
      origin: { source, reference: recentRef },
      title: "Recent Job",
      description: "This job was just posted and should survive cleanup.",
      posted_at: new Date().toISOString(),
    });
    assertEquals(submitRes.status, 201);
    const { id: recentId } = await submitRes.json();

    // Insert a job with old posted_at directly via PostgREST
    const oldRef = `ref-old-${crypto.randomUUID().slice(0, 8)}`;
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const insertRes = await fetch(`${REST_URL}/jobs`, {
      method: "POST",
      headers: {
        ...serviceHeaders,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        source,
        reference: oldRef,
        title: "Old Posted Job",
        description: "This job was posted 10 days ago and should be deleted by cleanup.",
        posted_at: tenDaysAgo.toISOString(),
      }),
    });
    assertEquals(insertRes.status, 201);
    const [{ id: oldId }] = await insertRes.json();

    // Run cleanup
    const cleanupRes = await fetch(`${FUNCTIONS_URL}/cleanup-old-jobs`, {
      method: "POST",
      headers: functionHeaders,
    });
    assertEquals(cleanupRes.status, 200);
    const cleanupBody = await cleanupRes.json();
    assertEquals(cleanupBody.deleted >= 1, true, "Should have deleted at least 1 old job");

    // Verify: old job is gone
    const oldCheck = await fetch(
      `${REST_URL}/jobs?id=eq.${oldId}`,
      { headers: serviceHeaders },
    );
    const oldJobs = await oldCheck.json();
    assertEquals(oldJobs.length, 0, "Old job should be deleted");

    // Verify: recent job still exists
    const recentCheck = await fetch(
      `${REST_URL}/jobs?id=eq.${recentId}`,
      { headers: serviceHeaders },
    );
    const recentJobs = await recentCheck.json();
    assertEquals(recentJobs.length, 1, "Recent job should still exist");
  });

  // -------------------------------------------------------------------------
  // Falls back to created_at when posted_at is null
  // -------------------------------------------------------------------------
  it("deletes jobs without posted_at based on created_at", async () => {
    await clearRateLimits();

    // Insert a job with no posted_at and old created_at
    const oldRef = `ref-no-posted-${crypto.randomUUID().slice(0, 8)}`;
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const insertRes = await fetch(`${REST_URL}/jobs`, {
      method: "POST",
      headers: {
        ...serviceHeaders,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        source,
        reference: oldRef,
        title: "No Posted At Job",
        description: "This job has no posted_at and old created_at, should be deleted.",
        created_at: tenDaysAgo.toISOString(),
      }),
    });
    assertEquals(insertRes.status, 201);
    const [{ id: oldId }] = await insertRes.json();

    // Run cleanup
    const cleanupRes = await fetch(`${FUNCTIONS_URL}/cleanup-old-jobs`, {
      method: "POST",
      headers: functionHeaders,
    });
    assertEquals(cleanupRes.status, 200);
    const cleanupBody = await cleanupRes.json();
    assertEquals(cleanupBody.deleted >= 1, true, "Should have deleted at least 1 job");

    // Verify: job without posted_at is gone
    const check = await fetch(
      `${REST_URL}/jobs?id=eq.${oldId}`,
      { headers: serviceHeaders },
    );
    const jobs = await check.json();
    assertEquals(jobs.length, 0, "Job without posted_at should be deleted based on created_at");
  });
});
