'use client'

import { Suspense } from 'react'
import { notFound, redirect, useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonDetail, SkeletonList } from '@/components/ui/Skeleton'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { CountryFlags } from '@/components/profile/CountryFlags'
import { ProfileDetailMenu } from '@/components/profile/ProfileDetailMenu'
import { getFeed } from '@/lib/data/postcards'
import { getCurrentProfile, getProfile, getProfileCountries } from '@/lib/data/profile'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'
import type { ViewedProfile } from '@/types'
import { useSwipeBack } from '@/lib/actions/navigate'

/**
 * Another rider's profile — `Profile / View someone else's profile / Profile
 * - Prescoll header` (`2084:9006`), reached today from a postcard byline
 * (`PostcardCard`) and reachable at `/profile/detail?id=<uuid>`.
 * `openspec/changes/view-rider-profile/` is the proposal this was built
 * against; read its spec before changing this file.
 *
 * **Three things the design frame draws and this deliberately does not
 * render: Follow, the followers count, and the motorcycles count/Timeline
 * switcher.** `013` dropped `friendships` on 2026-08-04 — there is no
 * follower graph in this app, and drawing one back in from a design frame is
 * exactly the failure mode CLAUDE.md names. The motorcycles count is the
 * unbuilt Garage epic; `bike_model` stands in for it as one fact, not this
 * section. Neither is a stats row nor a stub — the spec's own requirement is
 * that an absent feature render as absent, not as a drawn zero.
 *
 * **The header composition is the shipped own-profile screen's, not the
 * isolated frame's.** The frame floats back/options over the 200px banner;
 * `/profile` already deviates from that and uses the app's standard fixed
 * `Header` bar plus a banner that scrolls with the content, and this screen
 * matches that shipped precedent rather than inventing a second header shape
 * nothing else in the app uses. Countries render the same way: a read-only
 * "Countries" section in the position `/profile` already draws one, rather
 * than the frame's single flag beside the name — `profile_countries` is a
 * list, and the shipped own-profile treatment is what task 3.4/design.md Q1
 * call "the own-profile screen's treatment" transferring cleanly.
 */
export default function ProfileDetailPage() {
  // The id is a query parameter, not a segment (PD-142), so `useSearchParams()`
  // needs its own Suspense boundary or the whole route opts out of
  // prerendering, which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ProfileDetailScreen />
    </Suspense>
  )
}

function ProfileDetailScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''
  const online = useOnlineStatus()

  const me = useQuery(queryKeys.profile.me(), getCurrentProfile)
  const isSelf = !!me.data && me.data.id === id

  // Disabled until the session id is known, and disabled again if it is a
  // self-view — the subject's own read must never be issued for it (design.md
  // §D3), so the rider's own row is never fetched through this shape at all.
  // A cold cache costs one extra round trip on `me` before this fires; a warm
  // one (most navigations, since `profile.me()` is shared with `/profile` and
  // `/notifications`) costs nothing.
  const profile = useQuery(me.data !== undefined && !isSelf ? queryKeys.profile.detail(id) : null, () =>
    getProfile(id)
  )

  // The route guard has already refused an anonymous request to this path;
  // `me.data === null` is the one case it leaves open — the caller's own
  // profile row failed to create — and `/profile` bounces the same way for
  // the same reason: there is no recovery here besides authenticating again.
  if (me.data === null) redirect('/auth/login')

  // Self-view redirects rather than rendering a second owner screen: two
  // screens drawing the same rider would diverge, and this header carries a
  // block affordance that is nonsensical aimed at yourself.
  if (isSelf) redirect('/profile')

  // `null` is decided — every audience case the spec names collapses to it —
  // `undefined` is "not yet", which the gate below holds open.
  if (profile.data === null) notFound()

  // Back and (once the subject resolves) the block control both come from
  // data that either has no dependency on the read or degrades gracefully
  // while it is in flight, so the header renders on every pass below —
  // loading, erroring or loaded — matching the spec's *partial* requirement.
  // PD-341, to the same place the arrow goes.
  useSwipeBack('/postcards')

  const header = (
    <Header
      title={profile.data?.username}
      backHref="/postcards"
      action={
        profile.data ? (
          <ProfileDetailMenu subjectId={profile.data.id} subjectName={profile.data.username} />
        ) : undefined
      }
    />
  )

  const gate = combineQueries(me, profile)
  if (gate.error)
    return (
      <>
        {header}
        <ErrorState
          message={online ? undefined : "You're offline — try again once you're back."}
          onRetry={gate.refetch}
        />
      </>
    )

  // Gated on the data, never on `isLoading` — see `combineQueries`.
  if (!profile.data)
    return (
      <>
        {header}
        <SkeletonDetail />
      </>
    )

  return (
    <>
      {header}
      <ProfileDetailBody profile={profile.data} />
    </>
  )
}

