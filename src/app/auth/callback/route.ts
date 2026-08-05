import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { RECOVERY_PATH } from '@/lib/auth/recovery'

/**
 * Exchanges a Supabase auth code for a session cookie. Password recovery is
 * what needs it today — the emailed link lands here, and without the exchange
 * the reset page has no session and cannot set a new password.
 *
 * A Route Handler rather than a page because the exchange writes cookies, which
 * a Server Component cannot do.
 *
 * **It no longer sets a recovery marker, and it must not start again.** It used
 * to set an httpOnly `lr-recovery` cookie here, which `updatePassword` required
 * and then deleted. Migration `026` moved that to the `amr` claim GoTrue
 * already puts in the access token — see `lib/auth/recovery.ts`. A second
 * marker set here would be one the client-rendered shell cannot produce, so the
 * two paths would disagree about who may reset.
 *
 * **This exchange is the part that cannot move to an Edge Function.** The flow
 * is PKCE — `@supabase/ssr` hardcodes it — so the code verifier lives in the
 * storage of whichever client called `resetPasswordForEmail`, which today is
 * this app's server client and its cookie jar. When the shell lands, this whole
 * handler is replaced by a client route doing the same exchange in the browser,
 * where the verifier will then be. Nothing about the grant changes with it.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Recovery links are single-use and time-limited, so an expired or reused
    // link is the ordinary case here, not an exceptional one.
    return NextResponse.redirect(`${origin}/auth/forgot-password?error=invalid_link`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}

/**
 * `next` arrives from a URL the user clicked, so an unvalidated value makes
 * this an open redirect — `?next=https://evil.example` would bounce a rider
 * with a live session straight off the site.
 *
 * Only a path is accepted: it must start with a single `/`. `//evil.example`
 * is protocol-relative and would leave the origin, so the second character is
 * checked too.
 *
 * Backslashes and control characters are rejected as well. They are not
 * exploitable through this route as written — it builds `${origin}${next}`,
 * where the host is already fixed by literal text before any parsing happens.
 * But URL parsers fold `\` to `/` and strip tabs and newlines, so
 * `/\evil.example` resolves to the host `evil.example` the moment a value is
 * resolved *against* a base instead of concatenated onto one. Rejecting them
 * here means the guard holds on its own rather than depending on how every
 * future caller assembles the redirect.
 */
export function safeNext(value: string | null): string {
  const isPath =
    !!value &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !/[\x00-\x1F\x7F]/.test(value)

  return isPath ? value : RECOVERY_PATH
}
