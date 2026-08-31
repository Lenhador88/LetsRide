import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { ClubDestructiveRows } = await import('@/components/clubs/ClubOptionsMenu')

const CLUB_ID = '11111111-1111-4111-8111-111111111111'
const noop = () => {}

/**
 * `095`, PD-194 — the owner's `Leave club` row, added beside `Delete club`.
 * `ClubDestructiveRows` is the row set apart from `ClubOptionsMenu`'s own
 * state and the `<ContextMenu>` wrapper, which returns `null` under this
 * suite's `environment: 'node'` (no `document`) whatever `open` is —
 * `ThreadOptionsRows.test.tsx` and `ClubShareOrInviteItem.test.tsx` are the
 * precedent for testing a menu's rows this way.
 */
function render(props: { isOwner: boolean; isMember: boolean; pending?: boolean }) {
  return renderToStaticMarkup(
    <ClubDestructiveRows
      clubId={CLUB_ID}
      pending={false}
      onEditClick={noop}
      onOwnerLeave={noop}
      onLeave={noop}
      onDeleteClick={noop}
      {...props}
    />
  )
}

describe('ClubDestructiveRows — the owner’s Leave row', () => {
  it('an owner sees Edit club, Leave club AND Delete club', () => {
    const html = render({ isOwner: true, isMember: true })
    expect(html).toContain('Edit club')
    expect(html).toContain('Leave club')
    expect(html).toContain('Delete club')
  })

  it('a non-owner member sees Leave club and NOT Edit club or Delete club — the existing row, untouched', () => {
    const html = render({ isOwner: false, isMember: true })
    expect(html).toContain('Leave club')
    expect(html).not.toContain('Delete club')
    expect(html).not.toContain('Edit club')
  })

  it('a non-member sees NONE of the three', () => {
    const html = render({ isOwner: false, isMember: false })
    expect(html).not.toContain('Leave club')
    expect(html).not.toContain('Delete club')
    expect(html).not.toContain('Edit club')
  })
})

/**
 * The source half of `design.md` §D7's one-bit-leak defence: the client must
 * never fork the RPC's ONE combined refusal (arm 2 and arm 3 together) into
 * two more specific strings, because doing so would tell an owner blocked
 * with their club's only member that a member exists whom they cannot see.
 *
 * Comment-stripped, `RideInviteJoin.test.tsx`'s precedent, so a docstring
 * naming the constants does not satisfy its own obituary.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const SOURCE = stripComments(
  readFileSync(
    path.resolve(fileURLToPath(new URL('../ClubOptionsMenu.tsx', import.meta.url))),
    'utf8'
  )
)

const ownerLeaveFn = SOURCE.slice(
  SOURCE.indexOf('function onOwnerLeave'),
  SOURCE.indexOf('return (\n    <>')
)

describe('ClubOptionsMenu — onOwnerLeave never invents a second refusal string', () => {
  it('the client-count branch (no RPC call) uses the CLIENT’s own copy, never the database’s', () => {
    const floorBranch = ownerLeaveFn.slice(0, ownerLeaveFn.indexOf('startTransition'))
    expect(floorBranch).toContain('CLUB_ONLY_RIDER_LEAVE_REASON')
    expect(floorBranch).not.toContain('CLUB_NEEDS_ANOTHER_ADMIN_MESSAGE')
  })

  it('the RPC-refusal branch carries exactly ONE comparison, so arm 2 and arm 3 cannot be told apart', () => {
    const rpcBranch = ownerLeaveFn.slice(ownerLeaveFn.indexOf('startTransition'))
    expect(rpcBranch).toContain('CLUB_NEEDS_ANOTHER_ADMIN_MESSAGE')
    // Fails against the regression this test exists for: a second `if
    // (result.error === …)` here would mean a client-side arm-2-vs-arm-3
    // split has been added on top of the database's single message.
    const comparisons = rpcBranch.match(/result\.error === /g) ?? []
    expect(comparisons).toHaveLength(1)
  })
})
