import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

const PUBLIC_PAGES = ['/login'];

/**
 * Refreshes the Supabase session on every request and keeps signed-out users
 * off the app pages.
 *
 * This is a convenience layer, not the security boundary: /api routes below
 * are skipped on purpose so that an unauthenticated API call gets a clean 401
 * instead of an HTML redirect, and every route handler re-checks the caller
 * regardless. The real enforcement lives in the route handlers and in RLS.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // API routes answer for themselves with proper status codes.
  if (pathname.startsWith('/api/')) return response;

  if (!user && !PUBLIC_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && PUBLIC_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/tickets';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
