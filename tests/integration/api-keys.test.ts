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
} from "./helpers.ts";

const TEST_PREFIX = `test-apikey-${Date.now()}`;

describe("create-api-key", () => {
  // Clear rate limits before each test to avoid exhaustion (limit is 5/min)
  beforeEach(async () => {
    await clearRateLimits();
  });

  afterAll(async () => {
    await cleanupApiKeys(TEST_PREFIX);
  });

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  it("GET /create-api-key returns health status", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/create-api-key`, {
      headers: { Authorization: functionHeaders.Authorization },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ok");
    assertEquals(body.endpoint, "create-api-key");
  });

  // -------------------------------------------------------------------------
  // Successful creation
  // -------------------------------------------------------------------------
  it("creates a key with valid name and email", async () => {
    const res = await createApiKey({
      name: `${TEST_PREFIX}-valid`,
      email: "test@example.com",
    });
    assertEquals(res.status, 201);

    const body = await res.json();
    assertExists(body.key);
    assertStringIncludes(body.key, "ojb_");
    assertEquals(body.key.length, 68); // "ojb_" (4) + 64 hex chars
    assertEquals(body.name, `${TEST_PREFIX}-valid`);
    assertEquals(body.rate_limit, 100);
    assertExists(body.message);
  });

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------
  it("rejects empty body", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/create-api-key`, {
      method: "POST",
      headers: functionHeaders,
      body: "not json",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertStringIncludes(body.error, "Invalid JSON");
  });

  it("rejects missing name", async () => {
    const res = await createApiKey({ email: "test@example.com" });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error, "Validation failed");
    assertExists(body.details);
  });

  it("rejects missing email", async () => {
    const res = await createApiKey({ name: `${TEST_PREFIX}-no-email` });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error, "Validation failed");
  });

  it("rejects invalid email format", async () => {
    const res = await createApiKey({
      name: `${TEST_PREFIX}-bad-email`,
      email: "not-an-email",
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error, "Validation failed");
  });

  it("rejects empty name", async () => {
    const res = await createApiKey({
      name: "",
      email: "test@example.com",
    });
    assertEquals(res.status, 422);
    await res.body?.cancel();
  });

  // -------------------------------------------------------------------------
  // Each key is unique
  // -------------------------------------------------------------------------
  it("generates unique keys for the same input", async () => {
    const payload = {
      name: `${TEST_PREFIX}-dup`,
      email: "dup@example.com",
    };
    const res1 = await createApiKey(payload);
    assertEquals(res1.status, 201);
    const key1 = (await res1.json()).key;

    const res2 = await createApiKey(payload);
    assertEquals(res2.status, 201);
    const key2 = (await res2.json()).key;

    // Keys must be different even for the same name/email
    if (key1 === key2) {
      throw new Error("Expected unique keys but got identical ones");
    }
  });
});
