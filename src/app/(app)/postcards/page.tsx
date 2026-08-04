import { Header } from '@/components/layout/Header'
import { PostcardDeck } from '@/components/postcards/PostcardDeck'
import { PostcardFilterBar } from '@/components/postcards/PostcardFilterBar'
import { getFeed, getPostcardFilters, type FeedFilter } from '@/lib/data/postcards'

/**
 * The home screen — `Home - Postcards - All new` in the design.
 *
 * It fills the viewport and does not scroll: 96 header + 104 filter bar + 492
 * deck + 152 nav bar is exactly the 844 of the design frame. The filter bar
 * scrolls horizontally and a long caption scrolls inside its own card; the page
 * itself never does. That is why this route overrides the shell's bottom
 * padding — the nav here carries the sticky "Create postcard" action and so is
 * the taller of the design's two variants.
 */
export default async function PostcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ rider?: string; club?: string }>
}) {
  const { rider, club } = await searchParams

  // A rider and a club at once is not a state the design has, and intersecting
  // them would quietly return nothing. First one wins.
  const filter: FeedFilter | undefined = rider
    ? { kind: 'rider', id: rider }
    : club
      ? { kind: 'club', id: club }
      : undefined

  // The filter bar always describes the whole feed, never the filtered slice —
  // otherwise picking a rider would erase every other tile and strand you there.
  const [postcards, filters] = await Promise.all([
    getFeed({}, filter),
    getPostcardFilters(),
  ])

  return (
    <>
      <Header title="Home" />
      <div className="pb-navbar-action pt-header fixed inset-0 flex flex-col">
        <PostcardFilterBar filters={filters} active={filter} />
        <div className="min-h-0 flex-1 py-2">
          <PostcardDeck key={`${filter?.kind}-${filter?.id}`} postcards={postcards} />
        </div>
      </div>
    </>
  )
}
