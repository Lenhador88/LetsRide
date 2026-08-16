/**
 * The password-recovery grant. Shared by the reset screen and the
 * updatePassword action, and deliberately importing neither.
 *
 * (It was also shared with /auth/callback, a Route Handler that no longer
 * exists. The original reason for importing nothing — a Server Action importing
 * a Route Handler module would drag the handler's exports into the action's
 * graph — expired with the server render. The independence is kept because it
 * is still the right shape, not because that constraint still binds.)
 *
 * ## What replaced the cookie, and why it had to
 *
 * Until migration `026` this file held `RECOVERY_COOKIE`: an httpOnly cookie set
 * by /auth/callback for fifteen minutes and deleted by `updatePassword`. The
 * client-rendered shell has no Route Handler to set it and no httpOnly store to
 * put it in, so the cookie could not survive.
 *
 * The two properties it carried had to:
 *
 *   1. Only a session established by a recovery link may change the password
 *      without knowing the old one.
 *   2. The ability to reset is spent by the reset. One link, one reset.
 *
 * The threat is not that someone holds a recovery link. It is that a recovery
 * link produces an *ordinary* session, and the route guard deliberately does not
 * bounce signed-in riders off `/auth/reset-password` (Q1 — bouncing them broke
 * recovery; `guard.ts` bounces only `/auth/login` and `/auth/signup`). Without a marker, anyone holding a live session on a shared device
 * can set a new password without knowing the old one.
 *
 * The marker is now Supabase's own: GoTrue records how a session was
 * established in the `amr` claim of an ES256-signed access token, and a session
 * minted from a recovery link carries `{ method: 'recovery' }`. The client
 * cannot forge it and cannot extend it. `026` reads it in Postgres, where
 * PostgREST has already verified the signature, and keeps the single-use record
 * that `amr` cannot carry. See that migration's header for the measurements.
 *
 * **Note what this is not.** Neither the cookie nor this gates GoTrue itself —
 * `PUT /auth/v1/user` accepts a password change from any live session, measured
 * against the live project. Closing that is a project setting
 * (`Security.UpdatePasswordRequireCurrentPassword`, which exempts recovery
 * sessions), not something a migration or this file can do.
 */

export const RECOVERY_PATH = '/auth/reset-password'

/**
 * One message for every way of not holding a grant — expired, already spent,
 * ordinary session, no session. Distinguishing them tells a rider on a borrowed
 * laptop which door they failed at.
 */
export const RECOVERY_EXPIRED_MESSAGE = 'That reset link has expired. Request a new one.'

/**
 * Structural rather than the `SupabaseClient` type, so this module imports no
 * Supabase client at all and stays testable with a two-line fake.
 *
 * **The original reason has expired — do not reason from it.** It was that the
 * two call sites sat on different sides of the `react-server` export condition,
 * so importing either client here would pull it into the other's graph. That
 * condition is gone with the server render (`lib/supabase/server.ts` and
 * `resolve.rsc.ts` are deleted). The structural type is kept on its own merits;
 * if you are here to delete it, delete it for a current reason.
 */
type RpcClient = {
  rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * Does this session still hold an unspent recovery grant? Read-only — asking
 * does not spend it, which is what lets the reset screen choose between the
 * form and the expired notice without burning the rider's one reset.
 */
export async function hasPasswordResetGrant(supabase: RpcClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_password_reset_grant')
  return !error && data === true
}

/**
 * Spends it. True exactly once per recovery link; false for an ordinary
 * session, an expired grant and every later attempt.
 *
 * Call this BEFORE `updateUser`, never after. Consuming first means a rejected
 * new password costs a fresh link, which is the price of property 2 holding
 * under a concurrent second submit — and the alternative, consuming only on
 * success, is a window in which two requests both pass the check.
 */
export async function consumePasswordResetGrant(supabase: RpcClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('consume_password_reset_grant')
  return !error && data === true
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
 * Backslashes and control characters are rejected as well. **They matter more
 * now than they did**, and that is why this guard lives here rather than with
 * the route handler it came from. That handler built `${origin}${next}` — a
 * concatenation whose host was already fixed by literal text — so `\` was
 * defence in depth. Its replacement calls `router.replace(next)`, which resolves
 * the value *against* the current URL, and URL parsers fold `\` to `/` and strip
 * tabs and newlines: `/\evil.example` resolves to the host `evil.example` under
 * exactly that treatment. The guard was written to hold on its own rather than
 * depend on how a caller assembles the redirect, and this is the change that
 * cashed that in.
 *
 * **`null` means "no usable destination", and it used to mean
 * `/auth/reset-password` — PD-225.** That fallback was written when only
 * recovery links reached the callback, and it survived the day signup
 * confirmation started landing there too: a confirmation whose `next` went
 * missing was routed to *set a new password*, where the rider was then told
 * their reset link had expired, because a freshly confirmed account holds no
 * `026` grant. This function knows whether a value is safe to navigate to; it
 * has never known what the link was for. The caller decides now.
 */
export function safeNext(value: string | null): string | null {
  const isPath =
    !!value &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !/[\x00-\x1F\x7F]/.test(value)

  return isPath ? value : null
}

/**
 * Where a rider goes when an auth link does not work — refused by GoTrue,
 * carrying no code, or failing the exchange.
 *
 * **`next` is the discriminator, and it is the only one there is.** GoTrue's
 * refusal redirect carries `error`, `error_code` and `error_description` and
 * **no `type`**, while preserving the query the link was minted with — measured
 * against the PROD auth server 2026-08-13, in PD-225. So `signUp`'s
 * `next=/postcards` and `requestPasswordReset`'s `next=/auth/reset-password`
 * are what survive to say which flow this was.
 *
 * Sending both to `/auth/forgot-password` is the defect PD-225 reported: a
 * rider whose brand-new account failed to confirm was put into password
 * recovery, a flow they had not asked for and whose screen cannot explain
 * itself. A confirmation failure belongs on login, where signing in and signing
 * up again are both one tap away.
 */
export function callbackFailureDestination(next: string | null): string {
  return next === RECOVERY_PATH
    ? '/auth/forgot-password?error=invalid_link'
    : '/auth/login?error=invalid_confirmation'
}
