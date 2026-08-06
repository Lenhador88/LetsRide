/**
 * The password-recovery grant. Shared by /auth/callback, the reset screen and
 * the updatePassword action, and deliberately importing none of them — a Server
 * Action importing a Route Handler module would drag the handler's exports into
 * the action's graph, and this module is now read from a client component too.
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
 * link produces an *ordinary* session, and `proxy.ts` deliberately does not
 * bounce signed-in riders off `/auth/reset-password` (Q1 — bouncing them broke
 * recovery). Without a marker, anyone holding a live session on a shared device
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
 * Structural rather than the `SupabaseClient` type, so this module imports
 * neither `lib/supabase/server` nor `lib/supabase/client`. Both call sites are
 * on different sides of the `react-server` condition and importing either one
 * here would put it in the other's graph.
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
