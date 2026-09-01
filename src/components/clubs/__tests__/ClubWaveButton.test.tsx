import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClubWaveButton } from '@/components/clubs/ClubWaveButton'

/**
 * `LikeButton`'s own docstring records the mistake this file's first block
 * guards against, now that the rule lives in `OptimisticToggle` and both
 * callers share it: a toggle button that renames itself between the verb and
 * its undo — "Wave" when unwaved, "Unwave" when waved — while ALSO reporting
 * `aria-pressed`, which announces "Unwave, 3 waves, pressed" — a control
 * named for undoing, reported as done. `aria-pressed` is meant to be the
 * WHOLE non-visual signal, so the word must never move; only the count and
 * the pressed state legitimately do.
 *
 * Markup, never pixels — `vitest.config.ts` is `environment: 'node'`, so
 * `renderToStaticMarkup` gives what the browser would parse and no layout at
 * all, matching `PostcardAction.test.tsx` and `SectionHeader.test.tsx`.
 */
const noop = async () => ({ error: null })

describe('ClubWaveButton — the accessible name is constant, aria-pressed is what moves', () => {
  it('keeps the same label whether waved or not, and moves aria-pressed alone', () => {
    const unwaved = renderToStaticMarkup(
      <ClubWaveButton state={{ count: 3, waved: false }} onWave={noop} onUnwave={noop} />
    )
    const waved = renderToStaticMarkup(
      <ClubWaveButton state={{ count: 3, waved: true }} onWave={noop} onUnwave={noop} />
    )

    // Same count on both sides on purpose: the count is the one thing that is
    // ALLOWED to move the label text, so holding it fixed isolates whether
    // `pressed` alone can still change the wording — which, per the rule
    // above, it must not.
    expect(unwaved).toContain('aria-label="Wave, 3 waves"')
    expect(waved).toContain('aria-label="Wave, 3 waves"')
    expect(unwaved).toContain('aria-pressed="false"')
    expect(waved).toContain('aria-pressed="true"')
    expect(waved).not.toContain('Unwave')
  })

  it('moves the count in the label as the state moves, without inventing a second verb', () => {
    const html = renderToStaticMarkup(
      <ClubWaveButton state={{ count: 6, waved: true }} onWave={noop} onUnwave={noop} />
    )
    expect(html).toContain('aria-label="Wave, 6 waves"')
    expect(html).not.toContain('Unwave')
  })
})

describe('ClubWaveButton — loading', () => {
  it('renders disabled with no count, rather than being held behind the read', () => {
    // `state: undefined` is `client-render-shell`'s Loading row: the entry
    // (and this decoration) render immediately, never gated on the fetch.
    const html = renderToStaticMarkup(
      <ClubWaveButton state={undefined} onWave={noop} onUnwave={noop} />
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-label="Wave"')
    // No count element at all — `Count` (`PostcardAction.tsx`) renders
    // nothing for an absent value, matching a genuine zero.
    expect(html).not.toContain('tabular-nums')
  })
})
