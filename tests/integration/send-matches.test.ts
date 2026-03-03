/**
 * Integration tests for the send-matches Edge Function and match scoring.
 *
 * Tests the full flow: profile → schedule → find matches → send → record.
 * Expects a local Supabase instance running via `supabase start`.
 */

import {
  assertEquals,
  assert,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FUNCTIONS_URL,
  functionHeaders,
  createApiKey,
  SERVICE_ROLE_KEY,
  REST_URL,
} from "./helpers.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createTestApiKey(): Promise<{ id: string; key: string }> {
  const name = `test-match-${crypto.randomUUID().slice(0, 8)}`;
  const res = await createApiKey({ name, email: `${name}@test.local` });
  assertEquals(res.status, 201);
  const body = await res.json();
  // create-api-key doesn't return the DB id, so look it up by hash
  const keyHash = await sha256hex(body.key);
  const lookup = await fetch(
    `${REST_URL}/api_keys?key_hash=eq.${keyHash}&select=id`,
    { headers: serviceHeaders },
  );
  const [record] = await lookup.json();
  return { id: record.id, key: body.key };
}

async function createProfileWithSchedule(
  apiKeyId: string,
  profile: Record<string, unknown>,
  schedule: Record<string, unknown>,
): Promise<{ profileId: string; scheduleId: string }> {
  // Insert profile directly via service role
  const { data: prof } = await fetch(`${REST_URL}/user_profiles`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ api_key_id: apiKeyId, ...profile }),
  }).then((r) => r.json().then((d) => ({ data: Array.isArray(d) ? d[0] : d })));

  assertExists(prof.id);

  // Insert schedule
  const { data: sched } = await fetch(`${REST_URL}/match_schedules`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ user_profile_id: prof.id, ...schedule }),
  }).then((r) => r.json().then((d) => ({ data: Array.isArray(d) ? d[0] : d })));

  assertExists(sched.id);

  return { profileId: prof.id, scheduleId: sched.id };
}

