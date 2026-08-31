import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { ClubShareOrInviteItem } = await import('@/components/clubs/ClubShareOrInviteItem')
const { BannerProvider } = await import('@/components/ui/Banner')

const CLUB_ID = '11111111-1111-4111-8111-111111111111'
const noop = () => {}

/**
 * `093`, PD-360 — the one component that decides `Share club` versus
 * `Invite riders`, and the row that a private club's live defect used to
 * hide behind.
 *
 * **The third state is the fix, and it is asserted as an ABSENCE.**
 * `RideInviteJoin.test.tsx` is the precedent CLAUDE.md names for exactly this
 * shape: an assertion that something renders cannot see a row that should
 * not. `ClubShareOrInviteItem` renders its rows DIRECTLY as `ContextMenuItem`
 * elements — a `Link` or a `button`, never the `ContextMenu` sheet itself —
 * so it is rendered here on its own. `ContextMenu` is deliberately NOT
 * mounted around it: that component returns `null` whenever
 * `typeof document === 'undefined'`, which is every run under this suite's
 * `environment: 'node'`, so wrapping it would make every case below draw
 * nothing regardless of which branch is right — the empty-sheet failure this
 * file exists to catch, self-inflicted. `ContextMenuItem`'s `Link` variant
 * needs no `next/navigation` mock either, matching `SectionHeader`'s own
 * `See all` — nothing here calls `useRouter` or `usePathname`. `useBanner` is
 * called unconditionally at the top of the component, so every render below
 * is wrapped in the real `BannerProvider`, `PostcardCard.test.tsx`'s own
 * reason: it is always mounted in the app, so this is the real tree rather
 * than a stub.
 */
function render(props: {
  isPublic: boolean | undefined
  viewerRole: 'owner' | 'admin' | 'member' | null
  isOwner: boolean
}) {
  return renderToStaticMarkup(
    <BannerProvider>
      <ClubShareOrInviteItem clubId={CLUB_ID} onDone={noop} {...props} />
    </BannerProvider>
  )
}

describe('ClubShareOrInviteItem — public club', () => {
  it('draws Share club for a non-member', () => {
    const html = render({ isPublic: true, viewerRole: null, isOwner: false })
    expect(html).toContain('Share club')
    // The pointer, not the grant (decision 3): a non-member may not invite.
    expect(html).not.toContain('Invite a rider')
  })

  it('draws Share club AND Invite a rider for an ordinary member', () => {
    const html = render({ isPublic: true, viewerRole: 'member', isOwner: false })
    expect(html).toContain('Share club')
    expect(html).toContain('Invite a rider')
    // Never the private-club label — the label is the safety property.
    expect(html).not.toContain('Invite riders')
  })

  it('draws both for an admin too', () => {
    const html = render({ isPublic: true, viewerRole: 'admin', isOwner: false })
    expect(html).toContain('Share club')
    expect(html).toContain('Invite a rider')
  })
})

describe('ClubShareOrInviteItem — private club', () => {
  it('draws Invite riders for the owner, and never Share club', () => {
    const html = render({ isPublic: false, viewerRole: 'owner', isOwner: true })
    expect(html).toContain('Invite riders')
    expect(html).not.toContain('Share club')
    expect(html).not.toContain('Invite a rider')
  })

  it('draws Invite riders for an admin who is not the owner', () => {
    const html = render({ isPublic: false, viewerRole: 'admin', isOwner: false })
    expect(html).toContain('Invite riders')
  })

  /**
   * The defect this component exists to fix, and the case a "does it render"
   * test cannot see. A private club's ordinary member reaching this menu
   * (the club thread screen, reading someone else's thread) drew a live
   * `Share club` defect before `093` — RLS refuses the URL to the recipient
   * it was just sent to. The fix is not a working share; it is NO ROW AT
   * ALL, and a row that renders "content unavailable" would be worse than
   * silence.
   */
  it('draws NOTHING for an ordinary member who is not an admin', () => {
    const html = render({ isPublic: false, viewerRole: 'member', isOwner: false })
    expect(html).not.toContain('Share club')
    expect(html).not.toContain('Invite riders')
    expect(html).not.toContain('Invite a rider')
  })

  it('draws NOTHING for a non-member', () => {
    const html = render({ isPublic: false, viewerRole: null, isOwner: false })
    expect(html).not.toContain('Share club')
    expect(html).not.toContain('Invite riders')
    expect(html).not.toContain('Invite a rider')
  })
})

/**
 * An unknown visibility renders nothing rather than guessing — `design.md`
 * §The share row is one component with three callers: "rendering the public
 * branch for a private club is exactly the bug being fixed."
 */
describe('ClubShareOrInviteItem — unresolved visibility', () => {
  it('draws nothing while isPublic has not resolved, even for an owner', () => {
    const html = render({ isPublic: undefined, viewerRole: 'owner', isOwner: true })
    expect(html).not.toContain('Share club')
    expect(html).not.toContain('Invite riders')
    expect(html).not.toContain('Invite a rider')
  })
})
