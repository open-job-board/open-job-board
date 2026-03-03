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
  cleanupApiKeys,
  clearRateLimits,
  createApiKey,
  FUNCTIONS_URL,
  functionHeaders,
  REST_URL,
  SERVICE_ROLE_KEY,
} from "./helpers.ts";

const TEST_PREFIX = `test-login-${Date.now()}`;
const TEST_EMAIL = `${TEST_PREFIX}@example.com`;

// Helper to call the login edge function
async function login(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${FUNCTIONS_URL}/login`, {
    method: "POST",
    headers: functionHeaders,
    body: JSON.stringify(body),
  });
}

// Helper to cleanup sessions by api_key_id
async function cleanupSessions(apiKeyId: string): Promise<void> {
  const res = await fetch(
    `${REST_URL}/auth_sessions?api_key_id=eq.${apiKeyId}`,
    {
      method: "DELETE",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  await res.body?.cancel();
}

describe("login", () => {
  let apiKeyPlain: string;
  let apiKeyId: string;

  // Create a test API key and clear rate limits before each test
  beforeEach(async () => {
    await clearRateLimits();
  });

  // One-time setup: create an API key for testing
  const setup = async () => {
    await clearRateLimits();
    const res = await createApiKey({
      name: `${TEST_PREFIX}-user`,
      email: TEST_EMAIL,
    });
    assertEquals(res.status, 201);
    const body = await res.json();
    apiKeyPlain = body.key;

    // Get the api_key_id for cleanup
    const keyRes = await fetch(
      `${REST_URL}/api_keys?owner_email=eq.${encodeURIComponent(TEST_EMAIL)}&select=id`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
      },
    );
    const keys = await keyRes.json();
    apiKeyId = keys[0].id;
  };

  afterAll(async () => {
    if (apiKeyId) {
      await cleanupSessions(apiKeyId);
    }
    await cleanupApiKeys(TEST_PREFIX);
  });

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  it("GET /login returns health status", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/login`, {
      headers: { Authorization: functionHeaders.Authorization },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ok");
    assertEquals(body.endpoint, "login");
  });

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------
  it("creates a session with valid email", async () => {
    await setup();

    const res = await login({ email: TEST_EMAIL });
    assertEquals(res.status, 201);

    const body = await res.json();
    assertExists(body.session_token);
    assertStringIncludes(body.session_token, "ojbs_");
    assertEquals(body.session_token.length, 69); // "ojbs_" (5) + 64 hex chars
    assertExists(body.user);
    assertEquals(body.user.email, TEST_EMAIL);
    assertExists(body.message);
  });

  it("returns 404 for unknown email", async () => {
    const res = await login({ email: "unknown@example.com" });
    assertEquals(res.status, 404);
    const body = await res.json();
    assertStringIncludes(body.error, "No account found");
  });

  it("rejects invalid email format", async () => {
    const res = await login({ email: "not-an-email" });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error, "Validation failed");
  });

  it("rejects empty body", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/login`, {
      method: "POST",
      headers: functionHeaders,
      body: "not json",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error, "Invalid JSON");
  });

  // -------------------------------------------------------------------------
  // Validate
  // -------------------------------------------------------------------------
  it("validates a valid session token", async () => {
    await setup();

    // Login first
    const loginRes = await login({ email: TEST_EMAIL });
    assertEquals(loginRes.status, 201);
    const { session_token } = await loginRes.json();

    // Validate
    const valRes = await login({
      action: "validate",
      session_token,
    });
    assertEquals(valRes.status, 200);

    const body = await valRes.json();
    assertEquals(body.valid, true);
    assertExists(body.user);
    assertEquals(body.user.email, TEST_EMAIL);
    assertExists(body.user.api_key_id);
  });

  it("returns invalid for fake session token", async () => {
    const valRes = await login({
      action: "validate",
      session_token: "ojbs_fake0000000000000000000000000000000000000000000000000000000000",
    });
    assertEquals(valRes.status, 200);

    const body = await valRes.json();
    assertEquals(body.valid, false);
  });

  it("returns error for missing session_token on validate", async () => {
    const valRes = await login({ action: "validate" });
    assertEquals(valRes.status, 400);
    const body = await valRes.json();
    assertStringIncludes(body.error, "Missing session_token");
  });

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------
  it("logs out and invalidates a session", async () => {
    await setup();

    // Login
    const loginRes = await login({ email: TEST_EMAIL });
    assertEquals(loginRes.status, 201);
    const { session_token } = await loginRes.json();

    // Logout
    const logoutRes = await login({
      action: "logout",
      session_token,
    });
    assertEquals(logoutRes.status, 200);
    const logoutBody = await logoutRes.json();
    assertEquals(logoutBody.logged_out, true);

    // Validate should now fail
    const valRes = await login({
      action: "validate",
      session_token,
    });
    assertEquals(valRes.status, 200);
    const valBody = await valRes.json();
    assertEquals(valBody.valid, false);
  });

  // -------------------------------------------------------------------------
  // Session-based profile access
  // -------------------------------------------------------------------------
  it("can access manage-profile with session token", async () => {
    await setup();

    // Login to get session token
    const loginRes = await login({ email: TEST_EMAIL });
    assertEquals(loginRes.status, 201);
    const { session_token } = await loginRes.json();

    // Access profile with session token
    const profileRes = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
      method: "GET",
      headers: {
        ...functionHeaders,
        "X-Session-Token": session_token,
      },
    });
    assertEquals(profileRes.status, 200);
    const body = await profileRes.json();
    // New user, no profile yet
    assertEquals(body.profile, null);
    assertEquals(body.schedule, null);
  });

  it("can access manage-profile with API key", async () => {
    await setup();

    const profileRes = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
      method: "GET",
      headers: {
        ...functionHeaders,
        "X-API-Key": apiKeyPlain,
      },
    });
    assertEquals(profileRes.status, 200);
    const body = await profileRes.json();
    assertEquals(body.profile, null);
  });

  it("rejects manage-profile without auth", async () => {
    const profileRes = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
      method: "GET",
      headers: functionHeaders,
    });
    assertEquals(profileRes.status, 401);
    const body = await profileRes.json();
    assertStringIncludes(body.error, "Authentication required");
  });

  it("rejects manage-profile with invalid session token", async () => {
    const profileRes = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
      method: "GET",
      headers: {
        ...functionHeaders,
        "X-Session-Token": "ojbs_invalid000000000000000000000000000000000000000000000000000000",
      },
    });
    assertEquals(profileRes.status, 401);
  });

  // -------------------------------------------------------------------------
  // Cross-user isolation
  // -------------------------------------------------------------------------
  it("users cannot see each other's profiles", async () => {
    await setup();
    await clearRateLimits();

    // Create a second user
    const email2 = `${TEST_PREFIX}-user2@example.com`;
    const keyRes2 = await createApiKey({
      name: `${TEST_PREFIX}-user2`,
      email: email2,
    });
    assertEquals(keyRes2.status, 201);
    const { key: apiKey2 } = await keyRes2.json();
    await clearRateLimits();

    // User 1 creates a profile
    const createRes = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
      method: "POST",
      headers: {
        ...functionHeaders,
        "X-API-Key": apiKeyPlain,
      },
      body: JSON.stringify({
        profile: {
          title_keywords: ["secret-engineer"],
          skills: ["Go", "Rust"],
          active_looking: true,
        },
      }),
    });
    assertEquals(createRes.status, 201);
    const { profile: user1Profile } = await createRes.json();
    assertExists(user1Profile.id);

    // User 2 tries to read their own profile (should be empty, not user 1's)
    const readRes = await fetch(`${FUNCTIONS_URL}/manage-profile`, {
      method: "GET",
      headers: {
        ...functionHeaders,
        "X-API-Key": apiKey2,
      },
    });
    assertEquals(readRes.status, 200);
    const { profile: user2Profile } = await readRes.json();
    assertEquals(user2Profile, null); // User 2 has no profile

    // Cleanup user 2
    await cleanupApiKeys(`${TEST_PREFIX}-user2`);
  });
});
