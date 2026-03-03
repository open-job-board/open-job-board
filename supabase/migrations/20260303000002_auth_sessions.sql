-- =============================================================================
-- AUTH SESSIONS
-- Persistent session tokens for remembering users across MCP sessions.
-- Tokens are stored as SHA-256 hashes (same pattern as API keys).
-- =============================================================================

CREATE TABLE public.auth_sessions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
  token_hash  TEXT        NOT NULL UNIQUE,   -- SHA-256 hex digest of the session token
  api_key_id  UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_auth_sessions_token ON public.auth_sessions (token_hash) WHERE is_active = TRUE;
CREATE INDEX idx_auth_sessions_api_key ON public.auth_sessions (api_key_id) WHERE is_active = TRUE;
CREATE INDEX idx_auth_sessions_expires ON public.auth_sessions (expires_at) WHERE is_active = TRUE;

COMMENT ON TABLE public.auth_sessions IS
  'Persistent session tokens for user authentication across MCP sessions. Tokens are SHA-256 hashed.';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_sessions_deny_all"
  ON public.auth_sessions FOR ALL USING (FALSE);

-- =============================================================================
-- RPC: validate_session
-- Looks up a session by token hash, returns the api_key_id if valid.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_session(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_api_key_id UUID;
BEGIN
  SELECT s.api_key_id INTO v_api_key_id
  FROM public.auth_sessions s
  WHERE s.token_hash = p_token_hash
    AND s.is_active = TRUE
    AND s.expires_at > NOW();

  RETURN v_api_key_id;
END;
$$;

-- =============================================================================
-- RPC: cleanup_expired_sessions
-- Deactivate expired sessions. Can be called from pg_cron.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.auth_sessions
  SET is_active = FALSE
  WHERE is_active = TRUE AND expires_at <= NOW();
$$;

-- =============================================================================
-- GRANTS
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.validate_session(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO authenticated;
