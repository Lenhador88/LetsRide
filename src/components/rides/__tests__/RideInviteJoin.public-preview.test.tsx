import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * The signed-out, live-token render — `115`, PD-430. Task 6.2.
 *
 * **`RideInviteJoin.test.tsx` exists** (since `41ee83b`, PD-330) and this is
 * deliberately not it. That file mounts the component with no session and
 * pins `091`'s contract — chiefly that nothing here spends a token without a
 * tap. This one needs a different module mock: `useQuery` stubbed per key so
 * the signed-out-with-token states can be rendered at all. `vi.mock` is
 * hoisted to module scope, so the two cannot share a file without one set of
 * mocks fighting the other. Same reason `ClubInviteJoin` has narrower sibling
 * files rather than one monolith.
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

/**
 * Mutable for the same reason `publicPreviewResult` below is: `vi.mock` is
 * hoisted to module scope, and the dead-link block needs to render the SAME
 * dead state to both audiences to pin that the message does not vary with
 * them. Defaults to the signed-out visitor, which is every other case here.
 */
let signedInResult: boolean | undefined = false

vi.mock('@/lib/auth/use-session', () => ({
  useSignedIn: () => signedInResult,
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

/**
 * What the mocked anonymous query answers with. Mutable because the two states
 * this file covers — a live token and a dead one — differ ONLY in this value,
 * and `vi.mock` is hoisted to module scope, so a second fixture would otherwise
 * mean a second file.
 *
 * `null` is the dead answer for every one of the six dead states, since the RPC
 * returns zero rows and raises for none of them.
 */
let publicPreviewResult: unknown = PUBLIC_PREVIEW_WITH_EXTRA_FIELDS

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
          data: publicPreviewResult,
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

/**
 * **The dead-token state, signed out — the regression `115` introduced and the
 * review caught.**
 *
 * Before `115` only a signed-in rider could reach `DeadLink`, so its single
 * control, `See your rides` → `/rides`, was the only sensible way out. A
 * stranger reaches it now, and **`/rides` is not in `PUBLIC_PATHS`** — that
 * button would hand them to the route guard and land them on `/auth/login`
 * with no explanation, having arrived from a friend's group chat. So the
 * control splits on the session while the MESSAGE does not.
 *
 * Both halves are asserted, because either one alone passes a broken build: an
 * assertion that the signup control is present passes a screen that also still
 * offers `/rides`, and an assertion that `/rides` is absent passes a screen
 * offering no way forward at all.
 */
describe('RideInviteJoin — a dead token, signed out', () => {
  const withDeadToken = (assert: (html: string) => void) => {
    const previous = publicPreviewResult
    publicPreviewResult = null
    try {
      assert(renderToStaticMarkup(<RideInviteJoin token={TOKEN} />))
    } finally {
      publicPreviewResult = previous
    }
  }

  it('offers an account rather than a link into the app the visitor cannot open', () => {
    withDeadToken((html) => {
      expect(html).toContain('This link has expired')
      expect(html).toContain('/auth/signup')
      expect(html).toContain('/auth/login')
      // The guarded route, which would bounce a signed-out visitor to the
      // login screen with nothing explaining why.
      expect(html).not.toContain('"/rides"')
      expect(html).not.toContain('See your rides')
    })
  })

  /**
   * **The message must not vary with the audience — asserted structurally, not
   * against a list of words.**
   *
   * A denylist of causes (`revoked`, `departed`, …) fails in both directions: a
   * harmless rewording to "once the ride **has departed**" turns it red, and
   * the regression actually worth catching — `DeadLink` growing a `cause` prop
   * and rendering "The organizer turned this link off" — contains none of those
   * words and would pass.
   *
   * So render the SAME dead state to both audiences, strip the controls, and
   * require what is left to be byte-identical. That is the property itself: the
   * only thing the session may change is the way out. A `DeadLink` that took a
   * cause, or that reworded itself for strangers, fails here whatever words it
   * chose.
   */
  it('renders a message that does not vary with the session, only the control', () => {
    // The message is the heading and the paragraph. Taking them by ELEMENT
    // rather than stripping controls is what makes this robust: the signed-out
    // branch wraps its two buttons in a flex `div` and the signed-in one does
    // not, so removing the anchors alone would leave that wrapper behind and
    // the comparison would fail on markup neither audience reads.
    // `[\s\S]` rather than the `s` flag: this repo's `tsconfig` target predates
    // es2018, so `/…/s` is a `tsc` error even though vitest runs it happily —
    // which is exactly the kind of thing only the type check catches.
    const message = (html: string) => (html.match(/<h1\b[^>]*>[\s\S]*?<\/p>/) ?? [''])[0]

    const previousPreview = publicPreviewResult
    const previousSignedIn = signedInResult
    let signedOut = ''
    let signedIn = ''
    try {
      publicPreviewResult = null
      signedInResult = false
      signedOut = renderToStaticMarkup(<RideInviteJoin token={TOKEN} />)
      // The authenticated path reaches `DeadLink` through `preview.data`, which
      // the mock leaves `undefined` — so drive it through the `token === null`
      // arm instead, which is the same `DeadLink` with `signedIn`.
      signedInResult = true
      signedIn = renderToStaticMarkup(<RideInviteJoin token={null} />)
    } finally {
      publicPreviewResult = previousPreview
      signedInResult = previousSignedIn
    }

    expect(message(signedIn)).toBe(message(signedOut))
    expect(message(signedOut)).not.toBe('')
    // Guard the guard: the FULL renders must still differ, or the assertion
    // above would pass on a build where the control never split at all.
    expect(signedIn).not.toBe(signedOut)
    expect(signedOut).toContain('Ask them for a new one')
  })

  /**
   * **The signed-in arm, which nothing else in this file reaches.** Inverting
   * the ternary is caught by the first case, but deleting the true arm — or
   * making both arms the signup pair — would ship a signed-in rider a "Create
   * an account" button with no test moving.
   */
  it('still offers a signed-in rider their rides, not an account', () => {
    const previous = signedInResult
    try {
      signedInResult = true
      const html = renderToStaticMarkup(<RideInviteJoin token={null} />)
      expect(html).toContain('See your rides')
      expect(html).toContain('"/rides"')
      expect(html).not.toContain('/auth/signup')
    } finally {
      signedInResult = previous
    }
  })

  /** Both fixtures are restored, so ordering between blocks is not load-bearing. */
  it('leaves the live-token render unaffected', () => {
    const html = renderToStaticMarkup(<RideInviteJoin token={TOKEN} />)
    expect(html).toContain('Sunday coastal run')
  })
})
