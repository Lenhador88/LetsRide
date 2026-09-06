import Link from 'next/link'
import { ChatBubbleIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { THREAD_PARTICIPANT_LIMIT, type ClubThreadActivity } from '@/lib/data/club-timeline'
import { clubThreadFromTimeline } from '@/lib/routes'
import { formatRelativeTime } from '@/lib/utils'

/**
 * A thread on the club timeline — its own row shape, deliberately taller and
 * busier than the 44px event row beside it.
 *
 * **The distinction is the point** (product owner, 2026-08-31: *"a thread
 * should also be clearly visible, maybe with the thread icon on the left? And
 * also a thread should somehow show who is involved, and how many messages it
 * has?"*). A conversation is a place a rider returns to; a join or a club's
 * founding is a fact that happened once. Drawing both as the same grey line
 * made the timeline read as one undifferentiated list, which is what this
 * whole screen was rebuilt to stop.
 *
 * So: the thread glyph on its own tinted tile at the left, the title at the
 * weight `ClubThreadRow` gives it on the Threads list, the faces of whoever is
 * talking, and how many replies there are.
 *
 * ## The count is a floor when the window filled, and says so
 *
 * `ClubThreadActivity` is derived from the club-wide message window the reply
 * events already read, so on a busy club it counts what was fetched rather than
 * what exists — and `partial` is what turns `12` into `12+`. This is the same
 * trap that made `ClubThreadsRow` drop its thread count entirely; the number
 * survives here only because the flag comes with it.
 *
 * **The visible count is a glyph and a number, not words — `097`, PD-365.**
 * `replyLabel` below still produces `"12+ replies"`, but only for the
 * `aria-label`; the eye now reads the same `ChatBubbleIcon` the join row's
 * introduction door uses, beside the bare `12+`. The `+` is not decoration
 * either way: dropping it when the words become a glyph would make the row
 * assert a total it cannot know, which is exactly the defect this doc has
 * always warned about — see `replyLabel`'s own comment.
 *
 * `activity` is null for a thread nobody has replied to. That is not a missing
 * read — it is zero replies, and the row draws `lead` alone rather than an
 * empty avatar row and a count of nothing.
 *
 * ## No wave — PD-372
 *
 * The club timeline's only waveable row is the **announcement** row (a rider's
 * join, `ClubTimelineEventRow`). Product owner, 2026-09-02: *"yes, only
 * annoucements are waveable please."* `092` gave a thread's creation entry a
 * wave of its own; that control, `waveThread`/`unwaveThread` and
 * `queryKeys.clubs.threadWaves` are all retired, so this row takes no `wave`
 * prop from either of `ClubTimeline`'s two thread branches. Its own test
 * asserts the ABSENCE in both directions, because an absence is invisible to a
 * test that only checks what rendered.
 *
 * **The wrapper `<div>` survives the button it was added for.** It exists
 * because a button may not nest inside an anchor, and with the button gone it
 * could collapse into the `<Link>` — it is kept because it carries
 * `id={anchorKey}`, PD-366's scroll target, whose loss no gate but the walk
 * would see. Only the `pr-2` that reserved room for the control is dropped, so
 * the row's padding is symmetric again.
 *
 * ## `anchorKey` — the return anchor, PD-366
 *
 * The row's own `id`, so the club timeline can scroll to it, and the row's own
 * return anchor, so a Back from the thread it opens lands here rather than on
 * the thread list — `clubThreadFromTimeline`, `design.md` §D9. A reply
 * entry's anchor names the message it came from, not the thread it links
 * into, which is why this is a required prop rather than derived from
 * `threadId`.
 */
export function ClubTimelineThreadRow({
  threadId,
  anchorKey,
  title,
  lead,
  at,
  unread,
  activity,
}: {
  threadId: string
  /**
   * This row's own key on `mergeClubTimeline`'s stream — `thread:<uuid>` for
   * the creation entry, `reply:<message uuid>` for a reply — never a new
   * identity. Required rather than derived from `threadId`, because a reply
   * entry's own anchor names the MESSAGE, a different id than the thread it
   * links into. Doubles as this row's DOM `id` (the scroll target) and as the
   * return anchor on its own outbound link — `097`'s follow-up, PD-366,
   * `design.md` §D9.
   */
  anchorKey: string
  title: string
  /** The line under the title — who started it, or who last replied. The
   *  timeline draws the same thread from two angles and this is the only part
   *  that differs. */
  lead: string
  at: string
  unread: boolean
  activity: ClubThreadActivity | null
}) {
  const shown = activity?.participants.slice(0, THREAD_PARTICIPANT_LIMIT) ?? []
  const overflow = (activity?.participants.length ?? 0) - shown.length

  return (
    <div
      id={anchorKey}
      className="flex min-h-[72px] items-center gap-2 rounded-lg bg-track transition-colors"
    >
      <Link
        href={clubThreadFromTimeline(threadId, anchorKey)}
        // One label for assistive tech: the faces, the glyph and the dot are all
        // decorative, so everything the eye reads from them has to be in words.
        // **The faces are in here because they are `aria-hidden` below**, and
        // "who is involved" is half of what the product owner asked this row to
        // show — a reader who cannot see the avatars would otherwise never learn
        // it. `replyLabel` is omitted when there are no replies: the visible row
        // shows `lead` in that case, and a label claiming "No replies yet" beside
        // a row that says something else is worse than a shorter label.
        aria-label={[
          title,
          lead,
          activity ? replyLabel(activity) : null,
          participantLabel(activity),
          unread ? 'unread messages' : null,
        ]
          .filter(Boolean)
          .join(', ')}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 transition-colors active:bg-border"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background text-foreground"
        >
          <ChatBubbleIcon className="h-5 w-5" />
        </span>

        <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
              {title}
            </span>
            <span className="shrink-0 text-xs font-normal text-muted">
              {/* Elapsed time, so no zone at all — see `formatRelativeTime`. */}
              {formatRelativeTime(at)}
            </span>
          </span>

          <span className="flex items-center gap-2">
            {shown.length > 0 && (
              <span className="flex shrink-0 -space-x-1.5">
                {shown.map((rider) => (
                  <Avatar
                    key={rider.id}
                    src={rider.avatar_url}
                    name={rider.username ?? 'Rider'}
                    size="xs"
                    className="h-5 w-5 border border-track text-[0.5rem]"
                  />
                ))}
                {overflow > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-track bg-border text-[0.5rem] font-semibold text-foreground">
                    +{overflow}
                  </span>
                )}
              </span>
            )}
            {/* **`lead` always draws, and the reply count joins it rather than
                replacing it.** The timeline shows one thread from two angles —
                "ana started it" three weeks ago and "bram replied" this morning —
                and dropping the lead whenever there are replies made both rows
                identical but for the timestamp, which is precisely the case the
                two angles exist to tell apart. */}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{lead}</span>

            {/* The glyph-and-number form of `replyLabel` — see this file's
                header. The words stay in the `aria-label` above; `097`'s
                task 7.7 is what requires that pairing rather than dropping
                the words when the eye gets a smaller mark. */}
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

        {unread && <NotificationDot className="shrink-0" />}
      </Link>
    </div>
  )
}

/**
 * `3 replies`, or `12+ replies` when the window this was counted from filled.
 *
 * The `+` is not decoration: without it the row asserts a total it cannot know
 * — see this component's header. It is never reached for a thread with no
 * replies; `lead` alone carries that row.
 */
function replyLabel(activity: ClubThreadActivity): string {
  const count = `${activity.messages}${activity.partial ? '+' : ''}`
  return `${count} ${activity.messages === 1 && !activity.partial ? 'reply' : 'replies'}`
}

/** The faces, in words, for the label — see the `aria-label` above. */
function participantLabel(activity: ClubThreadActivity | null): string | null {
  const names = activity?.participants
    .map((rider) => rider.username)
    .filter((name): name is string => !!name)

  if (!names || names.length === 0) return null
  return `with ${names.join(', ')}`
}
