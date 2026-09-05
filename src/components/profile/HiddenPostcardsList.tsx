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
 * ## The unrestorable row, and why its copy says so little
 *
 * A hide stops being restorable for three reasons: the rider left the club the
 * postcard was posted to, **the author blocked them**, or the author deleted
 * their account. `105` collapses all three into one boolean and NULLs every
 * preview column together, so this component has nothing to tell them apart
 * with even if it wanted to — which is the point. Naming the middle case would
 * turn this screen into a block detector: hide one postcard per rider you want
 * to monitor, then watch this list. `supabase/tests/rls_test.sql` defends the
 * opposite property in as many words ("the blocked rider is not told they were
 * blocked"), and that channel does not exist today.
 *
 * **So the copy below MUST stay identical for all three.** If a later change
 * makes it more helpful per case, it has re-opened the leak.
 *
 * ## No thumbnail on an unrestorable row, and none is coming
 *
 * Signing is a second authorization pass run as the rider, and `010`'s postcard
 * Storage policy resolves an `EXISTS … from postcards` under the caller's own
 * RLS. A `security definer` accessor bypasses table RLS but cannot make Storage
 * sign — so the image genuinely cannot be shown, rather than being withheld by
 * choice. Making it appear means widening a Storage policy, which hands an
 * author's photo to someone who may have blocked them; that is the product
 * owner's call and is explicitly out of this change.
 *
 * ## Paging
 *
 * `PrivacySheet` is a bottom sheet, not a page, so the first page is the whole
 * of what most riders will ever see. Older pages are fetched into local state
 * rather than into the cache, and are **discarded after any write** — the write
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

    // The write invalidated `postcards.all()`, which reaches this key and
    // refetches page one. Deeper pages were fetched against the old list, so
    // they are dropped rather than merged.
    setOlder([])
    setExhausted(false)
    showBanner(row.restorable ? 'Postcard unhidden' : 'Removed from this list')
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
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const busy = pending === row.postcard_id

          return (
            <li key={row.postcard_id} className="flex items-center gap-3">
              {row.restorable && row.image_url ? (
                <img
                  src={row.image_url}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-12 w-12 shrink-0 rounded-lg border border-border bg-track"
                />
              )}

              <div className="min-w-0 flex-1">
                {row.restorable ? (
                  <>
                    <p className="truncate text-sm font-semibold text-foreground">
                      {row.caption?.trim() || 'Untitled postcard'}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[row.author_username, row.taken_place_name]
                        .filter(Boolean)
                        .join(' · ') || 'A rider'}
                    </p>
                  </>
                ) : (
                  // IDENTICAL for all three reasons — see the header. Do not
                  // make this more specific.
                  <p className="text-sm text-muted">
                    This postcard isn’t available to you any more.
                  </p>
                )}
                <p className="text-xs text-muted">
                  Hidden {formatPostcardDate(row.hidden_at)}
                </p>
              </div>

              <Button
                size="sm"
                variant="secondary"
                onClick={() => void run(row)}
                loading={busy}
                disabled={!online || pending !== null}
              >
                {row.restorable ? 'Unhide' : 'Remove'}
              </Button>
            </li>
          )
        })}
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
