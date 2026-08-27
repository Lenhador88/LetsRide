import { BikeIcon, ClubsIcon } from '@/components/icons/generated'
import { FilterBar, FilterClubImage, FilterTile } from '@/components/ui/FilterTile'
import type { RideFilter, RideFilters } from '@/types'

/**
 * `v2 / Component / Filter Bar / Rides` — the same component set as the
 * postcards bar, so the tile geometry lives in `components/ui/FilterTile`.
 *
 * Three kinds of tile, in the order the design draws them:
 *
 * 1. **Your rides** — a Bike icon on a Grey/10% circle. The only tile with no
 *    imagery behind it, and the only one that is a *predicate* rather than an
 *    entity.
 * 2. **From clubs** — the Clubs glyph on a rounded square (PD-323).
 * 3. **One per club**, rounded squares, for every club with an upcoming ride —
 *    `FilterClubImage`'s cover-behind, avatar-in-front treatment (PD-284), the
 *    same component `PostcardFilterBar` gives its own club tiles.
 *
 * ## Tile 2 was `All rides`, and both its label and its shape changed with its
 * meaning
 *
 * Product owner, 2026-08-27. It counted every upcoming ride in the app, which
 * made it a near-superset of `Your rides` beside it and left the app with no
 * screen for *finding* a ride at all. It is the rides from the clubs this rider
 * has joined now, and discovery is `/rides/explore`, reached from the strip
 * below this bar rather than from a tile — a route, not a fourth filter, for
 * `/clubs/explore`'s reason.
 *
 * **So it is a square, not a circle, and that is semantics rather than
 * decoration.** `FilterTile`'s own header records the convention this bar
 * inherits: riders are circles, clubs are rounded squares. This tile is the
 * aggregate of the club tiles immediately to its right — *all of these at
 * once* — so it takes their shape. A circle here would group it with `Your
 * rides`, which is the one thing it is not.
 *
 * ## Its imagery is a glyph, not a collage (PD-323)
 *
 * Product owner, 2026-08-27: *"Ride list: 'From clubs' should be the clubs
 * icon."* It drew a 2×2 grid of those clubs' own covers, which made it the one
 * tile on the bar whose *shape* changed with the rider — one club filled the
 * square, four quartered it — while competing for attention with the per-club
 * tiles immediately to its right, which carry the same imagery and actually
 * identify something. A category reads as a category: one glyph, the way `Your
 * rides` beside it draws `BikeIcon`.
 *
 * The shape stays square, per the paragraph above: this story changed the
 * imagery and deliberately not the geometry.
 *
 * **`FilterCollage` is not dead and is not deleted.** `PostcardFilterBar`'s
 * "All new" tile still draws it, and that tile is a genuine collage — four
 * recent *photos*, which are the content rather than four logos standing in
 * for it. What is now unread is `RideFilters.collage` and the
 * `collageClubImages` that fills it; that lives in `src/lib/data/rides.ts` and
 * is **PD-331**, filed rather than removed here because that file was another
 * build session's territory at the time. That issue also carries the one
 * docstring left describing the collage as drawn — `collageClubImages`' own
 * header, which still argues for rendering that no longer happens.
 *
 * The design also draws a rider tile among the clubs ("itchyboots"). It is not
 * built — see the note on `RideFilter` in src/types.
 */
type RideFilterBarProps = {
  filters: RideFilters
  /** `undefined` selects the "All rides" tile. */
  active?: RideFilter
}

export function RideFilterBar({ filters, active }: RideFilterBarProps) {
  return (
    <FilterBar label="Filter rides">
      <FilterTile
        href="/rides?filter=mine"
        label="Your rides"
        count={filters.mine}
        selected={active?.kind === 'mine'}
        shape="circle"
      >
        {/* The one tile with no imagery: a 24px icon centred in the 64 circle. */}
        <span className="flex h-full w-full items-center justify-center">
          <BikeIcon className="h-6 w-6 text-foreground" />
        </span>
      </FilterTile>

      <FilterTile
        href="/rides"
        label="From clubs"
        count={filters.fromClubs}
        selected={!active}
        shape="square"
      >
        {/* Centred the same way `Your rides` centres its own glyph, so the two
            category tiles read as a pair against the club tiles that follow. */}
        <span className="flex h-full w-full items-center justify-center">
          <ClubsIcon className="h-6 w-6 text-foreground" />
        </span>
      </FilterTile>

      {filters.clubs.map((club) => (
        <FilterTile
          key={club.id}
          href={`/rides?club=${club.id}`}
          label={club.name}
          count={club.count}
          selected={active?.kind === 'club' && active.id === club.id}
          shape="square"
        >
          <FilterClubImage name={club.name} avatarUrl={club.imageUrl} coverUrl={club.coverUrl} />
        </FilterTile>
      ))}
    </FilterBar>
  )
}
