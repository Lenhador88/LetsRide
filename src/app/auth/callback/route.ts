import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/auth/reset-password'
  }
  return value
}
