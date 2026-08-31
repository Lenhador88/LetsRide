'use client'

import Link from 'next/link'
import { ChatBubbleIcon, ChevronRightIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { getClubThreadUnread, getClubThreads } from '@/lib/data/club-threads'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * The club's Threads entrance, shaped like the member rail it sits under.
 *
 * ## Why a row rather than a tile in the create bar
 *
 * Threads is a **destination**, not a create — the create bar below offers
 * `Thread` for starting one, and this is for reading the ones that exist. When
 * the three-tile action layer became that bar (product owner, 2026-08-31), the
 * Threads tile went with it and took the list's only reliable entrance: the
 * timeline links to individual threads and its foot links to the list only when
 * the stream is cut, so a club whose threads all fit on screen had no way to
 * reach `/clubs/detail/threads` at all. That is PD-125's defect, and this row
 * is what closes it.
 *
 * ## The aggregate unread mark is the thing that had to survive
 *
 * `081` shipped a per-thread mark that was legible because Threads was a
 * section near the top of the screen. On a timeline a thread sinks with age, so
 * a club whose conversation went quiet for a month buries its own unread mark
 * under thirty joins. Two marks answer that between them and neither replaces
 * the other: **this one says go look**, and the timeline's own reply and thread
 * entries say **where**. Both read `clubs.threadsUnread`, the same key and so
 * the same request.
 *
 * Both reads fail to nothing: `getClubThreadUnread` resolves to `{}` on a
 * failure, and the count falls back to the label alone, so the row is an
 * entrance before it is a summary.
 */
export function ClubThreadsRow({ clubId }: { clubId: string }) {
  const threads = useQuery(queryKeys.clubs.threads(clubId), () => getClubThreads(clubId))
  const unread = useQuery(queryKeys.clubs.threadsUnread(clubId), () =>
    getClubThreadUnread(clubId)
  )

  const hasUnread = Object.values(unread.data ?? {}).some(Boolean)

  // **Withheld until there is a list to open**, which is this screen's standing
  // policy applied to its newest entrance rather than an exception to it: the
  // timeline drops `All photos` on a club with no photos and gates every foot
  // link on its list holding rows, and the rides section drops its `See all` on
  // an empty sub-page. A row reading "Threads" over an empty screen is the same
  // defect. Starting one stays reachable — that is the create bar's `Thread`.
  //
  // `undefined` is "not yet" and draws nothing; a `0` in its place would flash
  // the row away on every load of a club that has threads.
  if (!threads.data || threads.data.length === 0) return null

  return (
    <Link
      href={routes.clubThreads(clubId)}
      // The whole row is one label, so the dot — `aria-hidden` by construction —
      // has to be in words or it reaches nobody who is not looking at it.
      aria-label={hasUnread ? 'Threads, unread messages' : 'Threads'}
      className="mx-4 flex min-h-[46px] items-center gap-3 rounded-lg border border-border px-3 transition-colors active:bg-border"
    >
      <ChatBubbleIcon className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />

      {/* No count. `getClubThreads` returns a PAGE — `CLUB_THREADS_PAGE_SIZE`,
          20 — so a club with forty-five threads would render "Threads · 20" as
          a fact. The list one tap away is where the number belongs, and it has
          the pagination to be honest about it. */}
      <span aria-hidden="true" className="min-w-0 flex-1 text-sm font-semibold text-foreground">
        Threads
      </span>

      {hasUnread && <NotificationDot className="shrink-0" />}
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
    </Link>
  )
}
