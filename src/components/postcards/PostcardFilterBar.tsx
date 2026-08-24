import { getInitials } from '@/lib/utils'
import { FilterBar, FilterClubImage, FilterCollage, FilterTile } from '@/components/ui/FilterTile'
import type { PostcardFilterOption, PostcardFilters } from '@/types'

/**
 * `v2 / Component / Filter Bar / Postcards`.
 *
 * The tile itself lives in `components/ui/FilterTile` — it is one Figma
 * component set shared with the rides bar, and every measurement is documented
 * there. What is specific to this bar is only *which* tiles it draws: the "All
 * new" collage, then every rider, then every club in the feed window. A club
 * tile's image is `FilterClubImage` (PD-284); a rider's stays the plain
 * avatar-or-initials `TileImage` below, since a rider has no cover to draw.
 */
type PostcardFilterBarProps = {
  filters: PostcardFilters
  /** `undefined` selects the "All new" tile. */
  active?: { kind: 'rider' | 'club'; id: string }
}

export function PostcardFilterBar({ filters, active }: PostcardFilterBarProps) {
  const items = [...filters.riders, ...filters.clubs]

  return (
    <FilterBar label="Filter postcards">
      <FilterTile
        href="/postcards"
        label="All new"
        count={filters.total}
        selected={!active}
        shape="circle"
      >
        <FilterCollage images={filters.collage} />
      </FilterTile>

      {items.map((item) => (
        <FilterTile
          key={`${item.kind}-${item.id}`}
          href={`/postcards?${item.kind}=${item.id}`}
          label={item.name}
          count={item.count}
          selected={active?.kind === item.kind && active.id === item.id}
          shape={item.kind === 'rider' ? 'circle' : 'square'}
        >
          {item.kind === 'club' ? (
            <FilterClubImage name={item.name} avatarUrl={item.imageUrl} coverUrl={item.coverUrl} />
          ) : (
            <TileImage option={item} />
          )}
        </FilterTile>
      ))}
    </FilterBar>
  )
}

/** A rider tile's image — a club tile's is `FilterClubImage` above. */
function TileImage({ option }: { option: PostcardFilterOption }) {
  if (!option.imageUrl) {
    return (
      <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-foreground">
        {getInitials(option.name)}
      </span>
    )
  }
  // Signed URLs rotate hourly, so next/image would miss its cache every render
  // and proxy a private bucket for nothing. Same reasoning as Avatar.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={option.imageUrl} alt="" className="h-full w-full object-cover" />
}
