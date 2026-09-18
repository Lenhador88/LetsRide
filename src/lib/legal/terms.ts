/**
 * The identity and the version behind `/legal/terms`.
 *
 * Three values in one place for three different reasons, and none of them is
 * tidiness:
 *
 * - **`TERMS_VERSION` has a counterpart in the database.**
 *   `private.current_terms_version()` (`030`) stamps `profiles.terms_version`
 *   at the instant a rider accepts, and the column is server-owned precisely so
 *   the value is evidence rather than a client claim. A page announcing one
 *   version while the database records another makes every consent row
 *   unreadable, so `__tests__/terms.test.ts` pins this constant to the SQL.
 * - **`OPERATOR` is a legal disclosure**, not branding. Dutch law
 *   (art. 3:15d BW, the e-Commerce Directive's art. 5) requires an information
 *   society service to publish who is behind it and where they can be reached.
 *   A trading name is not enough.
 * - **`TERMS_LAST_UPDATED` is what a rider reads** to know whether the text
 *   changed since they agreed. It moves with `TERMS_VERSION`, never on its own.
 */

/**
 * Who the rider is contracting with, or `null` while nobody can be named.
 *
 * Product owner, 2026-09-18: **Pedro personally, not a company.** The two
 * fields themselves are still owed — PD-459 carries both. A session cannot
 * invent either: a legal name is a fact about a person, and an address is a
 * decision, because a sole trader publishing a home address is a choice with
 * consequences and a service address is the usual answer.
 *
 * **`null` rather than a bracketed placeholder string, and that is the whole
 * point of the type.** A placeholder is a value, so it renders: the first cut
 * of this file held `'[full legal name — PD-459]'` and the page published that
 * to every rider, inside the one clause that exists to say who the counterparty
 * is. There is no string here that can reach a screen, so the page has to
 * branch, and `page.tsx` §1 tells the rider plainly that the name and address
 * are still to come and how to ask for them meanwhile.
 *
 * **This is also why `TERMS_VERSION` is still a pre-release value below.** The
 * two move together: the day the operator is identified is the day the text
 * becomes something a rider can be held to, and not before. Filling this in
 * without bumping the version, or bumping the version with this still `null`,
 * is the drift `__tests__/terms.test.ts` refuses.
 */
export const OPERATOR: { readonly name: string; readonly address: string } | null = null

/**
 * Stamped onto `profiles.terms_version` by `private.current_terms_version()`.
 *
 * `0-placeholder` is `030`'s original value and it stays until `OPERATOR` is
 * real — see that constant for why. The follow-up is one migration redefining
 * the function and one edit here, and the test below refuses to let one happen
 * without the other. **That same migration owes a `comment on function`**:
 * `030`'s live comment explains the placeholder by saying `/legal/terms`
 * "disclaims being an agreement", which stopped being true when this page
 * landed.
 *
 * **Consents already stamped keep the version they were given.** `030` is
 * explicit that there is no backfill, for the reason that a version invented
 * for an older consent is a fabricated evidence record. So the riders who
 * accepted the placeholder text keep `0-placeholder` for ever, honestly saying
 * what they agreed to — and whether they should be asked to accept the real
 * text is a separate decision, not something a version bump does by itself.
 * **Re-consent is not a thing this app can do yet**: `accept_terms()` is
 * `where terms_accepted_at is null`, so a second call returns the first stamp
 * and leaves the old version, and the route guard branches on the timestamp
 * alone. §11 of the page is written to that reality rather than promising past
 * it.
 */
export const TERMS_VERSION = '0-placeholder'

/** Shown to the rider beside the version. Moves only when `TERMS_VERSION` does. */
export const TERMS_LAST_UPDATED = '18 September 2026'
