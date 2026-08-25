/**
 * The one published address a rider can reach a human at.
 *
 * It is a constant rather than a literal in each page because App Store Review
 * Guideline 1.2 and Google Play's User Data policy both want a *working* route
 * to a person, and two pages publishing two different addresses is how one of
 * them goes stale silently. One name, one place to change it.
 *
 * **OWNER: this address is a guess and always was.** It arrived with
 * `/legal/account-deletion` carrying an explicit "`hello@` is a guess" note,
 * and its domain is `letsride.app` — which is **not** this project's domain.
 * `CLAUDE.md` §Branching & CI records the domain as `letsride.social`, so
 * unless `letsride.app` is also owned and monitored, every rider who writes to
 * this address reaches nobody, and a store reviewer checking the contact route
 * on a user-generated-content app is exactly who writes to it first.
 *
 * Replace this one line with a mailbox that is actually read; nothing else has
 * to change. `src/__tests__/support-email.test.ts` asserts the pages render
 * whatever it says rather than a second copy of the address.
 */
export const SUPPORT_EMAIL = 'hello@letsride.app'
