'use client'

import { Suspense, useState, useSyncExternalStore } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { Globe2Icon, LocationOutlineIcon, Lock2Icon } from '@/components/icons/generated'
import { ClubCreateBar } from '@/components/clubs/ClubCreateBar'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubPreviewScreen } from '@/components/clubs/ClubPreviewScreen'
import { ClubMembershipButton } from '@/components/clubs/ClubMembershipButton'
import { ClubMemberRail } from '@/components/clubs/ClubMemberRail'
import { ClubTimeline } from '@/components/clubs/ClubTimeline'
import { IntroductionPrompt } from '@/components/clubs/IntroductionPrompt'
import { MarkClubSeen } from '@/components/clubs/MarkClubSeen'
import { RideChip } from '@/components/rides/RideChip'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { hasIntroducedClub, owesIntroduction } from '@/lib/data/club-introductions'
import { getClub, getClubPreview } from '@/lib/data/clubs'
import { getRides, withRideDistance } from '@/lib/data/rides'
import {
  dismissIntroductionPrompt,
  getServerIntroductionDismissed,
  isIntroductionDismissed,
  subscribeIntroductionDismissal,
} from '@/lib/clubs/introduction-dismissal'
import { useRiderPosition } from '@/lib/location/use-rider-position'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import { cn, formatRideDateLong } from '@/lib/utils'

/**
 * The club — **a timeline with a header on it**, as of 2026-08-31.
 *
 * The product owner: *"the current club details seems to become a bit
 * confusing… we should apply a timeline to the club details page. On the top we
 * could have 'sort of future', for example upcoming rides, then we could have a
 * narrow layer with add postcard, create ride, threads, etc. Then the timeline
 * starts, and then we show chronologically what's been going on."* Top to
 * bottom the screen is now: who the club is, what is coming, what you can do,
 * and what has happened.
 *
 * ## What this supersedes, and what it deleted
 *
 * The club detail merge of 2026-08-18 turned four sub-pages into one screen of
 * five stacked sections. That fixed the *navigation* and made the *screen* the
 * problem: five sections each with a heading, a `See all`, a `(+)` and its own
 * empty state, in an order that said nothing about time. This change keeps the
 * merge and re-cuts what it produced.
 *
 * - **`ClubPostcardCarousel` and `ClubThreadsSection` are deleted.** Both are
 *   entries on the timeline now. The product owner chose this over keeping
 *   either as a section, given the choice explicitly: the screen being long is
 *   the confusion, so a section that repeats what the timeline already says is
 *   the thing to remove.
 * - **`clubTimelineRides` is deleted with them.** PD-319 widened the ride strip
 *   to carry past rides *because there was no timeline to put them on*; there
 *   is one now, so the strip goes back to being what the design drew and the
 *   owner asked for — the future — and a ride the club has already ridden
 *   appears below, on the day it was announced.
 * - **The Members heading is deleted and the rail moves to the top**, with the
 *   club's own line and description, because the owner asked for exactly that:
 *   *"members and the small club description should go all the way to the
 *   top"*. **`/clubs/detail/members` keeps its entrance** — the `See all` at the
 *   foot of the rail's expanded panel — so this is not PD-125's defect; it
 *   costs one tap, and the panel it costs is the roster itself.
 * - **`ClubThreadsRow` is deleted and the description moved above the rail**
 *   (product owner, 2026-08-31: *"I would like to remove the section 'threads'
 *   under the members. And the club description goes above the members."*).
 *   The row was two days old and existed to close PD-125 on
 *   `/clubs/detail/threads`, so **its entrance had to go somewhere rather than
 *   nowhere**: it is a `Threads` row on `ClubOptionsMenu` now. The timeline's
 *   own foot link is NOT that entrance and cannot be — it renders only when the
 *   stream is cut, so a club whose whole timeline fits on screen would have
 *   none at all, which is the exact defect the row was written for.
 *
 *   What did not survive the move is the row's **aggregate** unread dot. The
 *   timeline's thread and reply entries still carry per-thread marks, so a
 *   conversation that moved today is marked where it happened; a thread that
 *   has sunk below the fold is not, and nothing on the screen now says
 *   *go look*. That is a real loss and it is the owner's to reverse — a dot on
 *   the ⋯ button is the cheap version.
 *
 * There is no v2 Figma frame for any of this. Composition is ours and is logged
 * in docs/FIGMA-FIDELITY-TODO.md §Club detail.
 *
 * ## The introduction prompt — `097`, PD-365
 *
 * `IntroductionPrompt` is mounted here rather than on `joinClub`'s success
 * path, so it reaches a rider however their membership came to exist — the
 * Join button, creating a club, onboarding's auto-join, an invite, a request
 * approval or a claimed invite link all land here, and `showIntroductionPrompt`
 * is state this screen already reads for itself (`design.md` §D7).
 *
 * ## `null` is the 404; `undefined` is "not yet"
 *
 * `getClub` returns null both for a club that does not exist and for one the
 * policy hides, deliberately indistinguishably — distinguishing them would
 * confirm a private club exists to someone who may not see it (decision #1).
 * Only that null is `notFound()`. `undefined` is the effect not having
 * answered, and calling `notFound()` on it would flash a 404 on every load of
 * every club.
 */
