'use client'

import { Suspense, useEffect } from 'react'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { useBanner } from '@/components/ui/Banner'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubJoinRequestsSection } from '@/components/clubs/ClubJoinRequestsSection'
import { ClubDeclinedRequestsSection } from '@/components/clubs/ClubDeclinedRequestsSection'
import { ManageRidersRoster } from '@/components/clubs/ManageRidersRoster'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub, getClubMembers } from '@/lib/data/clubs'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'

/**
 * `Manage riders` — `088`, PD-326. Reached from `ClubOptionsMenu` and from
 * nowhere else.
 *
 * Product owner, 2026-08-27: *"There is a 'Manage riders' section in the 3
 * dots, that allows admins to accept new riders, remove existing riders, or
 * promote riders to admins."* All three live here, in that order: the pending
 * requests first because they are the only thing on this screen that is a
 * to-do, then the roster, then the refusals an admin can lift.
 *
 * ## Why this is its own route rather than the Members screen with extra rows
 *
 * `/clubs/detail/members` is the read-only roster **every** member sees, and
 * most of its readers may do none of this. One screen serving both would have
 * to hide half of itself from most of its readers — and it would have to
 * decide that in the client, off `viewer_role`, which `ClubDetail`'s own
 * docstring calls a display hint rather than authorization.
 *
 * It also absorbs `085`'s `ClubJoinRequestsSection` from the club detail,
 * which that change's own `design.md` Q7 said PD-326 would do: it put the
 * minimum approval surface on the detail screen precisely so PD-326 would have
 * a section to move rather than a route to delete.
 *
 * ## The gate here is a screen, never a permission
 *
 * A rider who may not manage this club never sees it — but that is the
 * courtesy, not the enforcement. `088`'s three RPCs each re-check the caller's
 * authority in their own body, where `security definer` makes it load-bearing,
 * and each refuses with one indistinguishable `42501`. Defeating this branch
 * reaches a screen whose every control the database says no to.
 *
 * **A non-admin is REDIRECTED to the club, never `notFound()`, and that is not
 * softness — a 404 here would be a lie.** `notFound()` is this app's answer to
 * *"no such club, or not one you may see"*, deliberately conflated so a private
 * club's existence is not confirmed (`getClub`'s own note). That reasoning does
 * not reach this screen: getting here at all means `getClub` returned a club,
 * so the reader can already see it and there is nothing left to hide.
 *
 * The case that makes it matter is one `088` itself creates. An admin is told
 * *"Rider asked to join Club"*; before they open it they are demoted — by the
 * owner, or by themselves, which `088`'s permission table grants — and
 * `085`'s retraction does not fire, because the request is still pending and
 * nothing about it changed. The row is still readable and `NotificationsListItem`
 * now points it here. Sending that rider to a 404 on a club they can plainly
 * see would be the app disagreeing with itself; sending them to the club is the
 * truthful answer, and it covers every other stale entrance — a bookmark, a
 * second tab, a link an admin shared — for free.
 *
 * **The gate is `viewer_is_owner || viewer_role === 'admin'`, and the first
 * disjunct is not redundant** (PD-280, and `ClubJoinRequestsSection`'s own
 * header): ownership is a column on `clubs` and `viewer_role` is a
 * `club_members` row, and the two diverge for an owner holding no roster row —
 * a state `enforce-creator-membership` calls reachable on demand. Gating on
 * the role alone would lock exactly that owner out of their own club's
 * administration. `private.is_club_admin_for` has the matching owner arm,
 * which is what makes the screen and the RPCs agree.
 */
export default function ClubManageRidersPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubManageRidersScreen />
    </Suspense>
  )
}

function ClubManageRidersScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''
  const router = useRouter()
  const showBanner = useBanner()

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))
  // Enabled only once the club has come back, matching the Members screen:
  // `getClubMembers` raises on a malformed uuid, so eagerly issued it would
  // answer `/clubs/detail/manage?id=junk` with an error screen where this page
  // answers 404.
  const members = useQuery(club.data ? queryKeys.clubs.members(id) : null, () =>
    getClubMembers(id)
  )

  // **`null` is decided and `undefined` is "not yet"**, so this is three states
  // rather than two: no club, a club this rider may manage, and a club they may
  // not. The last is a redirect and not a 404 — see the header.
  const mayManage = club.data
    ? club.data.viewer_is_owner || club.data.viewer_role === 'admin'
    : undefined

  // In an effect, never during render: `router.replace` is a side effect, and
  // the prerender pass runs this body with no router history to write to.
  //
  // **The banner is what turns a bounce into an answer.** Without it the rider
  // lands on the club detail with nothing explaining why — and since `088`
  // moved the requests section OFF that screen, nothing there relates to what
  // they tapped either, so the notification is still in their list, still
  // pointing here, and the next tap does the same thing. `ClubOptionsMenu`'s
  // `Leave club` and `PostcardMenu` both pair `showBanner` with their own
  // `router.replace` for exactly this.
  //
  // **It states the RULE, never a change**, and the difference is the whole of
  // what the copy may claim. This screen knows *you may not manage this*; it
  // does not know *you used to*, and `mayManage === false` is reached by at
  // least two riders for whom nothing was taken away — a member following a
  // link an admin shared, and a rider who was just PROMOTED, whose cached
  // `clubs.detail(id)` entry predates the promotion and so answers false on the
  // first pass. "You no longer manage this club" would tell that second rider
  // they had lost management in the same minute they gained it. The bounce
  // still self-heals — the club detail revalidates the same key and a second
  // tap works — but the sentence must survive being wrong about the cause.
  useEffect(() => {
    if (mayManage !== false) return
    showBanner('Only a club’s owner and admins can manage its riders')
    router.replace(routes.club(id))
    // `showBanner` IS listed, with no suppression: `useBanner` returns a
    // `useCallback(…, [])` whose identity never changes for the provider's
    // lifetime, which `Banner.tsx`'s own header states and
    // `MarkNotificationsRead` already relies on. A blanket disable here would
    // also stop checking every dependency a later edit adds.
  }, [mayManage, router, id, showBanner])

  if (club.data === null) notFound()

  // Above both gates: back comes from the URL, so it stays usable while the
  // club is arriving and when it has failed.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="members" />

  const gate = combineQueries(club, members)

  return (
    <>
      {header}

      <div className="flex flex-col gap-6 pt-4">
        {gate.error ? (
          <ErrorState onRetry={gate.refetch} />
        ) : // `mayManage === false` draws the placeholder rather than the screen,
        // so the redirect above never flashes a roster at a rider who is about
        // to leave it — and never draws controls the RPCs would refuse.
        !club.data || !members.data || !mayManage ? (
          <SkeletonList rows={5} />
        ) : (
          <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
            {/* First, because it is the only thing here that is a to-do. Draws
                nothing at all when there is none — see its own header. */}
            <ClubJoinRequestsSection clubId={id} club={club.data} />
            <ManageRidersRoster clubId={id} club={club.data} members={members.data} />
            <ClubDeclinedRequestsSection clubId={id} club={club.data} />
          </div>
        )}
      </div>
    </>
  )
}
