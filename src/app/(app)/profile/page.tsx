'use client'

import { redirect } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { Header } from '@/components/layout/Header'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { EditProfileForm } from '@/components/profile/EditProfileForm'
import { ProfileCountries } from '@/components/profile/ProfileCountries'
import { ProfileImageUpload } from '@/components/profile/ProfileImageUpload'
import { ProfileMenu } from '@/components/profile/ProfileMenu'
import { getCurrentProfile, getProfileCountries } from '@/lib/data/profile'
import { getFeed } from '@/lib/data/postcards'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import type { Profile } from '@/types'

/**
 * `Profile / View your profile / Profile` (`1883:12248`) — the rider's own
 * profile, rebuilt from the snapshot. Replaces the v1 screen — the old zinc
 * and orange palette, the v1 icon library, and a client component that wrote to
 * Supabase directly with no validation. It is a client component again after the
 * render migration, which is not a return to that: every write still goes
 * through `lib/actions/`, and every read through `lib/data/`.
 *
 * Composition is measured: 128×128 avatar over a `White/100` ring, location at
 * Poppins/14/Medium, the name at Poppins/24/Semibold (`text-2xl`), and the bio
 * clamped to three 20px lines with `Show more`. The name is the **username** —
 * decision #7, and the reason the design's "Pedro Abreu" is not a `full_name`
 * this schema still has.
 *
 * **The cover, the avatar and Countries landed with `014` on 2026-08-05.** Two
 * of the design's sections are still not built and neither is a styling task:
 * Badges (`7/42`) needs a rules engine deciding what earns one, and Motorcycles
 * and Gear are the Garage epic — `bike_model` is a single text column standing
 * in for it, not an implementation. Both are registered in
 * docs/FIGMA-FIDELITY-TODO.md §Profile.
 *
 * They are omitted rather than shown as empty headers reading `0/42`, which
 * would state a fact about the rider where the truth is a fact about the app.
 *
 * What *is* below the profile is the design's own lower half: the rider's
 * postcard timeline (`Profile - Timeline`, `2083:5413`). That needed no new
 * data function — `getFeed` has taken a `rider` filter since the home screen
 * shipped.
 *
 * ## The split, and why three of the four reads are one component down
 *
 * Everything except the profile itself is keyed by the rider's own id, so none
 * of them can be issued until the profile has arrived. Expressed as a second
 * component taking `profile` as a prop rather than as three conditional keys:
 * `useQuery(id ? key(id) : null, () => read(id!))` needs a non-null assertion at
 * every site to say something the null key already guarantees.
 *
 * The header stays out here so a rider can reach `Sign out` while the screen is
 * still loading — the server version rendered nothing at all until every read
 * had answered, which is the one behaviour deliberately not preserved.
 */
export default function ProfilePage() {
  const profile = useQuery(queryKeys.profile.me(), getCurrentProfile)

  // `getCurrentProfile` returns null for "no session" and for "no row", and
  // `undefined` for "the effect has not answered yet" — a distinction the
  // awaited version had no state for. Only the decided answer redirects; gating
  // this on a falsy check would bounce every rider to login on the first tick.
  //
  // The route guard has already refused anonymous requests to this path, so in
  // practice this is the second case — a profile row that failed to create —
  // and sending them back through auth is the only recovery the app has. It is
  // not left to the guard, because relying on a *routing* decision to make a
  // data case unreachable is how a silent null-render ships.
  if (profile.data === null) redirect('/auth/login')

  return (
    <>
      <Header
        title="Profile"
        secondaryAction={<NotificationsHeaderControl />}
        action={<ProfileMenu />}
      />

      {profile.error ? (
        <ErrorState onRetry={profile.refetch} />
      ) : !profile.data ? (
        <SkeletonDetail />
      ) : (
        <ProfileScreen profile={profile.data} />
      )}
    </>
  )
}

