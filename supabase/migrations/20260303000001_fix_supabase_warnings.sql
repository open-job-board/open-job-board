-- =============================================================================
-- Fix Supabase linter warnings:
-- 1. Move pg_trgm extension out of public schema (extension_in_public)
-- 2. Set search_path on all functions (function_search_path_mutable)
-- =============================================================================

-- Move pg_trgm to extensions schema to resolve extension_in_public warning
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- Set immutable search_path on all functions to prevent search_path injection
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.update_search_vector() SET search_path = '';
ALTER FUNCTION public.check_rate_limit(TEXT, INT, INT) SET search_path = '';
ALTER FUNCTION public.cleanup_rate_limits() SET search_path = '';
ALTER FUNCTION public.search_jobs(TEXT, TEXT, TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, TEXT, INT, INT) SET search_path = '';
ALTER FUNCTION public.get_job_detail(UUID) SET search_path = '';
