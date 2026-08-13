'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { PostcardDeck } from '@/components/postcards/PostcardDeck'
import { PostcardFilterBar } from '@/components/postcards/PostcardFilterBar'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonDeck, SkeletonFilterBar } from '@/components/ui/Skeleton'
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
 *
 * ## Two gates, not one (PD-210)
 *
 * The filter bar and the deck are gated **separately**, for the reason
 * `/rides` carries at length: the feed key holds the filter segment, so tapping
 * a tile lands on a cache entry with no data, while the bar's key has no filter
 * segment and its data never left. Gating both on both swapped the bar for the
 * skeleton every time a filter was picked. The deck's skeleton goes inside the
 * deck's own slot rather than replacing the screen, so the 104 bar row stays
 * put and only the 492 below it changes — `SkeletonDeck` and `PostcardDeck`
 * share the same `h-full` root, which is what makes that slot swap exact.
 *
 * That reasoning is about a filter *change*, where the bar is already drawn.
 * The **cold** load is a different boundary and it did move the card — see
 * `PostcardsLoading`.
 */

export default function PostcardsPage() {
  return (
    <>
      <Header title="Home" secondaryAction={<NotificationsHeaderControl />} />
      <div className="pb-navbar-action pt-header fixed inset-0 flex flex-col">
        <Suspense fallback={<PostcardsLoading />}>
          <PostcardsScreen />
        </Suspense>
      </div>
    </>
  )
}

/**
 * The cold-load shape, standing in for the settled screen rather than for the
 * deck alone — PD-218.
 *
 * **A centred child moves when its slot resizes, which is what the skeleton
 * without a bar was doing.** The frame is 596 tall (844 less the 96 header and
 * the 152 nav); drawing the deck alone centres the card at 298, and the bar
 * landing takes the slot to 492 and the centre to 350. The card settles ~52px
 * downward on every cold load. Half `/rides`' jump, and for the same reason —
 * *that* screen is top-aligned so the whole 104 shows, this one is centred so
 * half does. PD-217 got this wrong by reasoning about whether the card moved
 * **within** its slot, which it does not.
 *
 * It mirrors the loaded return below exactly — bar, then the deck inside the
 * same `min-h-0 flex-1 py-2` wrapper — because anything less is a second
 * boundary to get wrong. Used at **both** cold-load positions: the `<Suspense>`
 * fallback while `useSearchParams` resolves, and the `!filters.data` gate.
 * `SkeletonFilterBar` is `aria-hidden`, so it adds no second announcement
 * beside `SkeletonDeck`'s own `role="status"`.
 */
function PostcardsLoading() {
  return (
    <>
      <SkeletonFilterBar />
      <div className="min-h-0 flex-1 py-2">
        <SkeletonDeck />
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
  // The bar is gated on its own read on the error path too, for the reason
  // `/rides` gives at the same line: a failed feed read is not a failed filter
  // read, and swapping the bar out is the defect this change exists to remove.
  if (filters.error) return <ErrorState onRetry={gate.refetch} />

  // Gated on the data, not on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is still nothing to draw.
  if (!filters.data) return <PostcardsLoading />

  return (
    <>
      <PostcardFilterBar filters={filters.data} active={filter} />
      <div className="min-h-0 flex-1 py-2">
        {feed.error ? (
          <ErrorState onRetry={feed.refetch} />
        ) : feed.data ? (
          <PostcardDeck
            key={`${filter?.kind}-${filter?.id}`}
            postcards={feed.data}
            className="motion-safe:animate-fade-in"
          />
        ) : (
          <SkeletonDeck />
        )}
      </div>
    </>
  )
}
