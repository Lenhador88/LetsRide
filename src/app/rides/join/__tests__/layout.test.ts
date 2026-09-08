import { describe, expect, it } from 'vitest'
import { metadata } from '@/app/rides/join/layout'

/**
 * `noindex, nofollow` on `/rides/join` — `115`, PD-430, task 5.10.
 *
 * **This is not the assertion the spec asks for** — `anonymous-ride-preview`'s
 * own scenario wants the directive read "where the document actually exists",
 * which is `npm run walk`'s signed-out phase (tasks.md 6.4b), out of this
 * session's scope. This is the narrower thing a unit test *can* check: that the
 * object Next renders the tag from says what it must, so a later edit to this
 * file that drops the directive fails here before it ever reaches the walk.
 */
describe('the /rides/join segment declares noindex, nofollow', () => {
  it('sets both robots directives to false', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('is present unconditionally — the layout takes no token and no session', () => {
    // The metadata export is evaluated once for the segment; there is no
    // per-request branch here at all, which is what keeps the directive from
    // depending on whether the page ends up drawing a live preview, a dead
    // link, or the generic invite.
    expect(Object.keys(metadata)).toEqual(['robots'])
  })
})
