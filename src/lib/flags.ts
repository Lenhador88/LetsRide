/**
 * Feature flags gated on a build-time `NEXT_PUBLIC_*` env var — inlined per
 * project (Vercel target) at build time, the same mechanism
 * `NEXT_PUBLIC_SUPABASE_URL` uses, so a flag here is per-DEPLOYMENT rather
 * than per-request and cannot be toggled without a rebuild.
 *
 * ## `accountDeletionEnabled` — PD-102, reviewer finding #1 (2026-08-16)
 *
 * When this flag was written the deployed `delete-account` Edge Function
 * accepted a bearer token with no password proof — the re-authentication arm
 * (D6) was in the repo and not yet redeployed. Shipping the "Delete account"
 * row unconditionally would have put a live UI affordance in front of a
 * function that enforced nothing: three taps and one character irreversibly
 * destroys the account, the `auth.users` row and every Storage object.
 *
 * **That precondition is now satisfied on both projects.** The owner
 * redeployed 2026-08-17 (PROD v9 / DEV v5), and the redeploy was verified by
 * CONTENT on 2026-08-19 rather than by a moved `ezbr_sha256` — a request with
 * no password and a request with a real non-empty wrong password both answer
 * `reauth_required`, and the two projects' digests are equal so the DEV run
 * describes PROD's build too. `openspec/changes/add-account-deletion/tasks.md`
 * task 2.6 carries all seven cases.
 *
 * **The flag is still the gate, and it is still off until the owner sets it.**
 * Nothing in this repo can set a Vercel environment variable, and the variable
 * is inlined at BUILD time, so turning it on is two owner actions rather than
 * one: set it on the target's env scope, then redeploy that target. Verifying
 * the function is what removed the reason to keep it off; it does not turn it
 * on.
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
 * can be turned on before PROD, without touching PROD at all.
 *
 * **One thing the 2026-08-19 probes did NOT cover, and it is the browser
 * half.** Every case ran through `curl`, which needs no preflight; the
 * function's own CORS note says to test both. The preflight itself answers
 * `204` with the right allow-headers, which is necessary and not sufficient.
 * Nothing exercises the actual sheet end to end until this flag is on
 * somewhere — task 6.3 — so DEV is the place to find that out.
 */
export function accountDeletionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED === 'true'
}
