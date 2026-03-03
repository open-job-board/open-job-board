-- =============================================================================
-- USER PROFILES, MATCH SCHEDULES, and SENT MATCHES
-- Enables asynchronous delivery of best job matches to users.
-- =============================================================================

-- =============================================================================
-- USER_PROFILES: stores job search preferences for matching
-- =============================================================================
CREATE TABLE public.user_profiles (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identity (API key based — links to api_keys for auth)
  api_key_id       UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,

  -- Search preferences
  title_keywords   TEXT[],                   -- e.g. {"backend engineer", "go developer"}
  skills           TEXT[],                   -- e.g. {"Go", "PostgreSQL", "Kubernetes"}
  location_country TEXT,                     -- preferred country
  location_city    TEXT,                     -- preferred city
  remote_only      BOOLEAN     DEFAULT FALSE,
  employment_type  TEXT,                     -- "full-time", "part-time", etc.
  salary_min       NUMERIC(12,2),            -- minimum acceptable salary
  salary_currency  TEXT,                     -- expected salary currency
  salary_period    TEXT,                     -- "yearly", "monthly", etc.

  -- Notification
  webhook_url      TEXT,                     -- URL to POST match results to
  active_looking   BOOLEAN     NOT NULL DEFAULT FALSE,

  CONSTRAINT uq_user_profile_api_key UNIQUE (api_key_id)
);

CREATE INDEX idx_user_profiles_active ON public.user_profiles (active_looking) WHERE active_looking = TRUE;

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- MATCH_SCHEDULES: defines when to send matches to each user
-- =============================================================================
CREATE TABLE public.match_schedules (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  user_profile_id  UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  -- Schedule configuration
  -- interval_minutes: how often to send (e.g. 5, 60, 1440 for daily, 10080 for weekly)
  interval_minutes INT         NOT NULL DEFAULT 1440,  -- default: daily

  -- Cron expression for advanced schedules (e.g. "0 18 * * 1" = Monday 6pm)
  -- If set, takes precedence over interval_minutes
  cron_expression  TEXT,

  -- Execution tracking
  next_run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at      TIMESTAMPTZ,

  -- Limits
  max_matches      INT         NOT NULL DEFAULT 10,    -- max jobs per delivery

  -- Status
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,

  CONSTRAINT uq_schedule_per_user UNIQUE (user_profile_id)
);

CREATE INDEX idx_match_schedules_due ON public.match_schedules (next_run_at)
  WHERE is_active = TRUE;

CREATE TRIGGER trg_match_schedules_updated_at
  BEFORE UPDATE ON public.match_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- SENT_MATCHES: tracks which jobs have been sent to which user
-- Prevents re-sending the same job to the same user.
-- =============================================================================
CREATE TABLE public.sent_matches (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  user_profile_id  UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  job_id           UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  score            REAL,                     -- match score at time of delivery

  CONSTRAINT uq_sent_match UNIQUE (user_profile_id, job_id)
);

CREATE INDEX idx_sent_matches_user ON public.sent_matches (user_profile_id);

