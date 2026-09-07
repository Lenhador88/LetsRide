'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { PostcardDeck } from '@/components/postcards/PostcardDeck'
import { PostcardFilterBar } from '@/components/postcards/PostcardFilterBar'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRegion, SkeletonDeck, SkeletonFilterBar } from '@/components/ui/Skeleton'
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
 * without a bar was doing.** The bar is 104 and a centred child moves half of
 * it, so the card settled **~52px** downward on every cold load. Half
 * `/rides`' jump, and for the same reason — *that* screen is top-aligned so
 * the whole 104 shows, this one is centred so half does. PD-217 got this wrong
 * by reasoning about whether the card moved **within** its slot, which it does
 * not, rather than whether the slot itself resized.
 *
 * **Stated as `bar / 2` rather than as centres, because the centres are not
 * device-independent and the delta is.** The 844/96/152 triple above is the
 * design frame's, as that block says; a real viewport computes the header and
 * the nav through `env()` — 56 and 132 with no safe areas, 95 and 154 on the
 * device the frame is drawn for — so the card's centre is 328, or 297.5, and
 * never the 298 an idealised sum gives. The bar carries no `env()`, so 104 and
 * 52 hold everywhere. This whole issue exists because someone reasoned
 * confidently from CSS numbers, which is reason enough not to leave a new set
 * of them here asserting more precision than they have.
 *
 * It mirrors the loaded return below exactly — bar, then the deck inside the
 * same `min-h-0 flex-1 py-2` wrapper — because anything less is a second
 * boundary to get wrong. Used at **both** cold-load positions: the `<Suspense>`
 * fallback while `useSearchParams` resolves, and the `!filters.data` gate.
 *
 * **It announces nothing, at either position — PD-220.** Being rendered twice
 * is what makes the shape settle without moving; it is also what made this
 * component the wrong place for a live region, since the two sit either side of
 * a Suspense boundary and React mounts a fresh one rather than reconciling. The
 * announcement is `PostcardsScreen`'s single `LoadingRegion` instead, so every
 * skeleton here is `announce={false}` — including the one in the deck slot
 * below, which is the third position and not part of this component at all.
 */
function PostcardsLoading() {
  return (
    <>
      <SkeletonFilterBar />
      <div className="min-h-0 flex-1 py-2">
        <SkeletonDeck announce={false} />
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

  // **`LoadingRegion` is child 0 of every branch below, and that is load-
  // bearing — PD-220.** This screen draws a skeleton at three positions during
  // one cold load (the `<Suspense>` fallback, the `!filters.data` gate, and the
  // deck slot below while `feed` is still in flight), and no two of them
  // reconcile, so a region inside any of them is inserted afresh and announces
  // again. Every skeleton here is therefore silent and this one element carries
  // the announcement, reconciled by position across all three branches so it
  // mounts once and only its text changes. Keep it first in each; the index is
  // what makes it the same element.
  const loadingLabel = !filters.data || (!feed.error && !feed.data) ? 'Loading postcards' : null

  if (filters.error)
    return (
      <>
        <LoadingRegion label={null} />
        <ErrorState onRetry={gate.refetch} />
      </>
    )

  // Gated on the data, not on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is still nothing to draw.
  if (!filters.data)
    return (
      <>
        <LoadingRegion label={loadingLabel} />
        <PostcardsLoading />
      </>
    )

  return (
    <>
      <LoadingRegion label={loadingLabel} />
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
          // Silent: the screen's own `LoadingRegion` above is the
          // announcement, and this is the third of the three positions that
          // would otherwise each insert one.
          <SkeletonDeck announce={false} />
        )}
      </div>
    </>
  )
}
