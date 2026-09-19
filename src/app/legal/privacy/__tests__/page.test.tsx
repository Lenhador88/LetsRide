import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import PrivacyPage from '../page'

/**
 * PD-303. Push delivery makes Apple and Google sub-processors of content this
 * app's RLS policies govern — another rider's username, and the name of a
 * PRIVATE club or the title of a non-public ride. Every outbound call before it
 * sent a query string or a coordinate.
 *
 * The disclosure is a task inside that child rather than a follow-up, because
 * the obligation begins with the first delivered push and the owner's deploy is
 * what starts it — a step no session can take and no gate can see. So the thing
 * worth pinning is not that the bullet exists but that it still says the two
 * parts a later tidy-up would naturally drop:
 *
 *   1. that the content is TRANSMITTED to a third party, not merely shown on a
 *      lock screen (design Q4: the lock screen is the rider's own device, the
 *      sub-processor is not — leading on the lock screen is materially the
 *      wrong question);
 *   2. that it covers PRIVATE clubs and rides, which is the case a rider would
 *      not otherwise expect and the only one that changes anybody's decision.
 *
 * Asserted against the rendered markup rather than the source, for the reason
 * `../../terms/__tests__/page.test.tsx` gives: the source can hold a sentence
 * that never reaches a screen.
 */
const MARKUP = renderToStaticMarkup(<PrivacyPage />)

describe('the privacy page discloses the push sub-processors', () => {
  it('names Apple and Google', () => {
    expect(MARKUP).toContain('Apple and Google')
  })

  it('says the notification text is sent to them, not merely displayed', () => {
    // "Shown on your lock screen" alone describes the rider's own device and
    // discloses no sub-processor at all.
    expect(MARKUP).toMatch(/sent to Apple/)
  })

  it('says the disclosure covers private clubs and non-public rides', () => {
    // The case a rider would not expect, and the only one that changes a
    // decision. A tidy-up that drops it leaves a bullet that is true and
    // useless.
    expect(MARKUP).toMatch(/including when that club or ride is private/)
  })

  it('names the username as part of what leaves', () => {
    expect(MARKUP).toMatch(/username/)
  })

  /**
   * `reviewer` finding 2, and it is the one that would have shipped to riders
   * on merge. The first version of this bullet said *"turning notifications off
   * in Profile stops us sending them"*. **There is no such control anywhere in
   * the app** — `PushPrimingRow` is mounted on `/notifications` only and its
   * states are `ask`/`blocked`/`stalled`/`hidden`, so it can offer to turn
   * notifications ON and nothing else; `grep -rn "push_opt\|pushEnabled\|
   * notificationsEnabled\|push_enabled" src/` is empty, and the only app-side
   * route to deleting a device row is `release_push_device` on sign-out.
   *
   * What made it plausible is that the analytics bullet further down carries
   * the same shape — "Open Profile, then the menu, then Privacy" — and that one
   * is real. So the sentence read as concrete, in the single bullet disclosing
   * a transfer to a new sub-processor.
   *
   * The assertion is therefore two-sided: the page must name the OS control,
   * which exists, and must NOT claim an in-app one until one is built.
   */
  it('points at the phone settings, and claims no in-app switch that does not exist', () => {
    expect(MARKUP).toMatch(/in your phone&#x27;s own Settings|in your phone’s own Settings/)
    expect(MARKUP).toMatch(/no switch for it inside the app/)
    expect(MARKUP).not.toMatch(/turning notifications off in <\/?span[^>]*>?Profile/)
  })

  /**
   * The retention windows. `121`'s `sweep_push_retention` comment asserts that
   * both are written here "in the same words", which was false when it was
   * written — `reviewer` finding 3. This is the half that makes it true, so the
   * two must move together.
   */
  it('states both retention windows the sweep enforces', () => {
    expect(MARKUP).toMatch(/60 days/)
    expect(MARKUP).toMatch(/7 days/)
  })

  /**
   * Adding those two windows put the page in contradiction with its own
   * opening, which said flatly that it does not set out "how long we keep
   * things" — found by the `data` track re-reading the committed page, not by a
   * gate. The comment above that paragraph warns against the mirror-image
   * mistake (*"Name what is missing; do not go back to denying that the page is
   * what it plainly is"*), and this was that sentence pointing the other way:
   * a public legal page denying a disclosure it had just made.
   *
   * The fix is narrowing rather than deletion, because the general gap is real
   * and still owed. This pins both halves so the next bullet that adds a period
   * does not re-open the contradiction.
   */
  it('does not deny stating retention while stating two retention periods', () => {
    expect(MARKUP).toMatch(/how long we keep most things/)
    expect(MARKUP).not.toMatch(/how long we keep things/)
    expect(MARKUP).toMatch(/Where a bullet below does give a period, that one is exact/)
  })

  /**
   * The rule the Geoapify and Sentry bullets already carry, applied here: a
   * claim that flips the moment the owner sets a provider key is a claim
   * nothing in CI, `docs:check` or a review can catch, on a public page about
   * where a rider's data goes. The deploy moves without this file moving.
   */
  it('makes no claim about whether push is switched on yet', () => {
    expect(MARKUP).not.toMatch(/no push|not sending|does not send any notification/i)
    expect(MARKUP).not.toMatch(/not yet (?:sent|delivered|enabled)/i)
  })

  it('publishes no placeholder and no issue id', () => {
    expect(MARKUP).not.toMatch(/\[[^\]]*\]/)
    expect(MARKUP).not.toMatch(/PD-\d+/)
  })
})
