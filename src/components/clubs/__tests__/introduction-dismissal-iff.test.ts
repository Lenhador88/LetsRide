import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The dismissal iff, pinned at **both** call sites — PD-392, `design.md` §D2.
 *
 *     a session dismissal is recorded  <=>  a membership exists at that moment
 *
 * **Why this is its own file, and why it asserts on source.** The rule is one
 * sentence applied in two screens, and the pre-build review caught the proposal
 * fixing one of them: the club detail's `onDismiss` was as unconditional as
 * Explore's, and `ContextMenu`'s scrim and Escape both close through it. A
 * rider who taps `Join later` on club X's own screen and is then admitted to X
 * by an approved request or an invite link **in the same session** would never
 * be asked to introduce themselves — a prompt suppressed on a fact the rider
 * never asserted. That is what three requirements of this change forbid, and it
 * is reachable on the screen the story's own copy is about.
 *
 * Neither screen is renderable under `environment: 'node'` — both mount
 * `useQuery` trees and `ContextMenu` draws nothing without a `document` — and
 * the defect is a *missing condition*, which no static render can see anyway.
 * So this reads the source, comment-stripped, the shape
 * `JoinClubButton.test.tsx` and `ClubInviteJoin.test.tsx` already use. The
 * stripping matters more than usual here: both screens explain this rule at
 * length in prose that names `dismissIntroductionPrompt`, so an unstripped
 * match would pass against the comment describing the bug.
 *
 * Verified both ways per CLAUDE.md §Working Principles: making either
 * `onDismiss` call `dismissIntroductionPrompt` unconditionally — the shape
 * before this change — fails the guarded-call assertion for that screen.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function read(relative: string): string {
  return stripComments(
    readFileSync(path.resolve(fileURLToPath(new URL(relative, import.meta.url))), 'utf8')
  )
}

const DETAIL = read('../../../app/(app)/clubs/detail/page.tsx')
const EXPLORE = read('../../../app/(app)/clubs/explore/page.tsx')

describe('the club detail screen records a dismissal only when a membership exists', () => {
  it('guards its onDismiss on the fact the sheet reports', () => {
    // The sheet is the only thing that knows — it issued the write. Reading it
    // back off the cache instead would race `invalidateClubMembership`.
    expect(DETAIL).toContain('onDismiss={(membershipExists) => {')
    expect(DETAIL).toContain('if (membershipExists) dismissIntroductionPrompt(id)')
  })

  it('has no unconditional dismissal left on the dismiss path', () => {
    // Exactly one bare call survives and it is `onPosted`'s, which IS the iff
    // rather than an exception to it: a successful Post means a membership
    // exists. The count is the assertion — a second bare call is the bug.
    const bare = DETAIL.match(/^\s*dismissIntroductionPrompt\(id\)$/gm) ?? []
    expect(bare).toHaveLength(1)
    expect(DETAIL).toContain('onPosted={() => {')
  })
})

describe('the Explore screen records a dismissal only when a membership exists', () => {
  it('takes the fact as a parameter rather than assuming it', () => {
    expect(EXPLORE).toContain('const advanceIntroductions = (recordDismissal: boolean) =>')
    expect(EXPLORE).toContain(
      'if (recordDismissal && introducingClubId) dismissIntroductionPrompt(introducingClubId)'
    )
  })

  it('passes the answer through on dismiss, and true on a successful post', () => {
    expect(EXPLORE).toContain('onDismiss={(membershipExists) => advanceIntroductions(membershipExists)}')
    expect(EXPLORE).toContain('onPosted={() => advanceIntroductions(true)}')
  })

  it('opens its sheet in pre-join mode — nothing is written before Post', () => {
    // Since PD-392 this screen's Join control writes nothing, so every sheet it
    // mounts starts before a membership exists. A `member` here would put
    // "Welcome to the club!" over a rider who has not joined.
    expect(EXPLORE).toContain('mode="pre-join"')
  })

  it('still keys the sheet per club, so a draft cannot follow the queue', () => {
    // PD-384's misdirected-introduction defect: the id flipping under a live
    // draft posts the rider's words about club A into club B. The key is what
    // makes a different club a different component instance.
    expect(EXPLORE).toContain('key={introducingClubId}')
  })
})
