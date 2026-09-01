import Link from 'next/link'
import { ChatBubbleIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { ClubWaveButton } from '@/components/clubs/ClubWaveButton'
import { NotificationDot } from '@/components/ui/NotificationDot'
import type { ClubWaveState } from '@/lib/data/club-waves'
import { THREAD_PARTICIPANT_LIMIT, type ClubThreadActivity } from '@/lib/data/club-timeline'
import { routes } from '@/lib/routes'
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
 * `activity` is null for a thread nobody has replied to. That is not a missing
 * read — it is zero replies, and the row draws `lead` alone rather than an
 * empty avatar row and a count of nothing.
 *
 * ## `wave` — `092`, PD-356
 *
 * Only the thread's own CREATION entry carries one, never a `reply` entry for
 * the same thread — `092`'s spec: two wave targets for one thread would count
 * one thing twice, and the reply row already points at the same conversation.
 * `ClubTimeline` is what decides which of the two this instance is; this
 * component only knows whether `wave` was handed to it.
 *
 * The control cannot live inside the row's own `<Link>` — a button nested in
 * an anchor is invalid HTML and would fire the tap and the navigation both —
 * so it is now a trailing SIBLING of the link rather than a child of it, and
 * the rounded `bg-track` tile moved from the link to the row that wraps both.
 */
export function ClubTimelineThreadRow({
  threadId,
  title,
  lead,
  at,
  unread,
  activity,
  wave,
}: {
  threadId: string
  title: string
  /** The line under the title — who started it, or who last replied. The
   *  timeline draws the same thread from two angles and this is the only part
   *  that differs. */
  lead: string
  at: string
  unread: boolean
  activity: ClubThreadActivity | null
  /** Present only for the thread's CREATION entry — `undefined` for a
   *  `reply` row, which draws no control at all rather than a disabled one
   *  (there is nothing here to be "loading": this entry simply does not
   *  carry a wave). `state` inside follows `ClubWaveButton`'s own Loading
   *  rule. */
  wave?: {
    state: ClubWaveState | undefined
    onWave: () => Promise<{ error: string | null }>
    onUnwave: () => Promise<{ error: string | null }>
  }
}) {
  const shown = activity?.participants.slice(0, THREAD_PARTICIPANT_LIMIT) ?? []
  const overflow = (activity?.participants.length ?? 0) - shown.length

  return (
    <div className="flex min-h-[72px] items-center gap-2 rounded-lg bg-track pr-2 transition-colors">
      <Link
        href={routes.clubThread(threadId)}
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
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">
              {lead}
              {activity && ` · ${replyLabel(activity)}`}
            </span>
          </span>
        </span>

        {unread && <NotificationDot className="shrink-0" />}
      </Link>

      {wave && <ClubWaveButton state={wave.state} onWave={wave.onWave} onUnwave={wave.onUnwave} />}
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
