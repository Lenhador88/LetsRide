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
 * `PD-384` moved the introduction sheet out of this row and into the caller,
 * because `joinClub`'s own invalidate can unmount the row before a second round
 * trip decides whether one is owed.
 *
 * **`PD-392` inverted what the callback means, and this file is where that is
 * pinned.** The control no longer writes a membership for a club owing an
 * introduction: it reads the freshness guard, opens the sheet and writes
 * **nothing**. `Post` is what joins. So the two orderings this file asserts are
 * the reverse of the ones it used to:
 *
 * - the guard runs **before** any write, not after the join;
 * - `onIntroduce` fires **instead of** `joinClub`, not after it.
 *
 * Both are invisible to a type check and both revert in silence, which is why
 * they are asserted on the source rather than inferred.
 *
 * No jsdom here (`vitest.config.ts` stays `environment: 'node'`), so the tap
 * itself is not simulated — the same source-assertion shape
 * `ClubInviteJoin.test.tsx` uses for a click handler no static render can
 * reach. Comment-stripped for the same reason that file strips its own: this
 * docstring names `owesIntroduction`, `joinClub` and `hasIntroducedClub`, so a
 * bare substring match would pass against its own header.
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

const HANDLER = SOURCE.slice(SOURCE.indexOf('onClick={(event) => {'))

describe('JoinClubButton — the sheet opens instead of the join, never after it', () => {
  it('calls joinClub, hasIntroducedClub and onIntroduce nowhere during a static render', () => {
    joinClub.mockClear()
    hasIntroducedClub.mockClear()
    const onIntroduce = vi.fn()
    renderToStaticMarkup(
      <JoinClubButton
        clubId="club-1"
        clubName="Test Club"
        isDefaultClub={false}
        onIntroduce={onIntroduce}
      />
    )
    expect(joinClub).not.toHaveBeenCalled()
    expect(hasIntroducedClub).not.toHaveBeenCalled()
    expect(onIntroduce).not.toHaveBeenCalled()
  })

  it('reads the freshness guard BEFORE anything is written', () => {
    // PD-392's whole ordering, and the reverse of what this file asserted
    // before it. `hasIntroducedClub` used to run after `joinClub`; a refactor
    // that puts it back there reintroduces the stale-row defect in §D4 — a
    // cached row that still says `Join club` to a rider already in the club,
    // whose `Post` then reports a join that `ignoreDuplicates` never made.
    expect(HANDLER).toContain('const alreadyIntroduced = await hasIntroducedClub(clubId)')
    expect(HANDLER.indexOf('hasIntroducedClub(clubId)')).toBeLessThan(
      HANDLER.indexOf('joinClub(clubId)')
    )
  })

  it('opens the sheet INSTEAD of joining, and returns before the write', () => {
    // The `return` is the whole deferral: without it the control would open the
    // sheet and then join anyway, which is the defect PD-392 exists to fix
    // wearing a sheet.
    const gate = HANDLER.slice(
      HANDLER.indexOf('if (owesIntroduction('),
      HANDLER.indexOf('const result = await joinClub(clubId)')
    )
    expect(gate).toContain('onIntroduce?.(clubId)')
    expect(gate).toContain('return')

    // …and the gate is on the real rule, reached with the freshness answer.
    expect(HANDLER.indexOf('owesIntroduction(')).toBeGreaterThan(
      HANDLER.indexOf('alreadyIntroduced')
    )
  })

  it('still joins outright when no introduction is owed', () => {
    // The default club's path, and the reason it is not sheet-only: it is
    // exempt from introductions, so a membership written only by `Post` would
    // make the one club every rider is auto-joined to unjoinable.
    expect(HANDLER).toContain('const result = await joinClub(clubId)')
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

    // The stale-row case the freshness read exists for: already introduced, so
    // nothing is owed and the sheet must not open.
    expect(owesIntroduction({ viewerRole: 'member', isDefaultClub: false }, true)).toBe(false)
  })

  it('still renders Join club and preventDefault/stopPropagation on the tap', () => {
    const html = renderToStaticMarkup(
      <JoinClubButton clubId="club-1" clubName="Test Club" isDefaultClub={false} />
    )
    expect(html).toContain('Join club')
    expect(SOURCE).toContain('event.preventDefault()')
    expect(SOURCE).toContain('event.stopPropagation()')
  })
})
