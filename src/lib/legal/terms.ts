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
 * Product owner, 2026-09-18: **Pedro personally, not a company**, and then the
 * name and the address themselves. A session could not have invented either — a
 * legal name is a fact about a person, and the address was a decision rather
 * than a lookup, taken with the alternative on the table: **this is a home
 * address, published knowingly, with a service address named as the option not
 * taken.** PD-462 is the review of that choice, and the only thing that changes
 * if it is revisited is the string below.
 *
 * **The type stays nullable, and that is not leftover.** A placeholder is a
 * value, so it renders: the first cut of this file held
 * `'[full legal name — PD-459]'` and the page published that to every rider,
 * inside the one clause that exists to say who the counterparty is. `null` is
 * the state that cannot reach a screen, so the page has to branch and the empty
 * arm has to say something honest. Anyone who ever needs to un-publish this —
 * which is exactly what PD-462 might decide — sets it back to `null` and the
 * page already knows what to do.
 *
 * **It moves with `TERMS_VERSION` below and never alone.** The day the operator
 * is identified is the day the text becomes something a rider can be held to;
 * naming nobody under a real version, or naming somebody under a pre-release
 * one, is the drift `__tests__/terms.test.ts` refuses.
 */
export const OPERATOR: { readonly name: string; readonly address: string } | null = {
  name: 'Pedro Miguel Fernandes Soares Abreu',
  address: 'Willem Claijstraat 15, 1647 AL Berkhout',
}

/**
 * Stamped onto `profiles.terms_version` by `private.current_terms_version()`,
 * which `118` moved off `030`'s `0-placeholder` in the same change as the
 * operator above.
 *
 * **`1.0` names a text, not a release.** It means the twelve sections at
 * `/legal/terms` naming an operator — the first version of this document a
 * rider could actually be held to. Moving it again is one migration redefining
 * that function, one edit here, and `TERMS_LAST_UPDATED` below;
 * `__tests__/terms.test.ts` reads the newest migration that touches the
 * function and refuses a page that disagrees with it.
 *
 * **Consents already stamped keep the version they were given.** `030` and
 * `118` both refuse a backfill, for the reason that a version invented for an
 * older consent is a fabricated evidence record. The riders who accepted the
 * placeholder text keep `0-placeholder` for ever, honestly saying what they
 * agreed to — and whether they should be asked to accept `1.0` is a separate
 * decision that a version bump does not make.
 * **Re-consent is not a thing this app can do yet**: `accept_terms()` is
 * `where terms_accepted_at is null`, so a second call returns the first stamp
 * and leaves the old version, and the route guard branches on the timestamp
 * alone. §11 of the page is written to that reality rather than promising past
 * it.
 */
export const TERMS_VERSION = '1.0'

/**
 * What `TERMS_VERSION` reads while no operator can be named — `030`'s original
 * value, and the only string in this file that means something rather than
 * numbering something.
 *
 * Exported so the interlock test can name it rather than quote it. The test
 * widens `TERMS_VERSION` at the comparison instead of this module widening the
 * export: TypeScript narrows the constant above to its literal and then rejects
 * the comparison as provably false, which is the compiler being right about
 * today and wrong about the test's job — and annotating the export to satisfy
 * it would cost every consumer the literal type for a reason none of them has.
 */
export const PRE_RELEASE_TERMS_VERSION = '0-placeholder'

/** Shown to the rider beside the version. Moves only when `TERMS_VERSION` does. */
export const TERMS_LAST_UPDATED = '18 September 2026'
