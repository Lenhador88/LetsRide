/**
 * Feature flags gated on a build-time `NEXT_PUBLIC_*` env var — inlined per
 * project (Vercel target) at build time, the same mechanism
 * `NEXT_PUBLIC_SUPABASE_URL` uses, so a flag here is per-DEPLOYMENT rather
 * than per-request and cannot be toggled without a rebuild.
 *
 * ## `accountDeletionEnabled` — PD-102, reviewer finding #1 (2026-08-16)
 *
 * The deployed `delete-account` Edge Function on both projects still accepts
 * a bearer token with no password proof — the re-authentication arm (D6) is
 * in the repo, not yet redeployed; see
 * `supabase/functions/delete-account/index.ts`'s own header. Shipping the
 * "Delete account" row unconditionally would put a live UI affordance in
 * front of a function that enforces nothing: three taps and one character
 * irreversibly destroys the account, the `auth.users` row and every Storage
 * object. Before this flag existed, reaching that required a hand-crafted
 * API call; without it, merging the flow turns it into a UI affordance —
 * the exact regression D6 exists to stop.
 *
 * **Defaults OFF.** Only the exact string `'true'` enables it — unset,
 * misspelled, `'1'`, `'True'`, anything else reads as off, so a bad or
 * missing value fails closed rather than open.
 *
 * **The owner sets it per project, and only after confirming that project's
 * OWN redeploy enforces the proof by content** — a request with no password
 * refused `reauth_required` — never by a changed `ezbr_sha256` alone, which
 * three unrelated tasks (2.2, 2.3a, `add-ride-map-tiles` 8.3) now share.
 * DEV and PROD are separate Vercel targets with separate env scopes, so DEV
 * can be turned on before PROD once DEV's function is redeployed and
 * verified, without touching PROD at all.
 */
export function accountDeletionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED === 'true'
}