-- =============================================================================
-- RPC: find_best_matches
-- Returns top matching jobs for a user profile, excluding already-sent ones.
-- Scoring: keyword match in title + skill match in requirements + filter bonuses
-- =============================================================================
CREATE OR REPLACE FUNCTION public.find_best_matches(
  p_user_profile_id UUID,
  p_limit           INT DEFAULT 10
)
RETURNS TABLE (
  job_id           UUID,
  title            TEXT,
  company_name     TEXT,
  location_city    TEXT,
  location_country TEXT,
  remote_full      BOOLEAN,
  employment_type  TEXT,
  salary_currency  TEXT,
  salary_min       NUMERIC,
  salary_max       NUMERIC,
  salary_period    TEXT,
  posted_at        TIMESTAMPTZ,
  score            REAL
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile RECORD;
  v_ts_query TSQUERY;
BEGIN
  -- Fetch the user profile
  SELECT * INTO v_profile
  FROM public.user_profiles up
  WHERE up.id = p_user_profile_id;

  IF v_profile IS NULL THEN
    RETURN;
  END IF;

  -- Build a text search query from title keywords
  IF v_profile.title_keywords IS NOT NULL AND array_length(v_profile.title_keywords, 1) > 0 THEN
    v_ts_query := websearch_to_tsquery('english', array_to_string(v_profile.title_keywords, ' OR '));
  END IF;

  RETURN QUERY
  SELECT
    j.id AS job_id,
    j.title,
    j.company_name,
    j.location_city,
    j.location_country,
    j.remote_full,
    j.employment_type,
    j.salary_currency,
    j.salary_min,
    j.salary_max,
    j.salary_period,
    j.posted_at,
    (
      -- Title keyword relevance (0-1 range, weighted x3)
      CASE WHEN v_ts_query IS NOT NULL AND j.search_vector @@ v_ts_query
        THEN ts_rank(j.search_vector, v_ts_query) * 3.0
        ELSE 0.0
      END
      +
      -- Skill match: count overlapping skills in requirements.hard_skills
      CASE WHEN v_profile.skills IS NOT NULL
           AND j.requirements IS NOT NULL
           AND j.requirements->'hard_skills' IS NOT NULL
        THEN (
          SELECT COUNT(*)::REAL * 0.5
          FROM unnest(v_profile.skills) AS user_skill
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(j.requirements->'hard_skills') AS job_skill
            WHERE LOWER(job_skill) = LOWER(user_skill)
          )
        )
        ELSE 0.0
      END
      +
      -- Location match bonus
      CASE WHEN v_profile.location_country IS NOT NULL
           AND LOWER(j.location_country) = LOWER(v_profile.location_country)
        THEN 1.0
        ELSE 0.0
      END
      +
      CASE WHEN v_profile.location_city IS NOT NULL
           AND LOWER(j.location_city) = LOWER(v_profile.location_city)
        THEN 0.5
        ELSE 0.0
      END
      +
      -- Remote preference bonus
      CASE WHEN v_profile.remote_only = TRUE AND j.remote_full = TRUE
        THEN 1.0
        WHEN v_profile.remote_only = TRUE AND j.remote_full IS NOT TRUE
        THEN -5.0  -- penalize non-remote if user wants remote only
        ELSE 0.0
      END
      +
      -- Employment type match
      CASE WHEN v_profile.employment_type IS NOT NULL
           AND LOWER(j.employment_type) = LOWER(v_profile.employment_type)
        THEN 0.5
        ELSE 0.0
      END
      +
      -- Salary match: bonus if job meets minimum
      CASE WHEN v_profile.salary_min IS NOT NULL
           AND j.salary_min IS NOT NULL
           AND j.salary_min >= v_profile.salary_min
        THEN 0.5
        WHEN v_profile.salary_min IS NOT NULL
             AND j.salary_max IS NOT NULL
             AND j.salary_max < v_profile.salary_min
        THEN -2.0  -- penalize below minimum
        ELSE 0.0
      END
      +
      -- Recency bonus: newer jobs score slightly higher
      CASE WHEN j.posted_at IS NOT NULL
        THEN GREATEST(0.0, 1.0 - EXTRACT(EPOCH FROM (NOW() - j.posted_at)) / (30.0 * 86400.0))::REAL
        ELSE 0.0
      END
    )::REAL AS score
  FROM public.jobs j
  WHERE
    j.is_active = TRUE
    -- Exclude already-sent matches
    AND NOT EXISTS (
      SELECT 1 FROM public.sent_matches sm
      WHERE sm.user_profile_id = p_user_profile_id
        AND sm.job_id = j.id
    )
    -- At least some relevance: must match keyword OR skill OR location
    AND (
      (v_ts_query IS NOT NULL AND j.search_vector @@ v_ts_query)
      OR (
        v_profile.skills IS NOT NULL
        AND j.requirements IS NOT NULL
        AND j.requirements->'hard_skills' IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM unnest(v_profile.skills) AS user_skill
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(j.requirements->'hard_skills') AS job_skill
            WHERE LOWER(job_skill) = LOWER(user_skill)
          )
        )
      )
      OR (
        v_profile.location_country IS NOT NULL
        AND LOWER(j.location_country) = LOWER(v_profile.location_country)
      )
      OR (
        v_profile.remote_only = TRUE AND j.remote_full = TRUE
      )
    )
  ORDER BY score DESC, j.posted_at DESC NULLS LAST
  LIMIT LEAST(p_limit, 50);
END;
$$;

-- =============================================================================
-- RPC: get_due_schedules
-- Returns schedules that are due to run (next_run_at <= NOW()).
-- Used by the send-matches Edge Function.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_due_schedules()
RETURNS TABLE (
  schedule_id      UUID,
  user_profile_id  UUID,
  max_matches      INT,
  interval_minutes INT,
  cron_expression  TEXT,
  webhook_url      TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  SELECT
    ms.id AS schedule_id,
    ms.user_profile_id,
    ms.max_matches,
    ms.interval_minutes,
    ms.cron_expression,
    up.webhook_url
  FROM public.match_schedules ms
  JOIN public.user_profiles up ON up.id = ms.user_profile_id
  WHERE
    ms.is_active = TRUE
    AND up.active_looking = TRUE
    AND up.webhook_url IS NOT NULL
    AND ms.next_run_at <= NOW();
END;
$$;

-- =============================================================================
-- RPC: advance_schedule
-- Updates a schedule's last_run_at and computes next_run_at.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.advance_schedule(p_schedule_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.match_schedules
  SET
    last_run_at = NOW(),
    next_run_at = NOW() + (interval_minutes * INTERVAL '1 minute')
  WHERE id = p_schedule_id;
END;
$$;

-- =============================================================================
-- RPC: record_sent_matches
-- Bulk-insert sent match records. Skips duplicates.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_sent_matches(
  p_user_profile_id UUID,
  p_matches         JSONB  -- array of {job_id, score}
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.sent_matches (user_profile_id, job_id, score)
  SELECT
    p_user_profile_id,
    (elem->>'job_id')::UUID,
    (elem->>'score')::REAL
  FROM jsonb_array_elements(p_matches) AS elem
  ON CONFLICT (user_profile_id, job_id) DO NOTHING;
END;
$$;

-- =============================================================================
-- ROW LEVEL SECURITY for new tables
-- =============================================================================
ALTER TABLE public.user_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sent_matches    ENABLE ROW LEVEL SECURITY;

-- All new tables are service-role only (managed via Edge Functions)
CREATE POLICY "user_profiles_deny_all"
  ON public.user_profiles FOR ALL USING (FALSE);

CREATE POLICY "match_schedules_deny_all"
  ON public.match_schedules FOR ALL USING (FALSE);

CREATE POLICY "sent_matches_deny_all"
  ON public.sent_matches FOR ALL USING (FALSE);

-- =============================================================================
-- GRANTS for RPC functions
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.find_best_matches(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_schedules() TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_schedule(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_sent_matches(UUID, JSONB) TO authenticated;
