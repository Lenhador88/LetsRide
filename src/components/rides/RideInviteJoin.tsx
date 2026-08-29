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
import { getRideInviteLinkPreview } from '@/lib/data/ride-invite-links'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { formatRideDateLong, formatRideTime } from '@/lib/utils'
import type { RideInviteLinkPreview } from '@/types'

/**
 * `/rides/join` — what somebody sees when they tap an invite link — `091`,
 * PD-330.
 *
 * ## The one screen in this app a stranger can open
 *
 * Every other route is behind the guard. This one is in `PUBLIC_PATHS` for
 * exactly one reason: the page must **mount** so it can hold the token across
 * the auth round trip. It is public so it can hold a credential, never so it can
 * show anything — with no session it renders a generic sentence naming neither
 * the ride nor its organizer, and **calls neither RPC**. The preview needs
 * `auth.uid()` for its block check and its participation-gate check, so there is
 * nothing to render before a session exists and nothing to leak. Decision #1 is
 * untouched and no `anon` grant is added to make this screen richer.
 *
 * The temptation this refuses is a product one: an invite page naming the ride
 * would convert better, and "they were sent the link, they already know". Anyone
 * can hold a URL, and the ride may be a private club's.
 *
 * ## The seven states, and the two that are easy to conflate
 *
 * No session · loading · live · dead · failed read · offline · already claimed.
 *
 * **`null` is decided and `undefined` is not yet.** The preview returns zero
 * rows for every dead state — expired, revoked, the ride deleted or departed,
 * blocked in either direction, un-onboarded, guessed — so `null` renders one
 * message and never says which. `undefined` renders the skeleton; conflating
 * them shows a dead-link flash on every load.
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
 * can refuse it.
 *
 * ## There is no v2 frame for this flow
 *
 * `npm run figma -- ls` returns `Invite riders` / `Invite riders - Filled`
 * (`Design · Rides`, **OLD stylesheet**, and a rider search rather than a link)
 * and `Join ride without account` (under `Archive`, out of scope under decision
 * #1 — it also draws the crew roster, which a bearer token must never see). So
 * this is assembled from measured components: the ride detail's own two icon
 * lines, `Avatar`, `Button`. Logged in the PR rather than called measured.
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

  // **Before the token check, deliberately.** A visitor with no session sees the
  // same generic invite whether they hold a live token, a dead one or none at
  // all — which is the point: this screen cannot tell them apart without asking
  // the database, and it does not ask.
  if (signedIn === false) return <SignedOutInvite />

  if (token === null) return <DeadLink />

  if (preview.error) return <ErrorState onRetry={preview.refetch} />
  if (preview.data === undefined) return <JoinSkeleton />
  if (preview.data === null) return <DeadLink />

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
          {/* `Rider` where the organizer has no readable username — the same
              fallback `PostcardStamp` draws, and reachable here for the same
              reason: the preview is a definer read and `profiles` is not. */}
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
 * What a visitor with no session sees — **generic, and identical for a live
 * token and a dead one**, because this screen cannot tell them apart without
 * asking the database and it does not ask.
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
 */
function DeadLink() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-display font-semibold text-foreground">This link has expired</h1>
        <p className="text-sm text-muted">
          Invite links stop working once the ride departs, and the organizer can turn one off at any
          time. Ask them for a new one.
        </p>
      </div>
      <Button href="/rides" variant="secondary" size="md">
        See your rides
      </Button>
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