async function cleanup(apiKeyId: string): Promise<void> {
  // Cascade deletes handle schedule + sent_matches
  await fetch(`${REST_URL}/user_profiles?api_key_id=eq.${apiKeyId}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
  await fetch(`${REST_URL}/api_keys?id=eq.${apiKeyId}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
}

async function callSendMatches(): Promise<Response> {
  return fetch(`${FUNCTIONS_URL}/send-matches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: "{}",
  });
}

async function getSentMatches(profileId: string): Promise<unknown[]> {
  const res = await fetch(
    `${REST_URL}/sent_matches?user_profile_id=eq.${profileId}`,
    { headers: serviceHeaders },
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("send-matches: rejects non-service-role requests", async () => {
  const res = await fetch(`${FUNCTIONS_URL}/send-matches`, {
    method: "POST",
    headers: functionHeaders,
    body: "{}",
  });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized — service role required");
});

Deno.test("send-matches: returns 0 processed when no schedules due", async () => {
  const res = await callSendMatches();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.message, "No schedules due");
});

Deno.test("send-matches: GET health check works", async () => {
  const res = await fetch(`${FUNCTIONS_URL}/send-matches`, {
    method: "GET",
    headers: functionHeaders,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ok");
});

Deno.test("find_best_matches: returns matching jobs", async () => {
  const { id: apiKeyId } = await createTestApiKey();
  try {
    // Create a profile looking for Go backend jobs in Germany
    const { profileId } = await createProfileWithSchedule(
      apiKeyId,
      {
        title_keywords: ["backend", "engineer"],
        skills: ["Go", "PostgreSQL"],
        location_country: "Germany",
        remote_only: false,
        active_looking: true,
        webhook_url: "https://example.com/test-hook",
      },
      {
        interval_minutes: 5,
        next_run_at: new Date(Date.now() - 60000).toISOString(), // already due
        is_active: true,
      },
    );

    // Call find_best_matches via RPC
    const res = await fetch(`${REST_URL}/rpc/find_best_matches`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({
        p_user_profile_id: profileId,
        p_limit: 10,
      }),
    });
    assertEquals(res.status, 200);

    const matches = await res.json();
    assert(Array.isArray(matches));
    // Seed data has "Senior Backend Engineer (Go)" in Berlin, Germany
    // which should match title_keywords and skills
    if (matches.length > 0) {
      assertExists(matches[0].job_id);
      assertExists(matches[0].title);
      assert(matches[0].score > 0, "Score should be positive for a match");
    }
  } finally {
    await cleanup(apiKeyId);
  }
});

Deno.test("find_best_matches: excludes already-sent jobs", async () => {
  const { id: apiKeyId } = await createTestApiKey();
  try {
    const { profileId } = await createProfileWithSchedule(
      apiKeyId,
      {
        title_keywords: ["backend"],
        skills: ["Go", "PostgreSQL"],
        location_country: "Germany",
        active_looking: true,
        webhook_url: "https://example.com/test-hook",
      },
      { interval_minutes: 5, is_active: true },
    );

    // Get initial matches
    const res1 = await fetch(`${REST_URL}/rpc/find_best_matches`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({ p_user_profile_id: profileId, p_limit: 50 }),
    });
    const matches1 = await res1.json();
    const initialCount = matches1.length;

    if (initialCount > 0) {
      // Record first match as sent
      await fetch(`${REST_URL}/rpc/record_sent_matches`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({
          p_user_profile_id: profileId,
          p_matches: [{ job_id: matches1[0].job_id, score: matches1[0].score }],
        }),
      });

      // Get matches again — should have one fewer
      const res2 = await fetch(`${REST_URL}/rpc/find_best_matches`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({ p_user_profile_id: profileId, p_limit: 50 }),
      });
      const matches2 = await res2.json();
      assertEquals(matches2.length, initialCount - 1);
    }
  } finally {
    await cleanup(apiKeyId);
  }
});

Deno.test("advance_schedule: updates next_run_at", async () => {
  const { id: apiKeyId } = await createTestApiKey();
  try {
    const { scheduleId } = await createProfileWithSchedule(
      apiKeyId,
      {
        title_keywords: ["test"],
        active_looking: true,
        webhook_url: "https://example.com/test-hook",
      },
      {
        interval_minutes: 60,
        next_run_at: new Date(Date.now() - 60000).toISOString(),
        is_active: true,
      },
    );

    // Advance the schedule
    await fetch(`${REST_URL}/rpc/advance_schedule`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({ p_schedule_id: scheduleId }),
    });

    // Check that next_run_at has been advanced
    const res = await fetch(
      `${REST_URL}/match_schedules?id=eq.${scheduleId}`,
      { headers: serviceHeaders },
    );
    const [schedule] = await res.json();
    assertExists(schedule.last_run_at);
    assert(
      new Date(schedule.next_run_at) > new Date(),
      "next_run_at should be in the future",
    );
  } finally {
    await cleanup(apiKeyId);
  }
});

Deno.test("get_due_schedules: returns only due and active schedules", async () => {
  const { id: apiKeyId1 } = await createTestApiKey();
  const { id: apiKeyId2 } = await createTestApiKey();
  try {
    // Profile 1: due schedule
    await createProfileWithSchedule(
      apiKeyId1,
      {
        title_keywords: ["test"],
        active_looking: true,
        webhook_url: "https://example.com/due",
      },
      {
        interval_minutes: 5,
        next_run_at: new Date(Date.now() - 60000).toISOString(), // past = due
        is_active: true,
      },
    );

    // Profile 2: not due (future)
    await createProfileWithSchedule(
      apiKeyId2,
      {
        title_keywords: ["test"],
        active_looking: true,
        webhook_url: "https://example.com/notdue",
      },
      {
        interval_minutes: 5,
        next_run_at: new Date(Date.now() + 3600000).toISOString(), // 1h from now
        is_active: true,
      },
    );

    const res = await fetch(`${REST_URL}/rpc/get_due_schedules`, {
      method: "POST",
      headers: serviceHeaders,
    });
    const schedules = await res.json();

    // At least the due one should be present
    const dueWebhooks = schedules.map(
      (s: { webhook_url: string }) => s.webhook_url,
    );
    assert(
      dueWebhooks.includes("https://example.com/due"),
      "Should include due schedule",
    );
    assert(
      !dueWebhooks.includes("https://example.com/notdue"),
      "Should not include future schedule",
    );
  } finally {
    await cleanup(apiKeyId1);
    await cleanup(apiKeyId2);
  }
});
