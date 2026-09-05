'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { unhidePostcard } from '@/lib/actions/moderation'
import { HIDDEN_POSTCARDS_PAGE_SIZE, getHiddenPostcards } from '@/lib/data/moderation'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { formatPostcardDate } from '@/lib/utils'
import type { HiddenPostcard } from '@/types'

/**
 * The hidden-postcards half of PD-298 — the first caller `unhidePostcard` has
 * ever had.
 *
 * ## Why every row looks the same, and why that is the feature
 *
 * The first cut of this screen showed a caption, an author and a thumbnail for
 * a postcard the rider could still see, and a neutral "no longer available" row
 * for one they could not. **A pre-merge review showed that shape is a block
 * detector.** The unrestorable state had three claimed causes, but the author
 * deleting their account cascades the hide row away entirely, so it had two —
 * and for a postcard with no club it had exactly one, because the club arm is
 * vacuous there. Beside `BlockedRidersList`, which tells a rider their own
 * outbound blocks, a row that quietly stopped being restorable said *"that
 * rider blocked you"* — repeatable, and on a schedule the rider chooses by
 * hiding one postcard per person they want to watch.
 *
 * No predicate fixes it. For a non-club postcard the only reason to withhold is
 * a block, so withholding **is** the signal and not withholding hands an
 * author's photo to someone they blocked. `106` removed the differentiation
 * instead: every row is a postcard id and a date, both facts about something
 * this rider did.
 *
 * **So do not enrich this list.** A caption, an author, a thumbnail, a "this is
 * gone" marker, a disabled button, a different sort for unavailable rows — each
 * re-opens the channel, and each looks like an obvious improvement. `106`'s
 * header and `design.md` D4 carry the argument.
 *
 * The cost is real and was accepted: a rider with many hides cannot tell which
 * row is which. What the screen buys is that the tap is no longer permanent,
 * which is the complaint PD-298 was filed about.
 *
 * ## Paging
 *
 * `PrivacySheet` is a bottom sheet, not a page, so the first page is the whole
 * of what most riders will ever see. Older pages are fetched into local state
 * rather than into the cache, and are discarded after any write — the write
 * invalidates `postcards.all()`, which refetches page one, and keeping stale
 * deeper pages beside a fresh first page is how a list starts showing a row
 * twice.
 */
export function HiddenPostcardsList() {
  const online = useOnlineStatus()
  const showBanner = useBanner()
  const hidden = useQuery(queryKeys.postcards.hidden(), () => getHiddenPostcards())

  const [older, setOlder] = useState<HiddenPostcard[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  if (hidden.error) {
    return (
      <Section>
        <ErrorState onRetry={hidden.refetch} />
      </Section>
    )
  }

  // Gated on the data, never on `isLoading`: on the first render pass there is
  // no data AND no fetch in flight.
  if (hidden.data === undefined) {
    return (
      <Section>
        <div className="h-5 w-40 animate-pulse rounded bg-track" />
      </Section>
    )
  }

  const rows = [...hidden.data, ...older]

  async function run(row: HiddenPostcard) {
    setPending(row.postcard_id)
    const result = await unhidePostcard(row.postcard_id)
    setPending(null)

    if (result.error) {
      showBanner(result.error, 'error')
      return
    }

    setOlder([])
    setExhausted(false)
    // Deliberately does not claim the postcard is back on the feed. Unhiding
    // removes the hide row and nothing else; whether the postcard is visible
    // afterwards depends on predicates this screen must not report on.
    showBanner('Postcard unhidden')
  }

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last) return
    setLoadingMore(true)
    try {
      const next = await getHiddenPostcards(last.hidden_at)
      setOlder((current) => [...current, ...next])
      if (next.length < HIDDEN_POSTCARDS_PAGE_SIZE) setExhausted(true)
    } catch {
      showBanner('Could not load older hidden postcards.', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  if (rows.length === 0) {
    return (
      <Section>
        <p className="text-sm text-muted">You haven’t hidden any postcards.</p>
      </Section>
    )
  }

  const canLoadMore = !exhausted && hidden.data.length >= HIDDEN_POSTCARDS_PAGE_SIZE

  return (
    <Section>
      <p className="text-sm text-muted">
        Hidden postcards are removed from your feed only. Unhide one to put it back.
      </p>

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.postcard_id} className="flex items-center gap-3">
            {/* Uniform, and never an image: the Storage policy resolves through
                the `postcards` audience predicate as the caller, and the hide
                conjunct lives inside it — so a row on this list can never sign
                a thumbnail, whoever authored it. */}
            <div
              aria-hidden="true"
              className="h-12 w-12 shrink-0 rounded-lg border border-border bg-track"
            />

            <p className="min-w-0 flex-1 text-sm text-foreground">
              Hidden {formatPostcardDate(row.hidden_at)}
            </p>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => void run(row)}
              loading={pending === row.postcard_id}
              disabled={!online || pending !== null}
            >
              Unhide
            </Button>
          </li>
        ))}
      </ul>

      {canLoadMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void loadMore()}
          loading={loadingMore}
          disabled={!online}
        >
          Show older
        </Button>
      )}
    </Section>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-foreground">Hidden postcards</h3>
      {children}
    </section>
  )
}
