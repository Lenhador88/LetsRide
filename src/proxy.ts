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
  // `/legal/` with the trailing slash, not `startsWith('/legal')` — the loose
  // prefix also matches `/legalfoo`. Harmless while nothing routes there, but a
  // public rider profile at `/[username]` is a plausible next route, and
  // `legalbeagle` is a legal username under 003's rules.
  const isPublic =
    PUBLIC_PATHS.includes(pathname) || pathname === '/legal' || pathname.startsWith('/legal/')
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
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('username, location, onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle()

  // A failed read and a genuinely un-onboarded rider are different states, and
  // treating them the same is how a deploy mismatch turns into a redirect loop:
  // if 003 has not been applied, this select fails with 42703 and every
  // authenticated route would bounce to an onboarding step that cannot exist yet.
  // Fail closed and visibly rather than into the wizard.
  if (error) {
    // The auth entry paths must fall through rather than redirect. They are
    // public but still reach this read (a signed-in rider is normally bounced
    // off them), so sending /auth/login to /auth/login is an infinite loop —
    // and it would fire on exactly the deploy mismatch this branch exists to
    // survive, locking every signed-in rider out with no way to sign out.
    if (isAuthEntry) return supabaseResponse

    const url = new URL('/auth/login', request.url)
    url.searchParams.set('error', 'profile_unavailable')
    return NextResponse.redirect(url)
  }

  if (!profile?.onboarding_completed_at) {
    // Resume position is derived from which fields are still empty; completion
    // itself is stored, so editing your profile later never re-gates you.
    if (isOnboarding) {
      // Step 2 cannot be reached before step 1 is done. The database refuses
      // completion unless both fields are set, so without this a rider who
      // deep-links to /onboarding/location submits, gets a check violation
      // rendered as "Could not save that", and has no way forward from a
      // screen that can never succeed. Going backwards stays allowed — step 2
      // has a Back link, and editing a username you already chose is fine.
      if (pathname === '/onboarding/location' && !profile?.username) {
        return redirect('/onboarding/username')
      }
      return supabaseResponse
    }
    return redirect(profile?.username ? '/onboarding/location' : '/onboarding/username')
  }

  if (isOnboarding || isAuthEntry) {
    // Postcards is the home screen; /dashboard was deleted with the feed that
    // replaced it. The order was load-bearing — moving this redirect before
    // /postcards existed would have landed every completed login on a 404.
    return redirect('/postcards')
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
