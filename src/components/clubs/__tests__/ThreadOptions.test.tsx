import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { ThreadOptionsRows } = await import('@/components/clubs/ThreadOptions')
const { BannerProvider } = await import('@/components/ui/Banner')

const CLUB_ID = '11111111-1111-4111-8111-111111111111'
const noop = () => {}

/**
 * `094`, PD-348 — the thread's ⋯ menu, testable in two halves for the same
 * reason `ClubShareOrInviteItem.test.tsx` splits itself off from
 * `ContextMenu`: that component returns `null` whenever `typeof document ===
 * 'undefined'`, which is every run under this suite's `environment: 'node'`
 * — so rendering the whole `ThreadOptions` sheet would draw nothing
 * regardless of which row is right. `ThreadOptionsRows` renders the rows
 * directly, with no sheet wrapper, so presence and absence are both visible.
 *
 * `BannerProvider` is real, not stubbed: `ClubShareOrInviteItem` calls
 * `useBanner()` unconditionally, and it is always mounted in the app.
 */
function render(props: {
  isPublic: boolean
  viewerRole: 'owner' | 'admin' | 'member' | null
  isOwner: boolean
  isAuthor: boolean
  canModerate: boolean
}) {
  return renderToStaticMarkup(
    <BannerProvider>
      <ThreadOptionsRows
        clubId={CLUB_ID}
        pending={false}
        onShareDone={noop}
        onReport={noop}
        onDeleteClick={noop}
        {...props}
      />
    </BannerProvider>
  )
}

/**
 * `design.md` §D10's viewer × row table, built exactly. Every case below
 * asserts BOTH the row that renders AND the row that does not — `RideInviteJoin`'s
 * precedent for why an absence has to be checked directly rather than
 * inferred from a presence assertion passing.
 */
describe('ThreadOptionsRows — the D10 table', () => {
  it('a plain member who is the author sees Delete and NOT Report', () => {
    const html = render({
      isPublic: false,
      viewerRole: 'member',
      isOwner: false,
      isAuthor: true,
      canModerate: false,
    })
    expect(html).toContain('Delete thread')
    expect(html).not.toContain('Report thread')
  })

  it('a club admin who authored the thread STILL sees only Delete — the narrower right wins', () => {
    const html = render({
      isPublic: false,
      viewerRole: 'admin',
      isOwner: false,
      isAuthor: true,
      canModerate: true,
    })
    expect(html).toContain('Delete thread')
    expect(html).not.toContain('Report thread')
  })

  it('a plain member reading someone else’s thread sees Report and NOT Delete — the hole 093 opened', () => {
    // Private club, ordinary member, not the author: before this change
    // ClubShareOrInviteItem draws nothing here and there was no Delete row
    // either, so the whole sheet was empty behind the dots icon.
    const html = render({
      isPublic: false,
      viewerRole: 'member',
      isOwner: false,
      isAuthor: false,
      canModerate: false,
    })
    expect(html).toContain('Report thread')
    expect(html).not.toContain('Delete thread')
    // The fix is a row, not a placeholder — nothing claims the sheet is empty.
    expect(html).not.toContain('unavailable')
  })

  it('a club admin, not the author, sees BOTH Report and Delete', () => {
    const html = render({
      isPublic: false,
      viewerRole: 'admin',
      isOwner: false,
      isAuthor: false,
      canModerate: true,
    })
    expect(html).toContain('Report thread')
    expect(html).toContain('Delete thread')
  })

  it('an ownerless owner (viewerRole null, isOwner true), not the author, sees BOTH', () => {
    // 054/PD-128: an owner can hold no club_members row at all. `canModerate`
    // must come from `viewer_is_owner`, never from `viewerRole === 'owner'`,
    // or exactly this viewer loses the moderation row — design.md §D2.
    const html = render({
      isPublic: false,
      viewerRole: null,
      isOwner: true,
      isAuthor: false,
      canModerate: true,
    })
    expect(html).toContain('Report thread')
    expect(html).toContain('Delete thread')
  })

  it('the club owner, not the author, sees BOTH', () => {
    const html = render({
      isPublic: false,
      viewerRole: 'owner',
      isOwner: true,
      isAuthor: false,
      canModerate: true,
    })
    expect(html).toContain('Report thread')
    expect(html).toContain('Delete thread')
  })

  /**
   * Fails against the mistake it names: gating `Delete thread` on
   * `viewerRole === 'admin'` alone (dropping the `isOwner` disjunct) would
   * hide the row from precisely this viewer, who holds no roster row and
   * therefore no `viewerRole` at all. `canModerate: false` here stands in
   * for that regression — an ownerless owner computed the OLD way.
   */
  it('fails closed rather than open: canModerate=false hides Delete even for viewer_is_owner data shape', () => {
    const html = render({
      isPublic: false,
      viewerRole: null,
      isOwner: true,
      isAuthor: false,
      canModerate: false,
    })
    expect(html).not.toContain('Delete thread')
    expect(html).toContain('Report thread')
  })
})

