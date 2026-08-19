'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Globe2Icon, Lock2Icon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { JoinClubButton } from '@/components/clubs/JoinClubButton'
import { routes } from '@/lib/routes'
import type { ClubListItem } from '@/types'

/**
 * `v2 / Component / List / Club`, measured from the committed snapshot.
 *
 * Three variants, the product of `is Private Club` and `is Joined` — and only
 * three, because `Private + not Joined` is not drawn. That absence is the design
 * agreeing with RLS rather than an oversight: a private club you have not joined
 * is invisible, so the state cannot occur.
 *
 * Geometry, read rather than chosen: card 358×112 radius 8 on White/100, right
 * padding 16 (`p-1 pr-4`, the same shape as `List / Ride`); the media block is
 * 96×104 with an 80-wide image at radius 4 and a 72×72 avatar at radius 12
 * overlapping its right edge; the content column starts at x108 with the name at
 * y12, the type row at y36 and the riders at y70; avatars are 28 overlapping by
 * 4, then a 4 gap to the `+N`.
 *
 * **The image and the avatar are real** as of `016`, which added
 * `clubs.avatar_path` and `cover_image_path` alongside the Create club upload
 * that fills them — deliberately in one change, because columns without an
 * upload screen would have drawn this same empty container while planting the
 * dead column `014` had to remove from `profiles`.
 *
 * Both fall back to the design's container plus the club's initials when the
 * path is null or will not sign, and **null is a correct outcome, not only an
 * empty one**: `016`'s storage SELECT policy refuses a private club's cover to a
 * viewer who cannot see the club. Do not "fix" the fallback by dropping the
 * null check.
 *
 * **The whole row navigates, but `Join club` is a control inside it**, which is
 * why the link is a stretched overlay rather than a wrapper. `<a>` may not
 * contain a `<button>` — it is invalid HTML, and a real one nested there fires
 * the navigation as well as the join. The overlay is positioned, so it paints
 * above the static content and takes the taps; the action lifts back over it
 * with `relative z-10`.
 */
export function ClubCard({ club, joined }: { club: ClubListItem; joined: boolean }) {
  const overflow = club.members_count - club.riders.length
  const TypeIcon = club.is_public ? Globe2Icon : Lock2Icon
  // task 7.4 — see `Avatar`'s own comment for the shape of this, including
  // why this is keyed on the URL itself rather than a plain boolean: a
  // revalidated card can arrive with a fresh, valid `cover_image_url`, and a
  // flag that never reset would keep hiding it. An ownership transfer (D2)
  // nulls `cover_image_path` and deletes the object in the same step, so a
  // cached card can hold a signed URL that answers 404 for the rest of its
  // hour; this is the one raw `<img>` on this card — `Avatar` below already
  // covers the rider and club avatars.
  const [brokenCover, setBrokenCover] = useState<string | null>(null)
  const showCover = !!club.cover_image_url && club.cover_image_url !== brokenCover

  return (
    <div className="relative flex gap-3 rounded-lg bg-surface p-1 pr-4 transition-colors focus-within:bg-background active:bg-background">
      <Link href={routes.club(club.id)} className="absolute inset-0 rounded-lg">
        <span className="sr-only">{club.name}</span>
      </Link>

      <div className="relative h-26 w-24 shrink-0">
        {/* The design's 80×104 image container. Empty it carries no icon: the
            avatar overlaps it from x24, so anything centred in it renders
            underneath and cannot be seen — which is worse than an empty
            container, because it looks finished in the diff. `List / Ride`
            keeps its location pin only because nothing covers it. */}
        <div className="absolute inset-y-0 left-0 w-20 overflow-hidden rounded bg-border">
          {showCover && (
            <img
              src={club.cover_image_url!}
              alt=""
              onError={() => setBrokenCover(club.cover_image_url)}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        {/* `bg-surface`, because the design's Avatar frame is filled White/100.
            Avatar's own fallback is `bg-foreground/10` — fine over a card, and
            over this container it is translucent enough that what sits behind
            shows straight through the initials. Caught by looking at the
            rendered page; it compiles and reads as a smudge. */}
        <Avatar
          src={club.avatar_url}
          name={club.name}
          size="xl"
          className="absolute top-4 left-6 h-18 w-18 rounded-xl border-surface bg-surface object-cover"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-3">
        <p className="truncate text-base font-semibold text-foreground">{club.name}</p>

        <p className="flex items-center gap-1 text-sm font-medium text-muted">
          <TypeIcon className="h-6 w-6 shrink-0" />
          <span className="min-w-0 truncate">
            {club.is_public ? 'Public club' : 'Private club'}
            {/* Appended to the row the design already draws rather than given a
                line of its own: the card is a measured 112px and a fourth row
                does not fit. Truncated, because a place name is up to 200
                characters and this row is ~200px wide.

                No distance figure beside it, deliberately. A club's location is
                a town rather than a doorstep, so "34 km" is a precision the
                data does not carry — `ExploreClubsList`'s `Near <name>` heading
                is how proximity is expressed. */}
            {club.location_name ? ` · ${club.location_name}` : ''}
          </span>
        </p>

        <div className="flex items-center gap-1">
          <div className="flex -space-x-1">
            {club.riders.map((rider) => (
              <Avatar
                key={rider.id}
                src={rider.avatar_url}
                name={rider.username ?? 'Rider'}
                size="xs"
                className="h-7 w-7 border-surface text-2xs"
              />
            ))}
          </div>
          {overflow > 0 && <span className="text-xs font-semibold text-muted">+{overflow}</span>}
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center">
        {joined ? (
          <UnreadCounter count={club.unread ?? 0} />
        ) : (
          <JoinClubButton clubId={club.id} clubName={club.name} />
        )}
      </div>
    </div>
  )
}

/**
 * `v2 / Component / Counter` — 24×24, pill radius, Warning/100 with White/100 at
 * Poppins/12/Semibold.
 *
 * Nothing renders at zero. The design has no empty-counter variant, and a red
 * badge reading 0 states the opposite of what a red badge means.
 *
 * Capped at `99+`, which is also where 015's count stops scanning: the function
 * bounds each source at 100 rows precisely because nobody reads the exact value
 * of a badge this size, and an unbounded count would scan a busy club's whole
 * index to render two digits.
 */
function UnreadCounter({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <span
      className="flex h-6 min-w-6 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-white"
      aria-label={`${count} new since you last looked`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
