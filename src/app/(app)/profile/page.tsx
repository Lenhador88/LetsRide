import { redirect } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Header } from '@/components/layout/Header'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { EditProfileForm } from '@/components/profile/EditProfileForm'
import { ProfileMenu } from '@/components/profile/ProfileMenu'
import { getCurrentProfile } from '@/lib/data/profile'
import { getFeed } from '@/lib/data/postcards'

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
 * **Four of the design's sections are not built, and none of them is a styling
 * task.** Badges (`7/42`), Countries (`22/195`), Motorcycles and Gear each need
 * their own table — the last is the Garage epic, which `bike_model` is a single
 * text column standing in for, not an implementation of. The 390×200 cover image
 * has no column either. All five are registered in
 * docs/FIGMA-FIDELITY-TODO.md §Profile.
 *
 * The cover is **omitted rather than drawn as an empty 200px slab**, which is
 * the same call the ride detail made for its banner and for the same reason: it
 * carries no affordance, so an empty fifth of the screen above the fold is worse
 * than a shorter page. The four sections are omitted rather than shown as empty
 * headers with `0/42` beside them, which would read as a rider who has earned
 * nothing rather than a feature that does not exist.
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

  const postcards = await getFeed({}, { kind: 'rider', id: profile.id })
  const name = profile.username ?? 'Rider'

  return (
    <>
      <Header title="Profile" action={<ProfileMenu />} />

      {/* No `pt-header` here: the shell's `<main>` already applies it, and this
          screen uses the plain 96px header rather than the ride detail's 120px
          variant, so it owes no top-up either. Re-deriving that padding per page
          is what globals.css warns about. */}
      <div className="flex flex-col gap-4 pb-4">
        <div className="flex flex-col items-center gap-2 px-6 pt-4">
          {/* The design's ring is White/100 and 4px — every other Avatar size
              carries the library's 2px Grey/20%, so this overrides rather than
              adding a one-screen constant to the component. */}
          <Avatar
            src={profile.avatar_url}
            name={name}
            size="2xl"
            className="border-4 border-surface"
          />
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
