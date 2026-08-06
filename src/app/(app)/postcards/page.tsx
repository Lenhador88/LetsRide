'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { PostcardDeck } from '@/components/postcards/PostcardDeck'
import { PostcardFilterBar } from '@/components/postcards/PostcardFilterBar'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonDeck } from '@/components/ui/Skeleton'
import { getFeed, getPostcardFilters, type FeedFilter } from '@/lib/data/postcards'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'

/**
 * The home screen — `Home - Postcards - All new` in the design.
 *
 * It fills the viewport and does not scroll: 96 header + 104 filter bar + 492
 * deck + 152 nav bar is exactly the 844 of the design frame. The filter bar
 * scrolls horizontally and a long caption scrolls inside its own card; the page
 * itself never does. That is why this route overrides the shell's bottom
 * padding — the nav here carries the sticky "Create postcard" action and so is
 * the taller of the design's two variants.
 *
 * ## The split, and why the frame is out here
 *
 * `useSearchParams()` requires a `<Suspense>` boundary above it — Next refuses
 * to prerender a page that reads it without one. So the filter has to be read
 * one component down from the default export, and the fixed frame stays out
 * here: it is the same 844 whether the feed has arrived or not, so putting it
 * inside the boundary would let the skeleton lay out at a different height than
 * the content that replaces it.
 */
export default function PostcardsPage() {
  return (
    <>
      <Header title="Home" />
      <div className="pb-navbar-action pt-header fixed inset-0 flex flex-col">
        <Suspense fallback={<SkeletonDeck />}>
          <PostcardsScreen />
        </Suspense>
      </div>
    </>
  )
}

function PostcardsScreen() {
  const searchParams = useSearchParams()
  const rider = searchParams.get('rider')
  const club = searchParams.get('club')

  // A rider and a club at once is not a state the design has, and intersecting
  // them would quietly return nothing. First one wins.
  const filter: FeedFilter | undefined = rider
    ? { kind: 'rider', id: rider }
    : club
      ? { kind: 'club', id: club }
      : undefined

  // `keys.ts` types the feed key's filter segment as `string | null`, so the
  // two-field filter is flattened into one. `kind` is part of it rather than
  // dropped: a rider and a club can hold the same uuid in principle, and two
  // different feeds sharing a cache entry is the kind of bug that only shows up
  // as someone else's postcards.
  const filterKey = filter ? filterSegment[filter.kind](filter.id) : null

  // The filter bar always describes the whole feed, never the filtered slice —
  // otherwise picking a rider would erase every other tile and strand you
  // there. That is why it has its own key with no filter segment, and why
  // changing the filter refetches one of these two and not the other.
  const feed = useQuery(queryKeys.postcards.feed(filterKey), () => getFeed({}, filter))
  const filters = useQuery(queryKeys.postcards.filters(), () => getPostcardFilters())

  const gate = combineQueries(feed, filters)
  if (gate.error) return <ErrorState onRetry={gate.refetch} />

  // Gated on the data, not on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is still nothing to draw.
  if (!feed.data || !filters.data) return <SkeletonDeck />

  return (
    <>
      <PostcardFilterBar filters={filters.data} active={filter} />
      <div className="min-h-0 flex-1 py-2">
        <PostcardDeck key={`${filter?.kind}-${filter?.id}`} postcards={feed.data} />
      </div>
    </>
  )
}
