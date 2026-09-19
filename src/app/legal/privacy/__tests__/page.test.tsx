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