function ProfileScreen({ profile }: { profile: Profile }) {
  // The same key `/postcards?rider=<id>` uses — `keys.ts` types the feed key's
  // filter segment as `string | null` and the home screen serialises it as
  // `kind:id`, so the two screens share one cache entry for what is literally
  // the same query rather than each fetching this rider's timeline separately.
  const postcards = useQuery(queryKeys.postcards.feed(filterSegment.rider(profile.id)), () =>
    getFeed({}, { kind: 'rider', id: profile.id })
  )
  const countries = useQuery(queryKeys.profile.countries(profile.id), () =>
    getProfileCountries(profile.id)
  )

  const gate = combineQueries(postcards, countries)
  if (gate.error) return <ErrorState onRetry={gate.refetch} />

  // Gated on the data, not on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is still nothing to draw.
  //
  // Both together, which is what the original `Promise.all` did.
  // `ProfileCountries` seeds `useState` from its prop, so mounting it before its
  // codes land freezes an empty list into place.
  //
  // The cover is not a third read any more: `getCurrentProfile` signs it, so it
  // arrives with the row and its empty state — the *claim* "no cover photo" —
  // is never drawn for a rider who has one.
  if (!postcards.data || !countries.data) return <SkeletonDetail />

  const name = profile.username ?? 'Rider'

  return (
    // No `pt-header` here: the shell's `<main>` already applies it, and this
    // screen uses the plain 96px header rather than the ride detail's 120px
    // variant, so it owes no top-up either. Re-deriving that padding per page
    // is what globals.css warns about.
    <div className="flex flex-col gap-4 pb-4">
      {/* The 390x200 cover. Drawn now that there is a column behind it AND an
          affordance on it — the ride detail's banner is still omitted because
          it has neither. An empty state is a real state here rather than dead
          space: tapping it is how a rider adds one. */}
      <ProfileImageUpload kind="cover" label="Change cover photo" className="h-50">
        {profile.cover_image_url ? (
          /* Plain <img>, like Avatar: next/image needs a configured loader
             for signed Supabase URLs, and that is its own decision rather
             than one to make inside a profile screen. Carries the same lint
             warning Avatar has carried since it shipped. */
          <img src={profile.cover_image_url} alt="" className="h-50 w-full object-cover" />
        ) : (
          <div className="flex h-50 w-full items-center justify-center bg-track text-sm text-muted">
            Add a cover photo
          </div>
        )}
      </ProfileImageUpload>

      <div className="flex flex-col items-center gap-2 px-6">
        {/* The design's ring is White/100 and 4px — every other Avatar size
            carries the library's 2px Grey/20%, so this overrides rather than
            adding a one-screen constant to the component. */}
        <ProfileImageUpload kind="avatar" label="Change profile photo" className="rounded-full">
          <Avatar
            src={profile.avatar_url}
            name={name}
            size="2xl"
            className="border-4 border-surface"
          />
        </ProfileImageUpload>
        {profile.location && (
          <p className="text-sm font-medium text-muted">{profile.location}</p>
        )}
        <h2 className="text-2xl font-semibold text-foreground">{name}</h2>
      </div>

      {profile.bio && <ExpandableText className="px-6">{profile.bio}</ExpandableText>}

      {/* Headed "Motorcycles", which is the design's own word for this
          section — NOT "Rides", which is this app's noun for a planned trip
          and the label on a bottom tab one tap away. A motorcycle under a
          heading called Rides is a genuine misread, not a synonym.

          `bike_model` is the whole of the Garage the schema can back: the
          design's Motorcycles section lists bikes with years, mileage and
          their own like/comment counts. Rendered as the one fact it is rather
          than dressed up as that section. */}
      {profile.bike_model && (
        <div className="flex flex-col gap-1 px-6">
          <h3 className="text-sm font-semibold text-foreground">Motorcycles</h3>
          <p className="text-sm text-muted">{profile.bike_model}</p>
        </div>
      )}

      <ProfileCountries codes={countries.data} />

      <EditProfileForm profile={profile} />

      <section className="flex flex-col gap-2">
        {/* No `meta` count. `postcards.length` is the length of a page
            bounded at FEED_PAGE_SIZE, so a rider with 45 postcards would read
            "30" as a total. The design draws no count on this list at all, so
            the honest options were an accurate total (a second aggregate
            query) or nothing — and nothing is what was drawn. */}
        <SectionHeader title="Postcards" />
        {postcards.data.length === 0 ? (
          <p className="px-6 text-sm text-muted">
            Nothing posted yet. Your postcards will show up here.
          </p>
        ) : (
          <div className="flex flex-col gap-4 px-4">
            {postcards.data.map((postcard) => (
              <PostcardCard key={postcard.id} postcard={postcard} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