/**
 * The menu is structurally never empty after this change: `isAuthor` is a
 * boolean, so either it is true (Delete renders) or false (Report renders).
 * Swept across every combination of the other three flags rather than
 * asserted for one, because the invariant is supposed to hold for all of
 * them.
 */
describe('ThreadOptionsRows — never an empty sheet', () => {
  it('always draws at least one of Report thread / Delete thread', () => {
    for (const isPublic of [true, false]) {
      for (const viewerRole of ['owner', 'admin', 'member', null] as const) {
        for (const isOwner of [true, false]) {
          for (const isAuthor of [true, false]) {
            for (const canModerate of [true, false]) {
              const html = render({ isPublic, viewerRole, isOwner, isAuthor, canModerate })
              const hasRow = html.includes('Report thread') || html.includes('Delete thread')
              expect(hasRow).toBe(true)
            }
          }
        }
      }
    }
  })
})

/**
 * The source half of `design.md` Q4's confirm sheet — `RideInviteJoin.test.tsx`
 * is the precedent for asserting an ABSENCE in the source rather than in the
 * markup, because a tap cannot be simulated under this suite's `environment:
 * 'node'` (no jsdom, no events — `vitest.config.ts`'s own header). Comment-
 * stripped for the same reason as that file: a docstring naming
 * `deleteClubThread`/`moderateClubThread` would otherwise satisfy its own
 * obituary.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const SOURCE = stripComments(
  readFileSync(
    path.resolve(fileURLToPath(new URL('../ThreadOptions.tsx', import.meta.url))),
    'utf8'
  )
)

describe('ThreadOptions — a tap on Delete thread opens a confirm and deletes nothing', () => {
  it('wires the menu row to openDeleteConfirm, never to the delete calls themselves', () => {
    // The FIRST ContextMenu is the options sheet; the SECOND is the confirm
    // sheet. Slicing between them isolates the row a single tap can reach
    // from the confirm button a second, explicit tap reaches.
    const optionsSheet = SOURCE.slice(
      SOURCE.indexOf('<ContextMenu open={open}'),
      SOURCE.indexOf('<ContextMenu\n        open={confirmingDelete}')
    )
    expect(optionsSheet).not.toContain('deleteClubThread(')
    expect(optionsSheet).not.toContain('moderateClubThread(')
    expect(optionsSheet).toContain('onDeleteClick={openDeleteConfirm}')
  })

  it('calls the delete RPCs only from inside onConfirmDelete, the confirm button’s own handler', () => {
    const confirmFn = SOURCE.slice(
      SOURCE.indexOf('function onConfirmDelete'),
      SOURCE.indexOf('function onReport')
    )
    expect(confirmFn).toContain('deleteClubThread(')
    expect(confirmFn).toContain('moderateClubThread(')
  })

  it('Report thread sends on one tap — no confirm sheet, matching PostcardMenu.onReport', () => {
    const reportFn = SOURCE.slice(
      SOURCE.indexOf('function onReport'),
      SOURCE.indexOf('return (\n    <>')
    )
    expect(reportFn).toContain('reportClubThread(')
    expect(reportFn).not.toContain('setConfirmingDelete(true)')
  })
})
