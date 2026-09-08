import Link from 'next/link'
import { ChatBubbleIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import type { RideThreadActivity } from '@/lib/data/ride-timeline'
import { routes } from '@/lib/routes'
import { formatRelativeTime } from '@/lib/utils'

/**
 * A thread on the ride's timeline — its own row shape, deliberately taller and
 * busier than the 44px announcement row beside it (`108`, PD-402).
 *
 * **The distinction is the point**, and it is the club's, adopted rather than
 * re-derived. Product owner on the club timeline, 2026-08-31: *"a thread should
 * also be clearly visible, maybe with the thread icon on the left?"* A
 * conversation is a place a rider returns to; a rider arriving is a fact that
 * happened once. Drawing both as the same grey line makes the timeline read as
 * one undifferentiated list, which is what these screens were rebuilt to stop.
 *
 * So: the thread glyph on its own tinted tile at the left, the title at the
 * weight the deleted `RideThreadRow` gave it on the Threads list that went with
 * it, and a lead line saying who did what.
 *
 * ## The count arrived in `116` (PD-439), with its flag, as this doc required
 *
 * This row carried no reply count and said what adding one would cost: *"adding
 * one means adding `partial` in the same change — a bare total this row cannot
 * actually know is the defect the club's doc has always warned about."* Both
 * arrived together. The number is derived from the ride-wide message window
 * `getRideThreadReplies` reads, so on a busy ride it counts what was *fetched*
 * rather than what exists, and `partial` is what turns `12` into `12+`.
 *
 * **Do not draw one without the other**, and do not "tidy" the `+` away: the
 * moment this row prints a bare total it is asserting a number nothing in the
 * client can know.
 *
 * `activity` is `null` for a thread nobody has replied to — that is zero
 * replies rather than a missing read, and the row draws `lead` alone.
 *
 * **Still no participant faces**, and that is now a decision rather than a
 * pending task: the club's row has an avatar row to fill and this one has a
 * glyph, so carrying them would mean a signed-URL round trip per author for
 * something nothing renders.
 *
 * ## One thing it now DOES carry, and it arrived by deletion
 *
 * **The unread dot** — PD-426. It lived on `RideThreadsButton` and
 * `RideThreadsRow` as a single aggregate mark meaning *something on this ride is
 * unread*; both were deleted with the thread index they pointed at, and without
 * moving it, ride-thread unread indication would have left the app in the same
 * change. Per thread here rather than aggregate, which is strictly more than the
 * dot said before and is what `ClubTimelineThreadRow` has always done.
 *
 * ## No return anchor, unlike the club's
 *
 * The club's row carries `anchorKey` so a Back from the thread lands on the row
 * it was opened from, because a club thread is reachable from five kinds of
 * timeline row on a stream that pages. A ride's timeline does not page and its
 * thread screen goes back to the ride itself; `/rides/detail/thread`'s own
 * docstring has why a second anchor scheme is not built here. The row still
 * carries `id={anchorKey}` so a future one has its target — which costs nothing
 * and is what the club's row does too.
 */
export function RideTimelineThreadRow({
  threadId,
  anchorKey,
  title,
  lead,
  at,
  unread,
  activity,
}: {
  threadId: string
  /** The row's own DOM id — `mergeRideTimeline`'s key for this entry. A
   *  creation row and a reply row for the same thread carry different anchors,
   *  which is why this is a prop rather than derived from `threadId`. */
  anchorKey: string
  title: string
  /** Who did what — "ana started this" or "bram replied". Composed by the
   *  caller, because the two event kinds produce different sentences and the
   *  copy is the component's business only once it is one string. */
  lead: string
  at: string
  /** From `rides.threadsUnread` — this thread has messages this rider has not
   *  read. `false` both for a read thread and for a map that could not be
   *  fetched, which is why the caller narrows with `=== true`. */
  unread: boolean
  /** How many replies, and whether that number is a floor — `116`, PD-439.
   *  `null` is a thread with no replies, which draws `lead` alone rather than a
   *  count of nothing. */
  activity: RideThreadActivity | null
}) {
  return (
    <div id={anchorKey}>
      <Link
        href={routes.rideThread(threadId)}
        // One label for assistive tech, and the dot has to be IN it: everything
        // below is `aria-hidden`, so an unread state that exists only as a
        // coloured circle reaches a screen reader not at all. The club's row
        // composes its label the same way and for the same reason — including
        // the reply count, whose visible form is a glyph and a bare number.
        aria-label={[
          title,
          lead,
          activity ? replyLabel(activity) : null,
          unread ? 'unread messages' : null,
        ]
          .filter(Boolean)
          .join(', ')}
        className="flex min-h-[64px] items-center gap-3 px-3 py-2 transition-colors active:bg-border"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-track"
        >
          <ChatBubbleIcon className="h-5 w-5 text-foreground" />
        </span>

        <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold text-foreground">{title}</span>
          <span className="flex items-center gap-2">
            {/* **`lead` always draws, and the count joins it rather than
                replacing it** — the club's row keeps them both for the same
                reason, and here it is what tells "ana started this" apart from
                "bram replied" now that one row carries both angles. */}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{lead}</span>

            {/* The glyph-and-number form of `replyLabel`, matching the club's
                row exactly. The words stay in the `aria-label` above rather
                than being dropped when the eye gets the smaller mark. */}
            {activity && (
              <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-muted">
                <ChatBubbleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="tabular-nums">
                  {activity.messages}
                  {activity.partial ? '+' : ''}
                </span>
              </span>
            )}
          </span>
        </span>

        <span aria-hidden="true" className="shrink-0 text-xs font-normal text-muted">
          {/* Elapsed time, so no zone at all — see `formatRelativeTime`. */}
          {formatRelativeTime(at)}
        </span>

        {unread && <NotificationDot className="shrink-0" />}
      </Link>
    </div>
  )
}

/**
 * `3 replies`, or `12+ replies` when the window this was counted from filled —
 * `ClubTimelineThreadRow`'s own helper, verbatim, one domain over.
 *
 * The `+` is not decoration: without it the row asserts a total it cannot know,
 * which is the defect this component's header warned about for as long as it
 * had no count at all. Never reached for a thread with no replies; `lead` alone
 * carries that row.
 */
function replyLabel(activity: RideThreadActivity): string {
  const count = `${activity.messages}${activity.partial ? '+' : ''}`
  return `${count} ${activity.messages === 1 && !activity.partial ? 'reply' : 'replies'}`
}
