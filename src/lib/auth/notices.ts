/**
 * The `?error=` codes an auth screen can be redirected in with, and the one
 * place their wording lives.
 *
 * **Four call sites emitted one of these and nothing rendered any of them**
 * (PD-225): `/auth/callback` on a failed exchange and on a link with no code,
 * and `resolveDestination` twice for an unreadable profile. A rider bounced out
 * of a flow arrived at a bare form with no statement of what had happened —
 * which is what makes the routing half of PD-225 invisible on its own, since
 * routing a failure to a better screen buys nothing if that screen says nothing.
 *
 * Every message names the next action, because the rider arriving here did not
 * choose to be here and the screen they land on is not the one they clicked.
 */
export const AUTH_NOTICES = {
  /** A signup confirmation link that GoTrue refused, or whose exchange failed. */
  invalid_confirmation:
    'That confirmation link is invalid or has already been used. Sign in below, or sign up again to get a new one.',
  /** The same, for a password-recovery link. */
  invalid_link: 'That reset link is invalid or has already been used. Request a new one below.',
  /** `my_onboarding_state()` could not be read — the route guard's fail-closed case. */
  profile_unavailable: 'We could not load your profile. Please sign in again.',
} as const

export type AuthNoticeCode = keyof typeof AUTH_NOTICES

/**
 * The code arrives in a URL the rider can edit, so this maps rather than
 * echoes: an unrecognised value renders nothing at all.
 *
 * `hasOwnProperty` rather than a bare lookup, because `Object.prototype`'s own
 * keys would otherwise resolve — `?error=toString` would put a function's
 * source on the screen.
 */
export function authNotice(code: string | null | undefined): string | null {
  if (!code) return null
  return Object.prototype.hasOwnProperty.call(AUTH_NOTICES, code)
    ? AUTH_NOTICES[code as AuthNoticeCode]
    : null
}
