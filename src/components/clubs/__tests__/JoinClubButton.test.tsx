import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const joinClub = vi.fn()
vi.mock('@/lib/actions/clubs', () => ({ joinClub }))

const hasIntroducedClub = vi.fn()
// Only the round trip is mocked. `owesIntroduction` is the REAL one, because a
// reimplementation here cannot disagree with the module under test and so
// cannot catch the case below — this file previously supplied its own copy and
// asserted the arguments, which pinned a hardcoded `isDefaultClub: false` as
// intended behaviour.
vi.mock('@/lib/data/club-introductions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/club-introductions')>()),
  hasIntroducedClub,
}))

const { owesIntroduction } = await import('@/lib/data/club-introductions')

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
      <JoinClubButton clubId="club-1" clubName="Test Club" isDefaultClub={false} onJoined={onJoined} />
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

  it('reads isDefaultClub from its prop and never hardcodes it', () => {
    // The regression this replaces: `isDefaultClub: false` was a literal, on the
    // claim that the welcome club "can never appear here". `getExploreClubs`
    // filters its public half on `is_public` alone, and a rider who leaves the
    // welcome club — or whose signup join silently selected zero rows (`059`
    // §2) — gets it back on Explore with this very button. The prompt would
    // then ask them to introduce themselves to the one club nobody chose.
    expect(SOURCE).toContain("viewerRole: 'member', isDefaultClub")
    expect(SOURCE).not.toContain('isDefaultClub: false')
    expect(SOURCE).toContain('isDefaultClub: boolean')
  })

  it('does not owe an introduction for the default club, on the real gate', () => {
    // The real `owesIntroduction`, not a copy — so this fails if either the
    // component's arguments or the rule itself stops excluding the welcome
    // club. `hasIntroduced` is false: the rider has genuinely never introduced
    // themselves, which is exactly the state that used to open the sheet.
    expect(owesIntroduction({ viewerRole: 'member', isDefaultClub: true }, false)).toBe(false)
    expect(owesIntroduction({ viewerRole: 'member', isDefaultClub: false }, false)).toBe(true)
  })

  it('still renders Join club and preventDefault/stopPropagation on the tap, unchanged by onJoined', () => {
    const html = renderToStaticMarkup(
      <JoinClubButton clubId="club-1" clubName="Test Club" isDefaultClub={false} />
    )
    expect(html).toContain('Join club')
    expect(SOURCE).toContain('event.preventDefault()')
    expect(SOURCE).toContain('event.stopPropagation()')
  })
})