export default function ClubPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubScreen />
    </Suspense>
  )
}

function ClubScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))

  /**
   * The pre-join sheet's own opener — PD-392. Set by `ClubMembershipButton`
   * when it declines to write a membership, and cleared when the sheet closes.
   *
   * **Sticky across its own join, deliberately.** `showIntroductionPrompt`
   * below turns TRUE the instant `Post`'s membership write lands (`viewer_role`
   * becomes `member`, `hasIntroduced` is still `false`, nothing is dismissed) —
   * while the rider's words are on screen and the introduction is still in
   * flight. Both openers feed ONE `<IntroductionPrompt>` element with no `key`
   * on it, so that transition changes neither the mount nor the draft: it is an
   * `open` expression that stays true, not a second sheet. `design.md` §D3.
   */
  const [preJoinClubId, setPreJoinClubId] = useState<string | null>(null)

  // For the ride strip's `· 12 km` (PD-340). Up here with the other hooks
  // rather than beside the strip it feeds, because everything below the gates
  // is past a `notFound()` that throws during render. It reads on the key every
  // distance in the app shares and gates nothing: the strip renders whether or
  // not a position ever lands.
  const { position } = useRiderPosition()

  /**
   * **The reduced branch — `085`, PD-325.** A non-member of a private club can
   * find it in Explore, and `ClubCard` wraps its whole row in a stretched link,
   * so without this every one of those taps landed on a 404.
   *
   * **Enabled only once `getClub` has DECIDED it saw nothing.** `null` versus
   * `undefined` is load-bearing twice on this line: issued eagerly it would
   * cost every club detail in the app a second round trip, and the `notFound()`
   * below needs BOTH reads to be `null` rather than merely falsy or every load
   * would flash a 404 while the first was still out.
   *
   * **`getClub` is unchanged and still conflates "no such club" with "a club
   * the policy hides"** — decision #1's requirement. The PAGE distinguishes
   * them, using a second, deliberately narrow read.
   */
  const preview = useQuery(club.data === null ? queryKeys.clubs.preview(id) : null, () =>
    getClubPreview(id)
  )

  /**
   * The ride read waits for the club rather than running alongside it. It
   * throws on a malformed uuid — Postgres answers `22P02`, PostgREST turns it
   * into a 400 and `unwrapList` raises — so issued eagerly it would turn
   * `?id=not-a-uuid` into an error screen with a Try again button that can
   * never succeed. The parse lives in `getClub` (`clubIdSchema`, PD-142), which
   * answers `null` and so reaches the `notFound()` below.
   *
   * `ClubTimeline` gates its own four reads the same way, on `isMember` and on
   * this screen having resolved the club first.
   */
  const found = !!club.data

  // The same key and the same read as `/clubs/detail/rides`, sliced to the
  // strip rather than fetched short. Two different lengths under one key is the
  // failure that avoids: `rides.list('club:<id>')` would hold either the whole
  // list or this strip depending on which screen loaded first, and the other
  // would then draw the wrong number of rides with nothing on screen to say so.
  //
  // **Not the timeline's ride read.** That one is ordered by `created_at` under
  // its own key — see `getClubRideAnnouncements` for why the two cannot share.
  const rides = useQuery(found ? queryKeys.rides.list(filterSegment.club(id)) : null, () =>
    getRides({ kind: 'club', id })
  )

  /**
   * `owesIntroduction`'s first three conjuncts, evaluated eagerly so the
   * fourth read below is not issued for a rider who could never be prompted —
   * the owner, the default club, a non-member. This is a fetch-gating
   * heuristic rather than the rule itself: it is safe to be wider than the
   * real answer (an extra round trip costs nothing but itself), and it must
   * read `club.data` directly rather than waiting for `isMember` below, which
   * a hook cannot do — `club.data` is `undefined` before the club loads and
   * makes this `false` exactly as safely as waiting would.
   */
  const introductionEligible =
    !!club.data &&
    club.data.viewer_role !== null &&
    club.data.viewer_role !== 'owner' &&
    !club.data.is_default

  const hasIntroduced = useQuery(
    introductionEligible ? queryKeys.clubs.myIntroduction(id) : null,
    () => hasIntroducedClub(id)
  )

  /**
   * The per-(rider, club) dismissal — `lib/clubs/introduction-dismissal.ts`.
   * `useSyncExternalStore` rather than a mount effect calling `setState`,
   * which is the shape `react-hooks/set-state-in-effect` refuses — see that
   * module's own header for why this is `pending-token.ts`'s pattern reused
   * rather than a new one. `getServerIntroductionDismissed` answers `false`
   * for the SSR pass, where `sessionStorage` does not exist.
   */
  const dismissed = useSyncExternalStore(
    subscribeIntroductionDismissal,
    () => isIntroductionDismissed(id),
    getServerIntroductionDismissed
  )

  // The actual rule, `design.md` §D7's four conjuncts in full — evaluated
  // only once `hasIntroduced` has resolved, so the sheet cannot flash open
  // before the read confirms there is genuinely nothing to show it for.
  const showIntroductionPrompt =
    !!club.data &&
    hasIntroduced.data !== undefined &&
    owesIntroduction(
      { viewerRole: club.data.viewer_role, isDefaultClub: club.data.is_default },
      hasIntroduced.data
    ) &&
    !dismissed

  // Before the error gate: a club neither read can see is a 404 whatever else
  // happened, and the ride read cannot have failed yet because it was never
  // enabled.
  //
  // BOTH must be `null`, never merely falsy: `undefined` is "not yet" and
  // `preview` is `undefined` for the whole of every ordinary club's load.
  if (club.data === null && preview.data === null) notFound()

  // The reduced screen. It issues no query that could return zero rows, which
  // is the property that keeps "permission denied" and "empty" distinguishable
  // here — see `ClubPreviewScreen`. It draws no timeline and reaches nothing
  // this change added: `viewer_role` and `isMember` are untouched by this branch
  // and never computed in it.
  if (club.data === null && preview.data) return <ClubPreviewScreen club={preview.data} />

  // Above both gates, not inside the loaded branch: back and the menu come from
  // the URL and the club read respectively, so they work while the club is
  // still arriving and while it has failed. Only the name and the avatar wait.
  const header = <ClubDetailHeader clubId={id} club={club.data ?? undefined} current="detail" />

  const gate = combineQueries(club, rides)
  if (gate.error)
    return (
      <>
        {header}
        <div className="pt-4">
          <ErrorState onRetry={gate.refetch} />
        </div>
      </>
    )

  // Gated on the data rather than on `isLoading` — see `combineQueries`.
  if (!club.data || !rides.data)
    return (
      <>
        {header}
        <div className="pt-4">
          <SkeletonList rows={3} />
        </div>
      </>
    )

  // Upcoming only — the owner's *"sort of future"*. `withRideDistance` at the
  // render boundary rather than in `getRides`, the same call `/rides` and the
  // club's Rides sub-page make: the read is keyed on the club, and re-keying it
  // on the rider's position would refetch the strip when a fix lands.
  const upcoming = rides.data.upcoming.map((ride) => withRideDistance(ride, position))
  const hasAnyRides = rides.data.upcoming.length > 0 || rides.data.past.length > 0
  const isMember = !!club.data.viewer_role
  const TypeIcon = club.data.is_public ? Globe2Icon : Lock2Icon

  return (
    <>
      {header}
      {club.data.viewer_role && <MarkClubSeen clubId={club.data.id} />}

      <div
        className={cn(
          'flex flex-col gap-4 pt-4 motion-safe:animate-fade-in',
          // The create bar is fixed, so the column has to make room or the last
          // timeline entry sits behind it. `--navbar-action` is exactly this
          // bar's geometry — 16 pad + 40 button + 8 — because it is the same
          // control the nav bar's own action slot draws, just owned by this
          // screen so it can be member-gated. Only when the bar renders.
          isMember && 'pb-navbar-action-extra'
        )}
      >
        {/* The future. Past rides are on the timeline now, on the day they were
            announced — see this file's docstring on `clubTimelineRides`.

            `See all` is still gated on what the SUB-PAGE has rather than on
            what this strip draws, and the two can now legitimately disagree: a
            club whose rides are all behind it has an empty strip over a
            sub-page full of past rides, and dropping the link there would be
            PD-125's defect exactly — a screen nobody can reach. */}
        <section className="flex flex-col gap-2">
          {/* No `create` prop any more — the product owner dropped the `(+)`
              (2026-08-31: *"the ADD button can be dropped"*). Every create on
              this screen is in the bar above the tabs now, so a second entrance
              to one of them in a section heading is exactly the duplication
              that bar exists to remove. */}
          <SectionHeader
            title="Upcoming rides"
            action={hasAnyRides ? { label: 'See all', href: routes.clubRides(id) } : undefined}
            className="px-4 py-0"
          />
          {upcoming.length === 0 ? (
            <p className="px-4 text-sm font-medium text-muted">
                {/* Two different facts, and conflating them is a lie in one
                    direction: a club with ten past rides and nothing planned
                    HAS ridden. PD-319 could not tell them apart because its
                    strip carried both halves; this one carries the future
                    alone, so the empty state has to say which emptiness it
                    means. */}
              {hasAnyRides ? 'No rides are planned, yet!' : 'This club has not ridden, yet!'}
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {upcoming.map((ride) => (
                <RideChip key={ride.id} ride={ride} />
              ))}
            </div>
          )}
        </section>

        {/* Who the club is — under the rides rather than above them, which is
            the owner's second call on this order (2026-08-31: *"I think
            upcoming rides should go again to the top"*). The identity is what a
            rider reads once; the next ride is what they came back for.

            Its own 12px internal rhythm rather than the section-sized 16px the
            surrounding `gap-4` gives: these four read as one block — what the
            club is, who is in it, what it is talking about, what it says about
            itself — and the wider gap made them look like unrelated sections,
            which is the complaint this whole screen is answering. */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-1.5 px-4 text-sm font-medium text-muted">
              <TypeIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {club.data.is_public ? 'Public club' : 'Private club'} · Started{' '}
              {/* `null` is the zone: a club's founding date is not a ride's
                  departure, so there is no meeting point whose clock it should
                  follow — it renders in `APP_TIME_ZONE` like every non-ride
                  stamp (`080`, PD-193). */}
              {formatRideDateLong(club.data.created_at, null)}
            </p>

            {/* Its own line rather than a third clause above: that line is two
                facts about the club's shape, and where it rides is a different
                kind of fact — and the one most likely to be long.

                Rendered only when set (PD-259). Absent for every club made
                before `066`, and there is deliberately no "no location yet"
                placeholder beside the description's: a missing optional field is
                not news, and the screen already carries one empty-state
                sentence. */}
            {club.data.location_name && (
              <p className="flex items-center gap-1.5 px-4 text-sm font-medium text-muted">
                <LocationOutlineIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{club.data.location_name}</span>
              </p>
            )}
          </div>

          {/* Above the rail as of 2026-08-31, at the product owner's ask:
              *"the club description goes above the members"*. It is the
              club's answer to the question a rider arriving here has first —
              what is this — and the roster answers a later one. The empty
              sentence moves with it rather than being dropped: a club with no
              description is a club that has not said what it is, which is
              news, unlike the missing location above. */}
          {club.data.description ? (
            <ExpandableText className="px-4">{club.data.description}</ExpandableText>
          ) : (
            <p className="px-4 text-sm font-medium text-muted">
              This club has not written a description, yet!
            </p>
          )}

          {/* No `Members` heading over it any more — see this file's docstring
              for why that is not PD-125's defect. The rail is identity here
              rather than a section: it says how many riders and who, and it
              opens the roster in place. */}
          <ClubMemberRail clubId={id} />
        </div>

        {/* Join is the non-member's one action and stays on the page. A member
            gets no button here at all — every create moved to `ClubCreateBar`,
            which is fixed above the tabs rather than in the scroll. An owner is
            always a member and never sees this either way. */}
        {!isMember && (
          <div className="px-4">
            {/* `is_default` is READ, never assumed from this screen's position
                in the flow — PD-384's defect, and the reason the prop is
                required. The welcome club is exempt from introductions, so
                without it a sheet-only membership would make the one club every
                rider is supposed to be in unjoinable. */}
            <ClubMembershipButton
              clubId={id}
              isDefaultClub={club.data.is_default}
              onIntroduce={setPreJoinClubId}
            />
          </div>
        )}

        <ClubTimeline club={club.data} isMember={isMember} />
      </div>

      {/* Outside the scrolling column: it is fixed above the navigation bar.
          Member-only, because all three of its destinations refuse a
          non-member — see `ClubCreateBar`. */}
      {isMember && <ClubCreateBar clubId={id} />}

      {/* `097`, PD-365 — and PD-392's second opener.

          **One sheet, two openers.** The member-mode rule is unchanged and
          keeps every conjunct: driven by `showIntroductionPrompt`, never by
          `joinClub`'s success path, so it reaches a rider however their
          membership came to exist — an approved request, an invite link,
          onboarding's auto-join, creating the club. The pre-join opener is
          `ClubMembershipButton`'s and reaches nobody else.

          **No `key`, deliberately**, so the moment `Post`'s join makes
          `showIntroductionPrompt` true underneath an open pre-join sheet, this
          is the same element with the same draft rather than a remount.

          `onDismiss` records the session dismissal **if and only if a
          membership exists** — PD-392. It was unconditional, and
          `ContextMenu`'s scrim and Escape both close through here, so a
          `Join later`, a scrim tap or an Escape all reached one unconditional
          write. A rider who declined the join on this club's own screen and was
          then admitted by another door in the same session would never be asked
          to introduce themselves. The sheet is what knows whether a membership
          exists, so it tells us.

          `onPosted` still records unconditionally, and that IS the iff: a
          successful `Post` means a membership exists. `hasIntroduced`'s own
          invalidated read will confirm the same answer, but recording it here
          closes the sheet on the same tick rather than waiting on that round
          trip. */}
      <IntroductionPrompt
        // `key={id}` makes "a sheet instance is one club" TRUE rather than
        // merely believed. `ClubScreen` reads its id from `useSearchParams()`,
        // so `?id=A` → `?id=B` is a same-route navigation: it re-renders
        // without remounting, and a keyless sheet would carry `joined`, the
        // draft and the error across. No such link exists today — every route
        // to another club leaves this one — but the per-instance latch is
        // asserted in prose as a safety property, and the failure it would
        // cause is club B opening in member mode and becoming unjoinable
        // (`097` refuses `introduceToClub` for a non-member). One line, so the
        // guarantee does not depend on no one ever adding that link.
        //
        // It does NOT remount on the transition the no-key argument was about:
        // `showIntroductionPrompt` flipping true under an open pre-join sheet
        // does not change `id`.
        key={id}
        clubId={id}
        mode={preJoinClubId === id ? 'pre-join' : 'member'}
        open={showIntroductionPrompt || preJoinClubId === id}
        onDismiss={(membershipExists) => {
          if (membershipExists) dismissIntroductionPrompt(id)
          setPreJoinClubId(null)
        }}
        onPosted={() => {
          dismissIntroductionPrompt(id)
          setPreJoinClubId(null)
        }}
      />
    </>
  )
}
