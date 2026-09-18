/**
 * The one published address a rider can reach a human at.
 *
 * It is a constant rather than a literal in each page because App Store Review
 * Guideline 1.2 and Google Play's User Data policy both want a *working* route
 * to a person, and two pages publishing two different addresses is how one of
 * them goes stale silently. One name, one place to change it.
 *
 * **It was a guess until 2026-09-18 and is now the product owner's own
 * forwarding address.** The old value was `hello@letsride.app` — a domain this
 * project does not hold. Measured before the change, and worth keeping because
 * the two domains look interchangeable and are not:
 *
 *     letsride.social   MX → mx3–mx8.name.com          (name.com forwarding, ours)
 *     letsride.app      MX → mx1/mx2.forwardemail.net  (not in our Vercel account)
 *
 * Both resolve and both accept mail, which is why the wrong one went unnoticed:
 * the failure was never a bounce, it was a stranger's inbox. A store reviewer
 * checking the contact route on a user-generated-content app is exactly who
 * writes to it first.
 *
 * **Confirm the alias rather than the domain if this is ever wrong again.**
 * name.com forwarding is configured per address, and DNS cannot show which
 * aliases exist — `hello@` was the product owner's answer, not a measurement.
 *
 * Replace this one line with a mailbox that is actually read; nothing else has
 * to change. `src/__tests__/support-email.test.ts` asserts the pages render
 * whatever it says rather than a second copy of the address.
 */
export const SUPPORT_EMAIL = 'hello@letsride.social'
