import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

/**
 * Supabase client for Server Components and Route Handlers.
 *
 * It is built from the *anon* key plus the caller's session cookie, so every
 * query runs as that specific user and row level security applies. Nothing in
 * this app ever talks to Postgres with elevated privileges.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which may not set cookies.
          // proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
