/**
 * Integration tests for the manage-profile Edge Function.
 *
 * Tests profile CRUD, schedule management, and validation.
 * Expects a local Supabase instance running via `supabase start`.
 */

import {
  assertEquals,
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
  const name = `test-profile-${crypto.randomUUID().slice(0, 8)}`;
  const res = await createApiKey({ name, email: `${name}@test.local` });
  assertEquals(res.status, 201);
  const body = await res.json();
  // create-api-key doesn't return the DB id, so look it up by hash
  const keyHash = await sha256hex(body.key);
  const lookup = await fetch(
    `${REST_URL}/api_keys?key_hash=eq.${keyHash}&select=id`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  const [record] = await lookup.json();
  return { id: record.id, key: body.key };
}

function profileHeaders(apiKey: string): Record<string, string> {
  return {
    ...functionHeaders,
    "X-API-Key": apiKey,
  };
}

async function manageProfile(
  method: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: profileHeaders(apiKey),
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  return fetch(`${FUNCTIONS_URL}/manage-profile`, opts);
}

async function cleanupProfile(apiKeyId: string): Promise<void> {
  // Delete profile (cascades to schedule + sent_matches)
  await fetch(`${REST_URL}/user_profiles?api_key_id=eq.${apiKeyId}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  // Delete API key
  await fetch(`${REST_URL}/api_keys?id=eq.${apiKeyId}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("manage-profile: requires API key", async () => {
  const res = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
    method: "GET",
    headers: functionHeaders,
  });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Missing X-API-Key header");
});

Deno.test("manage-profile: rejects invalid API key", async () => {
  const res = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
    method: "GET",
    headers: { ...functionHeaders, "X-API-Key": "invalid-key-12345" },
  });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Invalid or inactive API key");
});

Deno.test("manage-profile: GET returns null for new user", async () => {
  const { id, key } = await createTestApiKey();
  try {
    const res = await manageProfile("GET", key);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.profile, null);
    assertEquals(body.schedule, null);
  } finally {
    await cleanupProfile(id);
  }
});

Deno.test("manage-profile: POST creates profile", async () => {
  const { id, key } = await createTestApiKey();
  try {
    const res = await manageProfile("POST", key, {
      profile: {
        title_keywords: ["backend", "engineer"],
        skills: ["Go", "PostgreSQL"],
        location_country: "Germany",
        remote_only: true,
        active_looking: true,
        webhook_url: "https://example.com/webhook",
      },
    });
    assertEquals(res.status, 201);
    const body = await res.json();
    assertExists(body.profile.id);
    assertEquals(body.profile.title_keywords, ["backend", "engineer"]);
    assertEquals(body.profile.skills, ["Go", "PostgreSQL"]);
    assertEquals(body.profile.remote_only, true);
    assertEquals(body.profile.active_looking, true);
    assertEquals(body.schedule, null); // no schedule provided
  } finally {
    await cleanupProfile(id);
  }
});

Deno.test("manage-profile: POST creates profile + schedule", async () => {
  const { id, key } = await createTestApiKey();
  try {
    const res = await manageProfile("POST", key, {
      profile: {
        title_keywords: ["frontend"],
        skills: ["React", "TypeScript"],
        active_looking: true,
        webhook_url: "https://example.com/hook",
      },
      schedule: {
        interval_minutes: 60,
        max_matches: 5,
      },
    });
    assertEquals(res.status, 201);
    const body = await res.json();
    assertExists(body.profile.id);
    assertExists(body.schedule.id);
    assertEquals(body.schedule.interval_minutes, 60);
    assertEquals(body.schedule.max_matches, 5);
    assertEquals(body.schedule.is_active, true);
  } finally {
    await cleanupProfile(id);
  }
});

Deno.test("manage-profile: POST updates existing profile", async () => {
  const { id, key } = await createTestApiKey();
  try {
    // Create
    const create = await manageProfile("POST", key, {
      profile: {
        title_keywords: ["backend"],
        active_looking: false,
        webhook_url: "https://example.com/v1",
      },
    });
    assertEquals(create.status, 201);

    // Update
    const update = await manageProfile("POST", key, {
      profile: {
        title_keywords: ["backend", "devops"],
        active_looking: true,
        webhook_url: "https://example.com/v2",
      },
    });
    assertEquals(update.status, 200);
    const body = await update.json();
    assertEquals(body.profile.title_keywords, ["backend", "devops"]);
    assertEquals(body.profile.active_looking, true);
    assertEquals(body.profile.webhook_url, "https://example.com/v2");
  } finally {
    await cleanupProfile(id);
  }
});

Deno.test("manage-profile: GET retrieves profile + schedule", async () => {
  const { id, key } = await createTestApiKey();
  try {
    // Create
    await manageProfile("POST", key, {
      profile: {
        skills: ["Python"],
        active_looking: true,
        webhook_url: "https://example.com/hook",
      },
      schedule: { interval_minutes: 1440 },
    });

    // Get
    const res = await manageProfile("GET", key);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertExists(body.profile);
    assertExists(body.schedule);
    assertEquals(body.profile.skills, ["Python"]);
    assertEquals(body.schedule.interval_minutes, 1440);
  } finally {
    await cleanupProfile(id);
  }
});

Deno.test("manage-profile: DELETE removes profile", async () => {
  const { id, key } = await createTestApiKey();
  try {
    // Create
    await manageProfile("POST", key, {
      profile: { skills: ["Rust"], webhook_url: "https://example.com/hook" },
      schedule: { interval_minutes: 60 },
    });

    // Delete
    const del = await manageProfile("DELETE", key);
    assertEquals(del.status, 200);
    const delBody = await del.json();
    assertEquals(delBody.deleted, true);

    // Verify gone
    const get = await manageProfile("GET", key);
    const getBody = await get.json();
    assertEquals(getBody.profile, null);
  } finally {
    await cleanupProfile(id);
  }
});

Deno.test("manage-profile: validates profile fields", async () => {
  const { id, key } = await createTestApiKey();
  try {
    const res = await manageProfile("POST", key, {
      profile: {
        webhook_url: "not-a-url",
        employment_type: "invalid-type",
      },
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error, "Validation failed");
  } finally {
    await cleanupProfile(id);
  }
});

Deno.test("manage-profile: validates schedule interval minimum", async () => {
  const { id, key } = await createTestApiKey();
  try {
    const res = await manageProfile("POST", key, {
      profile: { active_looking: true, webhook_url: "https://example.com/h" },
      schedule: { interval_minutes: 1 }, // below minimum of 5
    });
    assertEquals(res.status, 422);
  } finally {
    await cleanupProfile(id);
  }
});
