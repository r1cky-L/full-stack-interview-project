import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

/**
 * Supabase client bound to a caller-supplied access token, for API requests
 * that arrive with `Authorization: Bearer <token>` instead of a session cookie.
 *
 * This grants nothing extra: it is still the anon key, so RLS applies exactly
 * as it does for browser traffic. It only makes the API testable with curl.
 */
export function createBearerClient(accessToken: string) {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
