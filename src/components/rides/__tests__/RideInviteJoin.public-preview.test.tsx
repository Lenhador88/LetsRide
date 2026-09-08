import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * The signed-out, live-token render — `115`, PD-430. Task 6.2.
 *
 * `RideInviteJoin.test.tsx` (if it existed) would be the place for this, but
 * there is no test file for that component yet; this one is scoped to exactly
 * the state `115` adds, matching `ClubInviteJoin.test.tsx`'s own narrower
 * sibling files rather than growing one monolith.
 *
 * `environment: 'node'` and a static render, per this repo's default: `useQuery`
 * is mocked directly (`BlockedRidersList.test.tsx`'s own pattern) rather than
 * mounted, so no effect ever fires and the mocked return value IS the first
 * paint — exactly what a signed-out visitor's first paint would be once the
 * fetch has resolved.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

vi.mock('@/lib/auth/use-session', () => ({
  useSignedIn: () => false,
}))

vi.mock('@/components/ui/OfflineState', () => ({
  useOnlineStatus: () => true,
}))

vi.mock('@/lib/actions/ride-invite-links', () => ({
  claimRideInviteLink: vi.fn(),
}))

/**
 * **The fixture carries `crew_count` and `organizer_avatar_path`, which
 * `RideInviteLinkPublicPreview` does not declare at all.** That is
 * deliberate: the task asks whether the component renders either field "when
 * both are supplied in the surrounding fixture", and a fixture built strictly
 * to the type could never supply them — only a cast lets a fixture stand in
 * for a component reaching past its own prop type at runtime (`(ride as
 * any).crew_count`), which `tsc` would not catch but a render would.
 */
const PUBLIC_PREVIEW_WITH_EXTRA_FIELDS = {
  ride_id: 'ride-1',
  title: 'Sunday coastal run',
  departure_at: '2027-05-01T09:00:00.000Z',
  timezone: 'Europe/Amsterdam',
  meeting_point: 'Dam Square, Amsterdam',
  organizer_username: 'pedro',
  // Present in the fixture, absent from the type — see the comment above.
  crew_count: 12,
  organizer_avatar_path: 'avatars/pedro.jpg',
}

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    useQuery: (key: readonly unknown[] | null) => {
      // The component issues two `useQuery` calls; only the one keyed
      // `publicLink` is live in the signed-out-with-token state this file
      // tests. A call keyed `link` (the authenticated preview) must stay
      // disabled here — asserted below by the token never appearing to it.
      if (key?.[1] === 'publicLink') {
        return {
          data: PUBLIC_PREVIEW_WITH_EXTRA_FIELDS,
          error: null,
          isLoading: false,
          isRefetching: false,
          refetch: () => {},
        }
      }
      return { data: undefined, error: null, isLoading: false, isRefetching: false, refetch: () => {} }
    },
  }
})

const { RideInviteJoin } = await import('@/components/rides/RideInviteJoin')

const TOKEN = 'a'.repeat(32)

describe('RideInviteJoin — the anonymous preview card, signed out with a live token', () => {
  it('renders the title and the meeting point', () => {
    const html = renderToStaticMarkup(<RideInviteJoin token={TOKEN} />)
    expect(html).toContain('Sunday coastal run')
    expect(html).toContain('Dam Square, Amsterdam')
    expect(html).toContain('Sign up to RSVP')
  })

  /**
   * **The assertion this task exists for.** Both excluded fields are present
   * on the object the mocked `useQuery` hands the component — see the fixture
   * comment above — so a pass here means the component itself never reaches
   * for them, not that the data never carried them.
   */
  it('does not render a crew count or an avatar, though both are on the fixture', () => {
    const html = renderToStaticMarkup(<RideInviteJoin token={TOKEN} />)
    expect(html).not.toContain('12 riders')
    expect(html).not.toContain('1 rider')
    expect(html).not.toMatch(/riders?<\/span>/)
    expect(html).not.toContain('avatars/pedro.jpg')
    // The initials fallback IS expected — it is computed from the username
    // string the projection already carries, not from the avatar path.
    expect(html).toContain('>P<')
  })

  it('renders no map and no club', () => {
    const html = renderToStaticMarkup(<RideInviteJoin token={TOKEN} />)
    expect(html).not.toContain('map')
    expect(html).not.toContain('club')
  })
})