function ProfileDetailBody({ profile }: { profile: ViewedProfile }) {
  const countries = useQuery(queryKeys.profile.countries(profile.id), () =>
    getProfileCountries(profile.id)
  )

  return (
    <div className="flex flex-col gap-4 pb-4 motion-safe:animate-fade-in">
      {/* The 390×200 banner. Read-only here — there is no upload affordance on
          another rider's cover — so an absent one draws the fallback treatment
          rather than the own-profile screen's tappable "Add a cover photo",
          which would invite an edit this viewer cannot make. */}
      {profile.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.cover_image_url} alt="" className="h-50 w-full object-cover" />
      ) : (
        <div className="h-50 w-full bg-track" />
      )}

      <div className="flex flex-col items-center gap-2 px-6">
        <Avatar
          src={profile.avatar_url}
          name={profile.username}
          size="2xl"
          className="border-4 border-surface"
        />
        {profile.location && (
          <p className="text-sm font-medium text-muted">{profile.location}</p>
        )}
        <h2 className="text-2xl font-semibold text-foreground">{profile.username}</h2>
      </div>

      {profile.bio && <ExpandableText className="px-6">{profile.bio}</ExpandableText>}

      {/* Rendered only once the countries read has actual rows — silence
          rather than a heading over an empty grid, matching the spec's *no
          empty section headings* rule. A failed or still-loading read reads
          the same as "none marked": this is decorative context on a screen
          whose real content is the header and the timeline, not worth its
          own error state. */}
      {countries.data && countries.data.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeader title="Countries" />
          <CountryFlags codes={countries.data} />
        </section>
      )}

      <RiderTimeline riderId={profile.id} />
    </div>
  )
}

/**
 * The subject's postcards, filtered by the *viewer's* own audience — the
 * `postcards` SELECT policy decides every row, never a client-side filter
 * (spec's *timeline* requirement). Its own `useQuery` rather than one held by
 * the parent, so a failure here is confined to this section: the header and
 * the rest of the body above stay rendered (spec's *Partial* scenario).
 */
function RiderTimeline({ riderId }: { riderId: string }) {
  const online = useOnlineStatus()
  const postcards = useQuery(queryKeys.postcards.feed(filterSegment.rider(riderId)), () =>
    getFeed({}, { kind: 'rider', id: riderId })
  )

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Postcards" />
      {postcards.error ? (
        <ErrorState
          message={online ? undefined : "You're offline — try again once you're back."}
          onRetry={postcards.refetch}
        />
      ) : !postcards.data ? (
        <SkeletonList rows={3} />
      ) : postcards.data.length === 0 ? (
        // Deliberately not "hasn't posted anything" — the zero is this
        // viewer's own audience, not a fact about the rider (spec's *no
        // postcards visible to this viewer* scenario).
        <p className="px-6 text-sm text-muted">
          Nothing to show here — they may not have posted, or you may not share an
          audience with the postcards they have.
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-4">
          {postcards.data.map((postcard) => (
            <PostcardCard key={postcard.id} postcard={postcard} />
          ))}
        </div>
      )}
    </section>
  )
}
