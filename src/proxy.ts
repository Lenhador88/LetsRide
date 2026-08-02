import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * A denylist of public paths, not an allowlist of protected ones. Decision #1
 * is that everything requires a session, so a new route must be *added* here to
 * become public — the old `protectedPaths` allowlist meant forgetting to list a
 * route silently exposed it.
 *
 * /legal/* is the one deliberate exception to no-anonymous-access (Q6): the
 * terms and privacy pages have to be readable before signup completes, and they
 * are static copy with no data access.
 */
const PUBLIC_PATHS = [
  '/',
  '/auth/login',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/callback',
]

// Signed-in riders are bounced away from these two only. Notably NOT
// /auth/reset-password: a Supabase recovery link establishes a session before
// landing there, so bouncing every /auth/* path sent the user to the dashboard
// with their old password still active and no error (Q1).
const AUTH_ENTRY_PATHS = ['/auth/login', '/auth/signup']

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/legal')
  const isAuthEntry = AUTH_ENTRY_PATHS.includes(pathname)
  const isOnboarding = pathname.startsWith('/onboarding')

  const redirect = (to: string) => NextResponse.redirect(new URL(to, request.url))

  if (!user) {
    return isPublic ? supabaseResponse : redirect('/auth/login')
  }

  // Public paths that are not a way back into signup need no onboarding state,
  // so they skip the profile read entirely. That covers the splash, the legal
  // pages and the whole recovery flow.
  if (isPublic && !isAuthEntry) {
    return supabaseResponse
  }

  // Decision #5: the gate is read from the database on every request. It
  // deliberately does not live in user_metadata, which the client can write via
  // supabase.auth.updateUser() to mark itself onboarded.
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, location, onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.onboarding_completed_at) {
    // Resume position is derived from which fields are still empty; completion
    // itself is stored, so editing your profile later never re-gates you.
    if (isOnboarding) return supabaseResponse
    return redirect(profile?.username ? '/onboarding/location' : '/onboarding/username')
  }

  if (isOnboarding || isAuthEntry) {
    return redirect('/dashboard')
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
