import { BikeIcon } from '@/components/icons/generated'
import { FilterBar, FilterClubImage, FilterCollage, FilterTile } from '@/components/ui/FilterTile'
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
 * 2. **All rides** — the 2×2 collage.
 * 3. **One per club**, rounded squares, for every club with an upcoming ride —
 *    `FilterClubImage`'s cover-behind, avatar-in-front treatment (PD-284), the
 *    same component `PostcardFilterBar` gives its own club tiles.
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
        label="All rides"
        count={filters.total}
        selected={!active}
        shape="circle"
      >
        <FilterCollage images={filters.collage} />
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
