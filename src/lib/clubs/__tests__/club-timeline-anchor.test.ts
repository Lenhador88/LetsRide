import { describe, expect, it } from 'vitest'
import {
  resolveClubTimelineAnchorHunt,
  resolveClubTimelineScrollTarget,
} from '@/lib/clubs/club-timeline-anchor'

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

/**
 * `resolveClubTimelineAnchorHunt` — PD-375, `design.md` §D6. The hunt that
 * extends the stream, unasked, for a row a rider has paged past.
 *
 * The two-state guard this exists to make possible — "the hunt is still
 * running" versus "the screen may still scroll" — cannot be tested here: it
 * is a property of the CALLER holding two refs rather than one, not of this
 * pure decision. What belongs here is that this function's own outputs give
 * the caller enough to build that guard correctly: it never says "keep
 * hunting" once `complete` or the budget say otherwise, and it never conflates
 * "found" with "give up", which is what would let a caller re-use one ref for
 * both states.
 */
describe('resolveClubTimelineAnchorHunt', () => {
  it('is found for a row that already exists on the page', () => {
    expect(resolveClubTimelineAnchorHunt('#thread:1', () => true, false, 0, 3)).toBe('found')
  })

  it('is found — not give-up — for an empty fragment, so a caller need not special-case "no anchor"', () => {
    expect(resolveClubTimelineAnchorHunt('', () => false, false, 0, 3)).toBe('found')
    expect(resolveClubTimelineAnchorHunt('#', () => false, false, 0, 3)).toBe('found')
  })

  it('continues while the row is missing, the stream is incomplete and the budget remains', () => {
    expect(resolveClubTimelineAnchorHunt('#thread:1', () => false, false, 1, 3)).toBe('continue')
  })

  it('gives up once the stream is complete, even with budget left', () => {
    expect(resolveClubTimelineAnchorHunt('#thread:1', () => false, true, 0, 3)).toBe('give-up')
  })

  it('gives up once the budget is spent, even though the stream could still extend', () => {
    expect(resolveClubTimelineAnchorHunt('#thread:1', () => false, false, 3, 3)).toBe('give-up')
  })

  it('an unreachable anchor — a superseded reply, a deleted row — is the same give-up as a spent budget', () => {
    // `hasRow` never answers true because the collapse dropped this exact
    // message id for ever; the hunt cannot tell that apart from "not paged
    // deep enough yet" and must not try to, per `design.md` §D6.
    expect(resolveClubTimelineAnchorHunt('#reply:superseded', () => false, false, 3, 3)).toBe(
      'give-up'
    )
  })
})
