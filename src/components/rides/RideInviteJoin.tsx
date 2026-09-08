'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSignedIn } from '@/lib/auth/use-session'
import { claimRideInviteLink } from '@/lib/actions/ride-invite-links'
import { getRideInviteLinkPreview, getRideInviteLinkPublicPreview } from '@/lib/data/ride-invite-links'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { formatRideDateLong, formatRideTime } from '@/lib/utils'
import type { RideInviteLinkPreview, RideInviteLinkPublicPreview } from '@/types'

/**
 * `/rides/join` — what somebody sees when they tap an invite link — `091` and
 * `115`, PD-330 and PD-430.
 *
 * ## The one screen in this app a stranger can open, and — since `115` — be shown something on
 *
 * Every other route is behind the guard. This one is in `PUBLIC_PATHS` so it
 * can **mount** and hold the token across the auth round trip, and — since
 * `115` — for a second reason: a signed-out visitor holding a **well-formed**
 * token now calls `public.ride_invite_link_public_preview`, the app's one
 * anonymous read, and sees five fields of the ride it names. A visitor with
 * **no** token, an **empty** one, or one that does not parse still sees
 * exactly what this screen has always shown them — the generic sentence naming
 * neither the ride nor its organizer — because the grant follows the token and
 * never `is_public`: there is nothing else here for a stranger with no token
 * to ask about.
 *
 * ## Decision #1 has one named exception, and this screen is where it renders
 *
 * `CLAUDE.md` §Architectural Decisions #1 now reads "no anonymous access, with
 * one named exception" — EXECUTE on `public.ride_invite_link_public_preview(t)`
 * alone, granted to `anon` and nothing else. It is a **strict subset** of what
 * `public.ride_invite_link_preview` already discloses to any holder of the
 * SAME token who signs in: `title`, `departure_at`, `timezone`,
 * `meeting_point`, `organizer_username`, minus `crew_count` and
 * `organizer_avatar_path`. What actually stood between an anonymous link
 * recipient and those five fields was never a boundary — it was the forced
 * onboarding wizard, decision #5 — and `115` is the owner deciding that
 * friction was not worth losing a stranger's first impression over.
 *
 * **A club-private ride is previewed exactly like a public one, and its class
 * stays unobservable rather than merely unfiltered.** The projection carries no
 * `club_id` and no `is_public`, so there is no field here to infer membership
 * from — refusing a club-private ride instead would itself be a new oracle,
 * telling any token holder which class of ride their token names, which is the
 * one thing every dead state on this screen is built not to do.
 *
 * ## The eight states, and the ones easy to conflate
 *
 * No session, no token · **no session, live token** · loading · live (signed
 * in) · dead · failed read · offline · already claimed. The bold one is `115`'s
 * addition; every other state on this list predates it.
 *
 * **`null` is decided and `undefined` is not yet, for both previews.** Each RPC
 * returns zero rows for every dead state it can see — expired, revoked, the
 * ride deleted or departed, guessed, and, for the authenticated one alone,
 * blocked in either direction or un-onboarded — so `null` renders one message
 * and never says which. `undefined` renders the skeleton; conflating them
 * shows a dead-link flash on every load.
 *
 * **A failed read is not a dead link.** A thrown read draws `ErrorState` with a
 * retry, because "we could not ask" and "the answer is no" are different
 * sentences and only one of them is the rider's fault to do nothing about.
 *
 * ## The claim is a tap, and this component is where that is held
 *
 * There is **no `useEffect` in this file**, deliberately, and its test asserts
 * that: no effect, no route-guard branch and no `onAuthStateChange` listener may
 * spend a token. A stash is a string in a browser and the rider who signs in is
 * not necessarily the rider who opened the link — an automatic claim joins
 * *whoever signs in next on this device* to a private ride they were never told
 * about, which is a perfectly valid claim at the database layer and therefore
 * invisible to every assertion in `supabase/tests/`. Only the client contract
 * can refuse it. **The anonymous preview issues no claim of any kind** —
 * `getRideInviteLinkPublicPreview` is a read with no write behind it anywhere,
 * so this rule is unaffected by `115` rather than merely compatible with it.
 *
 * ## There is no v2 frame for this flow
 *
 * `npm run figma -- ls` returns `Invite riders` / `Invite riders - Filled`
 * (`Design · Rides`, **OLD stylesheet**, and a rider search rather than a link)
 * and `Join ride without account` (under `Archive`). That frame draws
 * coordinates, a description, a photos rail and a `4/7` roster with four rider
 * names — every one of those is outside `115`'s six-column projection, so it is
 * evidence the screen was once designed, not a specification of what ships. So
 * both the signed-in and signed-out-with-token cards are assembled from
 * measured components: the ride detail's own two icon lines, `Avatar`,
 * `Button`. Logged in the PR rather than called measured.
 */
