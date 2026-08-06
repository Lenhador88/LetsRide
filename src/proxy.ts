import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { OnboardingState } from '@/types'

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
  //
  // Through the RPC rather than a table select because 021 revokes column SELECT
  // on both stamps — a select naming them answers 403, which the branch below
  // would read as a deploy mismatch and bounce every signed-in rider out of
  // every screen. The function returns the three things this guard needs in one
  // round trip; it runs on every authenticated request, so a second one to fetch
  // `username` separately would be a real cost rather than a tidiness question.
  //
  // The old select also named `location`, which nothing here ever read.
  const { data: state, error } = await supabase
    .rpc('my_onboarding_state')
    .maybeSingle<OnboardingState>()

  // A read that did not answer and a genuinely un-onboarded rider are different
  // states, and treating them the same is how a deploy mismatch turns into a
  // redirect loop: a missing function answers PGRST202 and every authenticated
  // route would otherwise bounce into a wizard that cannot help. Fail closed and
  // visibly rather than into it.
  //
  // `!state` belongs in this branch and not the next one. The accessor returns
  // ZERO ROWS for a caller with no `profiles` row, and PostgREST reports that as
  // `data: null, error: null` — so read as "not onboarded" it would send the
  // rider to the consent prompt, where `accept_terms()` has no row to update,
  // returns NULL, and fails every submit. A trap with no exit. Unreachable today
  // because `handle_new_user` guarantees the row, but `023` and the
  // account-deletion proposal both name deleting a `profiles` row without its
  // `auth.users` row as the thing that makes it reachable.
  if (error || !state) {
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

  // Consent comes before the wizard, because 023 refuses to stamp completion
  // while the consent stamp is NULL. A rider who signed up through the current
  // flow never sees this screen — signUp records consent the instant the account
  // exists — so in practice it is reached only by the accounts that predate that
  // write. Q11 chose a prompt over a backfill: a fabricated consent record is
  // worse than a missing one.
  if (!state.terms_accepted_at) {
    if (pathname === '/onboarding/terms') return supabaseResponse
    return redirect('/onboarding/terms')
  }

  if (!state.onboarding_completed_at) {
    // Resume position is derived from which fields are still empty; completion
    // itself is stored, so editing your profile later never re-gates you.
    if (isOnboarding) {
      // Step 2 cannot be reached before step 1 is done. The database refuses
      // completion unless both fields are set, so without this a rider who
      // deep-links to /onboarding/location submits, gets a check violation
      // rendered as "Finish the earlier steps first", and has no way forward
      // from a screen that can never succeed. Going backwards stays allowed —
      // step 2 has a Back link, and editing a username you already chose is
      // fine. /onboarding/terms is past for this rider, and falls through to
      // the redirect below rather than rendering a screen that would no-op.
      if (pathname === '/onboarding/location' && !state.has_username) {
        return redirect('/onboarding/username')
      }
      if (pathname === '/onboarding/terms') {
        return redirect(state.has_username ? '/onboarding/location' : '/onboarding/username')
      }
      return supabaseResponse
    }
    return redirect(state.has_username ? '/onboarding/location' : '/onboarding/username')
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
