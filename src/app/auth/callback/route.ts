import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { RECOVERY_COOKIE, RECOVERY_PATH } from '@/lib/auth/recovery'

/**
 * Exchanges a Supabase auth code for a session cookie. Password recovery is
 * what needs it today — the emailed link lands here, and without the exchange
 * the reset page has no session and cannot set a new password.
 *
 * A Route Handler rather than a page because the exchange writes cookies, which
 * a Server Component cannot do.
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

  const response = NextResponse.redirect(`${origin}${next}`)

  // A recovery link produces an ordinary session, indistinguishable from one
  // created by signing in. proxy.ts no longer bounces signed-in riders away
  // from /auth/reset-password (Q1), so without a marker anyone holding a
  // session cookie — a shared device, a borrowed laptop — could set a new
  // password without knowing the old one. updatePassword requires this cookie
  // and clears it, so the ability to reset is spent by the reset.
  if (next === RECOVERY_PATH) {
    response.cookies.set(RECOVERY_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 15,
    })
  }

  return response
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
