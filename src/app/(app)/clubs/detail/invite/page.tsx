'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubInviteLinkSection } from '@/components/clubs/ClubInviteLinkSection'
import { ClubInviteList } from '@/components/clubs/ClubInviteList'
import { ClubInvitePicker } from '@/components/clubs/ClubInvitePicker'
import { ErrorState } from '@/components/ui/ErrorState'
import { getClub } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'

/**
 * `Invite riders` / `Invite a rider` — the picker `ClubShareOrInviteItem`
 * opens, `093`, PD-360, `/rides/detail/invite`'s exact shape one domain over.
 *
 * ## Reachable by two different viewers, and the screen draws for both
 *
 * `private.may_invite_to_club_for` admits an admin or owner of a private
 * club, or any MEMBER of a public one (decision 3) — so unlike
 * `RideInvitePage`, which is organizer-only, this screen has two legitimate
 * audiences and draws a different shape for each: the link section is
 * PRIVATE-club-only (decision 1 — a public club's plain URL already carries
 * every grant a token could), while the picker and the outgoing list are
 * common to both.
 *
 * ## Absent rather than disabled for everyone else
 *
 * `093`'s INSERT policy on `club_invites` and `may_mint_club_link` are the
 * enforcement — a rider outside either admitted set is refused by the
 * database whatever this screen draws. What this screen owes is not to
 * *offer* what will be refused: a rider who may not invite sees the
 * not-found every unreachable club screen shows, matching
 * `RideInvitePage`'s own reasoning. `notFound()` costs nothing here either:
 * they can already see the club if they got a menu row to reach this from,
 * so this is saying the screen is not one of theirs rather than hiding the
 * club's existence.
 */
export default function ClubInvitePage() {
  // The id is a query parameter, not a segment — see `src/lib/routes.ts` for
  // why every detail route is built this way, and why `useSearchParams()`
  // needs the `<Suspense>` boundary below.
  return (
    <Suspense fallback={null}>
      <ClubInviteScreen />
    </Suspense>
  )
}

function ClubInviteScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''
  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))

  // `null` is decided — no such club, or one this rider may not read at all.
  // `undefined` is the effect not having answered, and 404ing on it would
  // flash one on every load.
  if (club.data === null) notFound()

  // Decided, and separately: the club resolved and this rider may not invite
  // into it — `private.may_invite_to_club_for`'s exact admitted set (an
  // admin or owner, or any member of a PUBLIC club), checked here as a
  // display hint only; the INSERT policy and `may_mint_club_link` are the
  // enforcement.
  if (
    club.data &&
    !club.data.viewer_is_owner &&
    club.data.viewer_role !== 'admin' &&
    !(club.data.is_public && club.data.viewer_role !== null)
  ) {
    notFound()
  }

  return (
    <>
      <ClubDetailHeader clubId={id} club={club.data ?? undefined} current="invite" />

      <div className="flex flex-col gap-6 pt-4 pb-4">
        {club.error ? (
          <ErrorState onRetry={club.refetch} />
        ) : (
          // Every child reads its own data and owns its own three states, so
          // each renders as soon as the club has resolved rather than waiting
          // on the others. The club read above is the authorization probe and
          // nothing else on this screen depends on its contents beyond
          // `is_public`.
          club.data && (
            <>
              <ClubInvitePicker clubId={id} />
              <ClubInviteList clubId={id} />
              {/* Decision 1: a PUBLIC club gets no tokened link at all — the
                  plain `routes.club(id)` URL already carries every grant a
                  token could, so a link section here would be a capability
                  surface with no capability behind it. */}
              {!club.data.is_public && (
                <ClubInviteLinkSection clubId={id} clubName={club.data.name} />
              )}
            </>
          )
        )}
      </div>
    </>
  )
}
