import Link from 'next/link'
import { Globe2Icon, Lock2Icon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { JoinClubButton } from '@/components/clubs/JoinClubButton'
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
 * **The 80-wide image and the 72 avatar have no data behind them.** `clubs` has
 * carried the same seven columns since 001 and `avatar_url` has never been
 * written by anything in this repo — `/clubs/new` inserts four fields and stops.
 * They render as the design's containers with the club's initials, which is the
 * honest subset. Adding `avatar_path` / `cover_image_path` without the upload
 * screen that fills them would draw exactly this and leave two dead columns
 * behind; it sizes with Create/Edit club. Logged in docs/FIGMA-FIDELITY-TODO.md.
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

  return (
    <div className="relative flex gap-3 rounded-lg bg-surface p-1 pr-4 transition-colors focus-within:bg-background active:bg-background">
      <Link href={`/clubs/${club.id}`} className="absolute inset-0 rounded-lg">
        <span className="sr-only">{club.name}</span>
      </Link>

      <div className="relative h-26 w-24 shrink-0">
        {/* The design's 80×104 image container, empty. It carries no icon: the
            avatar overlaps it from x24, so anything centred in it renders
            underneath and cannot be seen — which is worse than an empty
            container, because it looks finished in the diff. `List / Ride`
            keeps its location pin only because nothing covers it. */}
        <div className="absolute inset-y-0 left-0 w-20 overflow-hidden rounded bg-border" />
        {/* `bg-surface`, because the design's Avatar frame is filled White/100.
            Avatar's own fallback is `bg-foreground/10` — fine over a card, and
            over this placeholder it is translucent enough that the icon behind
            shows straight through the initials. Caught by looking at the
            rendered page; it compiles and reads as a smudge. */}
        <Avatar
          name={club.name}
          size="xl"
          className="absolute top-4 left-6 h-18 w-18 rounded-xl border-surface bg-surface"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-3">
        <p className="truncate text-base font-semibold text-foreground">{club.name}</p>

        <p className="flex items-center gap-1 text-sm font-medium text-muted">
          <TypeIcon className="h-6 w-6 shrink-0" />
          {club.is_public ? 'Public club' : 'Private club'}
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
