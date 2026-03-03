import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Result of authenticating a request.
 * `apiKeyId` is the UUID of the authenticated user's API key record.
 */
export interface AuthResult {
  apiKeyId: string;
}

/**
 * Authenticate a request using either:
 *   1. `X-Session-Token` header (persistent session token)
 *   2. `X-API-Key` header (raw API key)
 *
 * Returns the authenticated user's api_key_id, or null if unauthenticated.
 */
export async function authenticateRequest(
  req: Request,
  supabase: SupabaseClient,
): Promise<AuthResult | null> {
  // Try session token first (preferred for MCP sessions)
  const sessionToken = req.headers.get("x-session-token");
  if (sessionToken) {
    const tokenHash = await sha256hex(sessionToken);

    const { data: apiKeyId, error } = await supabase.rpc("validate_session", {
      p_token_hash: tokenHash,
    });

    if (!error && apiKeyId) {
      return { apiKeyId };
    }
    // Invalid session token — don't fall through to API key
    return null;
  }

  // Try API key
  const apiKeyHeader = req.headers.get("x-api-key");
  if (apiKeyHeader) {
    const keyHash = await sha256hex(apiKeyHeader);

    const { data: keyRecord } = await supabase
      .from("api_keys")
      .select("id, is_active")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyRecord) {
      return { apiKeyId: keyRecord.id };
    }
    return null;
  }

  return null;
}

async function sha256hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
