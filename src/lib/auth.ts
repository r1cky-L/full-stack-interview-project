import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBearerClient } from '@/lib/supabase/bearer';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/types';

export interface AuthContext {
  /** Scoped to the caller, so every query is subject to RLS. */
  supabase: SupabaseClient;
  profile: Profile;
}

/**
 * Resolves the caller's identity and role, or null if they are not signed in.
 *
 * Accepts either the session cookie (browser) or an `Authorization: Bearer`
 * access token (curl, scripts). Both carry the same privileges.
 *
 * Uses getUser() rather than getSession(): getSession() merely decodes the
 * cookie, which the client controls, whereas getUser() revalidates the token
 * against the Supabase auth server.
 *
 * The role is then read from public.profiles -- a table with no INSERT/UPDATE
 * grants and no INSERT/UPDATE policies -- so the caller cannot forge it.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const bearer = (await headers()).get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];

  const supabase = bearer ? createBearerClient(bearer) : await createClient();

  const {
    data: { user },
    error: authError,
  } = bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser();

  // An expired or forged token is the caller's problem and becomes a 401.
  // Failing to *reach* the auth server is ours: reporting that as 401 would
  // tell a correctly signed-in user that their credentials were rejected.
  // A rejected token carries a 4xx status; a network failure carries 0 or 5xx.
  if (authError) {
    const status = authError.status ?? 0;
    if (status === 0 || status >= 500) {
      throw new Error(`Could not reach the auth server: ${authError.message}`);
    }
    return null;
  }
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .single<Profile>();

  // A failed lookup is a server fault, not a failed sign-in. Returning null
  // here would answer 401 and tell the caller to sign in again over what is
  // really a transient database problem.
  if (error) {
    throw new Error(`Could not load profile for user ${user.id}: ${error.message}`);
  }
  if (!profile) return null;

  return { supabase, profile };
}
