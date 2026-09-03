import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const joinClub = vi.fn()
vi.mock('@/lib/actions/clubs', () => ({ joinClub }))

const hasIntroducedClub = vi.fn()
vi.mock('@/lib/data/club-introductions', () => ({
  hasIntroducedClub,
  owesIntroduction: (
    club: { viewerRole: string | null; isDefaultClub: boolean },
    introduced: boolean
  ) => club.viewerRole !== null && club.viewerRole !== 'owner' && !club.isDefaultClub && !introduced,
}))

const { JoinClubButton } = await import('@/components/clubs/JoinClubButton')

/**
 * `PD-384` — Explore's `Join club` never asked for an introduction because
 * the sheet used to live inside this row, and `joinClub`'s own invalidate can
 * unmount the row before a second round trip decides whether one is owed.
 * The fix moves the sheet to the caller (`ExploreClubsPage`) and leaves this
 * component with one job: call `onJoined` once, only when it should.
 *
 * No jsdom here (`vitest.config.ts` stays `environment: 'node'`), so the tap
 * itself is not simulated — the same source-assertion shape
 * `ClubInviteJoin.test.tsx` uses for a click handler no static render can
 * reach. Comment-stripped for the same reason that file strips its own: this
 * docstring names `owesIntroduction` and `hasIntroducedClub`, so a bare
 * substring match would pass against its own header.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const SOURCE = stripComments(
  readFileSync(
    path.resolve(fileURLToPath(new URL('../JoinClubButton.tsx', import.meta.url))),
    'utf8'
  )
)

describe('JoinClubButton — onJoined fires from the action, never from render', () => {
  it('calls joinClub, hasIntroducedClub and onJoined nowhere during a static render', () => {
    joinClub.mockClear()
    hasIntroducedClub.mockClear()
    const onJoined = vi.fn()
    renderToStaticMarkup(
      <JoinClubButton clubId="club-1" clubName="Test Club" onJoined={onJoined} />
    )
    expect(joinClub).not.toHaveBeenCalled()
    expect(hasIntroducedClub).not.toHaveBeenCalled()
    expect(onJoined).not.toHaveBeenCalled()
  })

  it('checks hasIntroducedClub only after a successful joinClub, and gates onJoined on owesIntroduction', () => {
    const handler = SOURCE.slice(SOURCE.indexOf('onClick={(event) => {'))

    // The error branch returns before the introduction check ever runs.
    const errorBranch = handler.slice(
      handler.indexOf('if (result.error)'),
      handler.indexOf('const alreadyIntroduced')
    )
    expect(errorBranch).toContain('return')

    // hasIntroducedClub is read for THIS join, and onJoined is behind the
    // owesIntroduction gate rather than called unconditionally.
    expect(handler).toContain('const alreadyIntroduced = await hasIntroducedClub(clubId)')
    expect(handler.indexOf('owesIntroduction(')).toBeGreaterThan(
      handler.indexOf('alreadyIntroduced')
    )
    expect(handler.indexOf('onJoined?.(clubId)')).toBeGreaterThan(handler.indexOf('owesIntroduction('))
  })

  it('asserts a fresh Explore join as a member of a non-default club, not a second read', () => {
    // The two facts a rider who just tapped Join in Explore always satisfies
    // (never the owner of a club they just joined; the default club auto-joins
    // at signup and so never renders this button) — see the component's own
    // header for why these are asserted rather than fetched again.
    expect(SOURCE).toContain("viewerRole: 'member', isDefaultClub: false")
  })

  it('still renders Join club and preventDefault/stopPropagation on the tap, unchanged by onJoined', () => {
    const html = renderToStaticMarkup(<JoinClubButton clubId="club-1" clubName="Test Club" />)
    expect(html).toContain('Join club')
    expect(SOURCE).toContain('event.preventDefault()')
    expect(SOURCE).toContain('event.stopPropagation()')
  })
})