export function RideInviteJoin({
  token,
}: {
  /** `undefined` while the page is still resolving it, `null` when there is
   * none — a bare `/rides/join`, or a token that does not parse. */
  token: string | null | undefined
}) {
  const signedIn = useSignedIn()
  const online = useOnlineStatus()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [claiming, startClaiming] = useTransition()

  // `null` until BOTH are settled, which is what keeps the RPC unissued for a
  // visitor with no session — `useQuery` treats a null key as disabled and
  // never calls the fetcher.
  const key = signedIn && token ? queryKeys.invites.link(token) : null
  const preview = useQuery(key, () => getRideInviteLinkPreview(token as string))

  // `115`, PD-430. **Only a signed-out visitor holding a well-formed token
  // issues this one** — `signedIn === false` rather than `!signedIn`, so the
  // still-resolving `undefined` state never enables it, and `token` (already
  // parsed by `usePendingInviteToken`/`rideInviteTokenSchema` before it ever
  // reaches this component) gates it exactly as `key` above gates the
  // authenticated call.
  const publicKey =
    signedIn === false && token ? queryKeys.invites.publicLink(token) : null
  const publicPreview = useQuery(publicKey, () =>
    getRideInviteLinkPublicPreview(token as string)
  )

  function goToSignup() {
    router.push('/auth/signup')
  }

  // **The only caller of `claimRideInviteLink` in the app, and it is a click
  // handler.** See the header.
  function join() {
    if (!token) return
    setError(null)
    startClaiming(async () => {
      const result = await claimRideInviteLink(token)
      if (result.error || !result.claim) {
        setError(result.error ?? 'This invite link is no longer valid.')
        return
      }
      router.replace(routes.ride(result.claim.ride_id))
    })
  }

  if (signedIn === undefined || token === undefined) return <JoinSkeleton />

  // **This is the ordering `115` reverses, and only for the token-holding
  // case.** Until `115` a visitor with no session saw the same generic invite
  // whether they held a live token, a dead one or none at all, because the
  // screen could not tell them apart without asking the database — and it did
  // not ask. Now it does, but only when there is a well-formed token to ask
  // about: `token === null` here means none, empty, or unparseable, and that
  // visitor still gets exactly today's generic sentence, unchanged.
  if (signedIn === false) {
    if (token === null) return <SignedOutInvite />
    if (publicPreview.error) return <ErrorState onRetry={publicPreview.refetch} />
    if (publicPreview.data === undefined) return <JoinSkeleton />
    if (publicPreview.data === null) return <DeadLink signedIn={false} />
    return <PublicRideInvite ride={publicPreview.data} online={online} onSignup={goToSignup} />
  }

  if (token === null) return <DeadLink signedIn />

  if (preview.error) return <ErrorState onRetry={preview.refetch} />
  if (preview.data === undefined) return <JoinSkeleton />
  if (preview.data === null) return <DeadLink signedIn />

  const ride = preview.data

  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted">You have been invited to a ride</p>
        <h1 className="text-display font-semibold text-foreground">{ride.title}</h1>
      </div>

      <RidePreviewCard ride={ride} />

      {ride.is_crew ? (
        <div className="flex flex-col gap-2">
          {/* Already claimed — the control becomes a route into the ride rather
              than a Join the RPC would treat as a no-op. Re-tapping a link a
              rider already spent is the ordinary case, not an error: the URL
              sits in their chat history for ever. */}
          <p className="text-sm text-muted">You are already on this ride.</p>
          <Button href={routes.ride(ride.ride_id)} size="lg">
            Go to the ride
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button type="button" size="lg" onClick={join} loading={claiming} disabled={!online}>
            Join this ride
          </Button>
          {/* A claim is a write and is never queued: joining a ride while
              offline would report a membership the database has not got. The
              control says so rather than failing on tap. */}
          {!online && (
            <p className="text-xs font-medium text-muted">
              You’re offline — reconnect to join this ride.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The eight columns, drawn.
 *
 * Two icon lines rather than the archived frame's two 64px rows, matching what
 * `/rides/detail` settled on (PD-254) — this is the same information and there
 * is no reason for a rider to meet two different shapes of it.
 *
 * **A crew count and never a roster.** The preview returns a number; it does not
 * return the riders' ids or usernames, and no bearer token in this app can reach
 * them.
 */
function RidePreviewCard({ ride }: { ride: RideInviteLinkPreview }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <p className="flex items-center gap-2.5">
        <CalendarIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {formatRideDateLong(ride.departure_at, ride.timezone)},{' '}
          {formatRideTime(ride.departure_at, ride.timezone)}
        </span>
      </p>

      <p className="flex items-center gap-2.5">
        <LocationOutlineIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {ride.meeting_point}
        </span>
      </p>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Avatar
          src={ride.organizer.avatar_url}
          name={ride.organizer.username ?? 'Rider'}
          size="sm"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {/* `Rider` where the organizer has no readable username, reachable
              here because the preview is a definer read and `profiles` is
              not. */}
          {ride.organizer.username ?? 'Rider'} is organizing
        </span>
        <span className="shrink-0 text-sm font-medium text-muted">
          {ride.crew_count === 1 ? '1 rider' : `${ride.crew_count} riders`}
        </span>
      </div>
    </div>
  )
}

/**
 * What a token previews with **no session at all** — `115`, PD-430, six of
 * `RidePreviewCard`'s eight fields and none of its avatar or crew count.
 *
 * **No `Avatar src`, and drawing initials in its place is not a substitute.**
 * `RideInviteLinkPublicPreview` carries no `avatar_path` and no `avatar_url`
 * at all — `<Avatar src={null} …>` renders the same initials fallback it
 * always draws for a rider with no avatar, computed from the username string
 * this screen already has, and signs nothing and fetches nothing from
 * Storage. **No crew count either**, which is the row `RidePreviewCard` draws
 * last and this component never renders at all.
 */
function PublicRideInvite({
  ride,
  online,
  onSignup,
}: {
  ride: RideInviteLinkPublicPreview
  online: boolean
  onSignup: () => void
}) {
  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted">You have been invited to a ride</p>
        <h1 className="text-display font-semibold text-foreground">{ride.title}</h1>
      </div>

      <PublicRidePreviewCard ride={ride} />

      <div className="flex flex-col gap-2">
        <Button type="button" size="lg" onClick={onSignup} disabled={!online}>
          Sign up to RSVP
        </Button>
        {/* Signing up needs a network round trip same as any other write, so
            this follows the authenticated card's own Join button: disabled
            rather than queued, because there is nothing here to queue. */}
        {!online && (
          <p className="text-xs font-medium text-muted">
            You’re offline — reconnect to sign up.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The five data fields, drawn — no avatar image, no crew count, no map, no
 * club: `115`'s projection carries none of them. See `PublicRideInvite`'s own
 * comment for why the `Avatar` here draws no image.
 */
function PublicRidePreviewCard({ ride }: { ride: RideInviteLinkPublicPreview }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <p className="flex items-center gap-2.5">
        <CalendarIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {formatRideDateLong(ride.departure_at, ride.timezone)},{' '}
          {formatRideTime(ride.departure_at, ride.timezone)}
        </span>
      </p>

      <p className="flex items-center gap-2.5">
        <LocationOutlineIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {ride.meeting_point}
        </span>
      </p>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Avatar src={null} name={ride.organizer_username ?? 'Rider'} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {ride.organizer_username ?? 'Rider'} is organizing
        </span>
      </div>
    </div>
  )
}

/**
 * What a visitor with no session AND no well-formed token sees — **generic,
 * and identical for a dead token and no token at all**, because this screen
 * cannot tell them apart without asking the database and it does not ask. A
 * signed-out visitor holding a **live** token instead reaches
 * `PublicRideInvite` above — `115`'s reversal of this screen's own ordering,
 * for that one case alone.
 */
function SignedOutInvite() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-display font-semibold text-foreground">You have been invited</h1>
        <p className="text-sm text-muted">
          Someone has invited you to a ride on LetsRide. Sign in or create an account to see it and
          join.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button href="/auth/signup" size="lg">
          Create an account
        </Button>
        <Button href="/auth/login" variant="secondary" size="md">
          I already have an account
        </Button>
      </div>
    </div>
  )
}

/**
 * **One message for every dead state**, and it deliberately does not say which.
 * Expired, revoked, the ride deleted, the ride already departed, blocked in
 * either direction, or a token somebody typed — telling them apart is what would
 * make this an oracle for whether a given string is a real ride.
 *
 * **The CONTROL varies with the session and the message never does.** Before
 * `115` only a signed-in rider could reach this screen, so `See your rides` was
 * the only sensible way out. A signed-out visitor reaches it now — a stranger
 * whose link expired — and `/rides` is not in `PUBLIC_PATHS`, so that button
 * would hand them straight to the guard and land them on `/auth/login` with no
 * explanation. They arrived from a friend's group chat; the useful offer is an
 * account, which is what they would have been offered had the token been live.
 *
 * Splitting on the session is safe *here* precisely because it is the one fact
 * this screen already knows without asking the database. It says nothing about
 * the token, so the six dead states stay one indistinguishable answer for each
 * audience — which is the property `115`'s `2.9` asserts across all six.
 */
function DeadLink({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-display font-semibold text-foreground">This link has expired</h1>
        <p className="text-sm text-muted">
          Invite links stop working once the ride departs, and the organizer can turn one off at any
          time. Ask them for a new one.
        </p>
      </div>
      {signedIn ? (
        <Button href="/rides" variant="secondary" size="md">
          See your rides
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Button href="/auth/signup" size="lg">
            Create an account
          </Button>
          <Button href="/auth/login" variant="secondary" size="md">
            I already have an account
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Stands in for the block above it — the two-line title and the four rows of
 * the preview card. Nothing here is measured; it copies the geometry of the
 * component it replaces, which is what every skeleton in this app does.
 */
function JoinSkeleton() {
  return (
    <div role="status" aria-label="Loading invite" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-8 w-3/4 rounded" />
      </div>
      <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
        <Skeleton className="h-5 w-2/3 rounded" />
        <Skeleton className="h-5 w-1/2 rounded" />
        <Skeleton className="h-8 w-full rounded" />
      </div>
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  )
}
