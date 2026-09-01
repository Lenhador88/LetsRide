import { describe, expect, it } from 'vitest'
import { resolveClubTimelineScrollTarget } from '@/lib/clubs/club-timeline-anchor'

/**
 * The one property `design.md` §D9 and `tasks.md` 11.6 both require: an
 * anchor naming no row on the page is a NO-OP, never a throw or a report.
 * `hasRow` stands in for `document.getElementById`, injected so this needs no
 * DOM — the same reason `boundedHorizon` and `resolveComboboxKey` are pure.
 *
 * **Verified both ways**, per CLAUDE.md §Working Principles: a version that
 * reports or throws when `hasRow` answers `false` fails `'is a no-op ...'`
 * below (asserted directly against a `hasRow` that always answers false, and
 * against the exact case a naive implementation gets wrong: the fragment IS a
 * well-formed anchor shape, it simply is not on the page), and a version that
 * returns the hash unconditionally — ignoring `hasRow` — fails
 * `'resolves to the row when it exists'`.
 */
describe('resolveClubTimelineScrollTarget', () => {
  it('is a no-op when the anchored row does not exist on the page — deleted, past the horizon, or unreadable are all this', () => {
    expect(resolveClubTimelineScrollTarget('#join:11111111-2222-4333-8444-555555555555', () => false)).toBeNull()
  })

  it('resolves to the row when it exists', () => {
    const hash = '#thread:22222222-3333-4444-8555-666666666666'
    expect(resolveClubTimelineScrollTarget(hash, () => true)).toBe(
      'thread:22222222-3333-4444-8555-666666666666'
    )
  })

  it('is a no-op for an empty fragment — no anchor at all, not merely an unresolved one', () => {
    expect(resolveClubTimelineScrollTarget('', () => true)).toBeNull()
    expect(resolveClubTimelineScrollTarget('#', () => true)).toBeNull()
  })

  it('strips the leading `#`, matching `window.location.hash`\'s own shape', () => {
    let queried: string | undefined
    resolveClubTimelineScrollTarget('#reply:33333333-4444-4555-8666-777777777777', (id) => {
      queried = id
      return true
    })
    expect(queried).toBe('reply:33333333-4444-4555-8666-777777777777')
  })
})
