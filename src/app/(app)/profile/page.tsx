import { redirect } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Header } from '@/components/layout/Header'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { EditProfileForm } from '@/components/profile/EditProfileForm'
import { ProfileCountries } from '@/components/profile/ProfileCountries'
import { ProfileImageUpload } from '@/components/profile/ProfileImageUpload'
import { ProfileMenu } from '@/components/profile/ProfileMenu'
import { getCurrentProfile, getProfileCountries } from '@/lib/data/profile'
import { getFeed } from '@/lib/data/postcards'
import { signImagePaths } from '@/lib/data/media'

/**
 * `Profile / View your profile / Profile` (`1883:12248`) — the rider's own
 * profile, rebuilt from the snapshot. Replaces the v1 screen — the old zinc
 * and orange palette, the v1 icon library, and a client component writing to
 * Supabase directly.
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
 */
export default async function ProfilePage() {
  const profile = await getCurrentProfile()

  // `getCurrentProfile` returns null for "no session" and for "no row". The
  // proxy has already refused anonymous requests to this path, so in practice
  // this is the second case — a profile row that failed to create — and sending
  // them back through auth is the only recovery the app has.
  if (!profile) redirect('/auth/login')

  const [postcards, countries, coverUrls] = await Promise.all([
    getFeed({}, { kind: 'rider', id: profile.id }),
    getProfileCountries(profile.id),
    // The cover is signed here rather than in `getCurrentProfile`, because it is
    // the only screen that draws one — see the note on `cover_image_path`'s
    // absence from PUBLIC_PROFILE_COLUMNS. The avatar is already resolved.
    signImagePaths(profile.cover_image_path ? [profile.cover_image_path] : []),
  ])

  const name = profile.username ?? 'Rider'
  const coverUrl = profile.cover_image_path ? coverUrls.get(profile.cover_image_path) : null

  return (
    <>
      <Header title="Profile" action={<ProfileMenu />} />

      {/* No `pt-header` here: the shell's `<main>` already applies it, and this
          screen uses the plain 96px header rather than the ride detail's 120px
          variant, so it owes no top-up either. Re-deriving that padding per page
          is what globals.css warns about. */}
      <div className="flex flex-col gap-4 pb-4">
        {/* The 390x200 cover. Drawn now that there is a column behind it AND an
            affordance on it — the ride detail's banner is still omitted because
            it has neither. An empty state is a real state here rather than dead
            space: tapping it is how a rider adds one. */}
        <ProfileImageUpload kind="cover" label="Change cover photo" className="h-50">
          {coverUrl ? (
            /* Plain <img>, like Avatar: next/image needs a configured loader
               for signed Supabase URLs, and that is its own decision rather
               than one to make inside a profile screen. Carries the same lint
               warning Avatar has carried since it shipped. */
            <img src={coverUrl} alt="" className="h-50 w-full object-cover" />
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

        <ProfileCountries codes={countries} />

        <EditProfileForm profile={profile} />

        <section className="flex flex-col gap-2">
          {/* No `meta` count. `postcards.length` is the length of a page
              bounded at FEED_PAGE_SIZE, so a rider with 45 postcards would read
              "30" as a total. The design draws no count on this list at all, so
              the honest options were an accurate total (a second aggregate
              query) or nothing — and nothing is what was drawn. */}
          <SectionHeader title="Postcards" />
          {postcards.length === 0 ? (
            <p className="px-6 text-sm text-muted">
              Nothing posted yet. Your postcards will show up here.
            </p>
          ) : (
            <div className="flex flex-col gap-4 px-4">
              {postcards.map((postcard) => (
                <PostcardCard key={postcard.id} postcard={postcard} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
