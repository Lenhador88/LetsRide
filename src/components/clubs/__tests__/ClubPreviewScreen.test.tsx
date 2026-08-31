import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ClubPreview } from '@/types'

// `ClubPreviewScreen` mounts `ClubDetailHeader`, whose `useSwipeBack` calls
// `useRouter()` — throws outside a Next tree. Nothing here navigates, and no
// effect runs under a static render, so a stub is enough — `RideInviteJoin
// .test.tsx`'s own reasoning for the identical mock.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

const { ClubPreviewScreen } = await import('@/components/clubs/ClubPreviewScreen')

function club(overrides: Partial<ClubPreview> = {}): ClubPreview {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Night Owls',
    avatar_path: null,
    avatar_url: null,
    location_name: 'Utrecht',
    latitude: null,
    longitude: null,
    members_count: 4,
    request_status: null,
    ...overrides,
  }
}

/**
 * `093`, PD-360's two new behaviours on `085`'s own reduced club screen — the
 * landing route reuses this component rather than a bespoke card, so both
 * reversals are the whole safety property of `/clubs/join`.
 *
 * Both are one-class or one-branch reversals that screenshot plausibly
 * against a private club with no action supplied, which is every club `085`
 * itself sends here — verified both ways per CLAUDE.md §Working Principles by
 * reverting each change locally and confirming the matching case here fails.
 */
describe('ClubPreviewScreen — the action slot replaces the request block entirely', () => {
  it('draws Request to join club when no action is supplied — 085’s own call site, unchanged', () => {
    const html = renderToStaticMarkup(<ClubPreviewScreen club={club()} />)
    expect(html).toContain('Request to join club')
  })

  it('draws no Request to join club, and no requested/declined text, when an action is supplied', () => {
    const html = renderToStaticMarkup(
      <ClubPreviewScreen club={club()} action={<button type="button">Join club</button>} />
    )
    expect(html).not.toContain('Request to join club')
    expect(html).not.toContain('The club’s admins will answer')
    expect(html).not.toContain('The club said no')
    expect(html).toContain('Join club')
  })

  /**
   * The case §7.7a exists for: a rider holding BOTH a pending request and a
   * live token sees the action, never the "you have asked to join" text —
   * the claim is the immediate route and it clears the request.
   */
  it('draws the action rather than the pending-request text, even when request_status is pending', () => {
    const html = renderToStaticMarkup(
      <ClubPreviewScreen
        club={club({ request_status: 'pending' })}
        action={<button type="button">Join club</button>}
      />
    )
    expect(html).not.toContain('admins will answer')
    expect(html).toContain('Join club')
  })
})

describe('ClubPreviewScreen — is_public branches the two hardcoded lines', () => {
  it('draws Private club and its sentence when isPublic is omitted — 085’s own call site', () => {
    const html = renderToStaticMarkup(<ClubPreviewScreen club={club()} />)
    expect(html).toContain('Private club')
    expect(html).toContain('This club is private')
  })

  it('draws neither line when isPublic is true — a token can outlive a flip', () => {
    const html = renderToStaticMarkup(<ClubPreviewScreen club={club()} isPublic />)
    expect(html).not.toContain('Private club')
    expect(html).not.toContain('This club is private')
  })
})
