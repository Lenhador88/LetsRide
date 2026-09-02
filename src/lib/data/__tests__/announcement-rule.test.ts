import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANNOUNCEMENT_MARKER } from '@/lib/data/club-threads'

/**
 * All three browse reads still carry the announcement rule — PD-372.
 *
 * WHY THIS EXISTS. The rule is *"a thread is an announcement while
 * `introduces_user_id` is non-null, and an announcement is drawn once, on the
 * join row"*. It is spelled three different ways for three different
 * questions — `is null` on the base table, `is null` through an embed, and
 * `not … is null` asking the opposite — so there is no single literal a
 * refactor would break loudly. Drop any one of them and the club detail goes
 * back to drawing one conversation three ways, with **every other gate
 * green**: `tsc` type-checks a filter's absence perfectly, ESLint reads no
 * SQL, `next build` issues no query, the unit tests mock the client, and the
 * RLS suite runs on plain Postgres where this is not a policy question at all.
 * Only the walk renders the screen, and it asserts that routes render rather
 * than what is on them.
 *
 * The scan runs on COMMENT-STRIPPED source, this repo's standing trap
 * (`CLAUDE.md` §Technology Decisions, *the comment trap*): each of these files
 * now documents the rule at length, naming the very column and the very calls
 * the check looks for, so a naive scan passes on the prose after the code is
 * gone. `embed-hints.test.ts` is the precedent and the shape.
 *
 * Verified both ways per CLAUDE.md §Working Principles: deleting any one of
 * the three filters fails its own case, and deleting the code while leaving
 * the surrounding doc comment in place fails it too.
 */

/** Line and block comments, and nothing else — string contents are left alone. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function source(path: string): string {
  return stripComments(readFileSync(join(process.cwd(), path), 'utf8'))
}

describe('the announcement rule survives in every read that browses threads', () => {
  it('is one named definition rather than a literal repeated three times', () => {
    // The name is what the three call sites share; the strings they build from
    // it deliberately differ. A literal spelled out at a call site is how the
    // fourth read gets written without the rule.
    expect(ANNOUNCEMENT_MARKER).toBe('introduces_user_id')
  })

  it('getClubThreads keeps announcements off the Threads list and the timeline', () => {
    const code = source('src/lib/data/club-threads.ts')

    expect(code).toContain(`.is(${'ANNOUNCEMENT_MARKER'}, null)`)
    // In the query, beside the club filter — not after the read, which would
    // break the list's "is there more" signal and `boundedHorizon`'s
    // precondition that a source's rows ARE its window.
    expect(code).toMatch(/\.eq\('club_id', clubId\)\s*\n\s*\.is\(ANNOUNCEMENT_MARKER, null\)/)
  })

  it('getClubThreadUnread narrows the map with the same column, asking the opposite question', () => {
    const code = source('src/lib/data/club-threads.ts')

    expect(code).toContain(`.not(${'ANNOUNCEMENT_MARKER'}, 'is', null)`)
    // Bounded by the unread set. `marked` is what the RPC actually flagged, so
    // an `.in('id', …)` over anything else is the roster-bounded shape the
    // proposal rejected.
    expect(code).toContain(`.in('id', marked)`)
  })

  it('getClubThreadReplies keeps a comment on an announcement out of the window', () => {
    const code = source('src/lib/data/club-timeline.ts')

    // Through the embed that already scopes the window to one club — the same
    // `!inner` mechanism, on a column `097` grants.
    expect(code).toContain('.is(`thread.${ANNOUNCEMENT_MARKER}`, null)')
    expect(code).toContain("import { ANNOUNCEMENT_MARKER } from '@/lib/data/club-threads'")
  })

  it('no browse read restates a membership, block or club-privacy predicate', () => {
    // The rule is PRESENTATION, over rows `081` already returned. The moment a
    // filter here starts naming an audience, it is a second copy of a policy —
    // free to drift, and the copy that drifts is the one nobody reads.
    for (const path of ['src/lib/data/club-threads.ts', 'src/lib/data/club-timeline.ts']) {
      const code = source(path)
      expect(code).not.toContain('is_club_member')
      expect(code).not.toContain('is_blocked')
      expect(code).not.toContain('is_public')
    }
  })
})
