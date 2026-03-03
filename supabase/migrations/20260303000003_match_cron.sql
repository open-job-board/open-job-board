-- =============================================================================
-- CRON: Schedule send-matches to run every 5 minutes
-- Uses pg_cron + pg_net to invoke the Edge Function.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule the send-matches Edge Function to run every 5 minutes.
-- pg_net makes an HTTP POST to the Edge Function with the service role key.
-- The function itself checks which user schedules are actually due.
SELECT extensions.cron_schedule(
  'send-matches-cron',          -- job name
  '*/5 * * * *',                -- every 5 minutes
  $$
  SELECT extensions.http_post(
    url    := current_setting('app.settings.supabase_url') || '/functions/v1/send-matches',
    body   := '{}'::JSONB,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
