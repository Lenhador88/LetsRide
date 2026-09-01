'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { Skeleton } from '@/components/ui/Skeleton'
import { ClubPreviewScreen } from '@/components/clubs/ClubPreviewScreen'
import { useSignedIn } from '@/lib/auth/use-session'
import { claimClubInviteLink } from '@/lib/actions/club-invite-links'
import { getClubInviteLinkPreview } from '@/lib/data/club-invite-links'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * `/clubs/join` — what somebody sees when they tap a club invite link —
 * `093`, PD-360, `RideInviteJoin`'s exact shape one domain over, with the
 * product owner's browse-then-join refinement folded in.
 *
 * ## The second screen in this app a stranger can open
 *
 * `/clubs/join` is in `PUBLIC_PATHS` for exactly `/rides/join`'s reason: the
 * page must **mount** so it can hold the token across the auth round trip. It
 * is public so it can hold a credential, never so it can show anything — with
 * no session it renders a generic sentence naming neither the club nor its
 * minter, and **calls neither RPC**. The preview needs `auth.uid()` for its
 * block check and its participation-gate check, so there is nothing to render
 * before a session exists and nothing to leak.
 *
 * ## The landing is `ClubPreviewScreen`, not a bespoke card
 *
 * Product owner, 2026-08-31: *"maybe the invitee gets the chance to browse the
 * club and only then can click 'join club' on the bottom bar?"* So unlike
 * `RideInviteJoin`, which draws its own preview card, this component feeds
 * `085`'s own reduced club screen — the one a non-member of a private club
 * already lands on from Explore — and supplies only the `isPublic` flag the
 * token path needs and the `action` slot the claim lives in. See
 * `ClubPreviewScreen`'s own docstring for what changes on that path and what
 * does not.
 *
 * ## `null` is decided and `undefined` is not yet
 *
 * The preview returns **zero rows** for every dead state — expired, revoked,
 * the club deleted, the minter demoted or departed, blocked in either
 * direction, un-onboarded, already a member, or the owner — and unlike a ride
 * invite link, none of those has its own branch: `design.md` §Liveness and
 * reachability folds "already a member" into the same "no longer valid"
 * outcome as expiry, because a token holder learning they are already in is
 * not a state worth a second sentence. `null` renders one message and never
 * says which; `undefined` renders the skeleton.
 *
 * **A failed read is not a dead link.** A thrown read draws `ErrorState` with
 * a retry, for `RideInviteJoin`'s exact reason.
 *
 * ## The claim is a tap, and this component is where that is held
 *
 * There is **no `useEffect` in this file**, deliberately, and its test asserts
 * that on comment-stripped source — `RideInviteJoin.test.tsx`'s own trap,
 * copied exactly: that component's docstring makes the identical claim and the
 * first version of its test passed against a correct file for the wrong
 * reason, matching a bare `useEffect` inside its own obituary comment. No
 * effect, no route-guard branch and no `onAuthStateChange` listener may spend
 * a stashed token — a stash is a string in a browser and the rider who signs
 * in is not necessarily the rider who opened the link.
 *
 * ## There is no v2 frame for this flow
 *
 * `npm run figma -- ls "*nvite*"` finds nothing under Clubs — task 0.9's own
 * expectation, confirmed. The signed-out state and skeleton below are
 * assembled from `RideInviteJoin`'s own measured shapes rather than invented;
 * the signed-in state is `ClubPreviewScreen` itself, which is not invented at
 * all.
 */
export function ClubInviteJoin({
  token,
}: {
  /** `undefined` while the page is still resolving it, `null` when there is
   * none — a bare `/clubs/join`, or a token that does not parse. */
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
  const key = signedIn && token ? queryKeys.clubInvites.link(token) : null
  const preview = useQuery(key, () => getClubInviteLinkPreview(token as string))

  // **The only caller of `claimClubInviteLink` in the app, and it is a click
  // handler.** See the header.
  function join() {
    if (!token) return
    setError(null)
    startClaiming(async () => {
      const result = await claimClubInviteLink(token)
      if (result.error || !result.claim) {
        setError(result.error ?? 'This invite link is no longer valid.')
        return
      }
      router.replace(routes.club(result.claim.club_id))
    })
  }

  if (signedIn === undefined || token === undefined) return <JoinSkeleton />

  // **Before the token check, deliberately.** A visitor with no session sees
  // the same generic invite whether they hold a live token, a dead one or none
  // at all — this screen cannot tell them apart without asking the database,
  // and it does not ask.
  if (signedIn === false) return <SignedOutInvite />

  if (token === null) return <DeadLink />

  if (preview.error) return <ErrorState onRetry={preview.refetch} />
  if (preview.data === undefined) return <JoinSkeleton />
  if (preview.data === null) return <DeadLink />

  const club = preview.data

  return (
    <ClubPreviewScreen
      club={{
        id: club.club_id,
        name: club.name,
        avatar_url: club.avatar_url,
        location_name: club.location_name,
        members_count: club.members_count,
      }}
      isPublic={club.is_public}
      action={
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            onClick={join}
            loading={claiming}
            disabled={!online}
            className="w-full"
          >
            Join club
          </Button>
          {/* A claim is a write and is never queued: joining a club while
              offline would report a membership the database has not got. The
              control says so rather than failing on tap. */}
          {!online && (
            <p className="text-xs font-medium text-muted">
              You’re offline — reconnect to join this club.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      }
    />
  )
}

/**
 * What a visitor with no session sees — **generic, and identical for a live
 * token and a dead one**, because this screen cannot tell them apart without
 * asking the database and it does not ask.
 */
function SignedOutInvite() {
  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-display font-semibold text-foreground">You have been invited</h1>
        <p className="text-sm text-muted">
          Someone has invited you to a club on LetsRide. Sign in or create an account to see it
          and join.
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
 * **One message for every dead state**, and it deliberately does not say
 * which — expired, revoked, the club deleted, the minter demoted or departed,
 * blocked in either direction, already a member, the owner, or a token
 * somebody typed. Telling them apart is what would make this an oracle for
 * whether a given string is a real club.
 */
function DeadLink() {
  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-display font-semibold text-foreground">This link has expired</h1>
        <p className="text-sm text-muted">
          Invite links stop working after two weeks, and an admin can turn one off at any time.
          Ask them for a new one.
        </p>
      </div>
      <Button href="/clubs" variant="secondary" size="md">
        See your clubs
      </Button>
    </div>
  )
}

/**
 * Stands in for the block above it — the club header, the location and
 * member-count lines, and the sticky action. `RideInviteJoin`'s `JoinSkeleton`
 * geometry, one domain over; nothing here is measured.
 */
function JoinSkeleton() {
  return (
    <div role="status" aria-label="Loading invite" className="flex flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1 px-4">
        <Skeleton className="h-6 w-2/3 rounded" />
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-4 w-24 rounded" />
      </div>
      <Skeleton className="mx-4 h-14 rounded-lg" />
    </div>
  )
}
