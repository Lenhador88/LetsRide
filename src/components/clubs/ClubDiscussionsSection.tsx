'use client'

import Link from 'next/link'
import { PlusCircleIcon } from '@/components/icons/generated'
import { ClubDiscussionRow } from '@/components/clubs/ClubDiscussionRow'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { getClubDiscussionUnread, getClubDiscussions } from '@/lib/data/club-discussions'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/** How many threads the section shows before `See all`. The Members rail's own
 * trade: enough to say what the club talks about, few enough that the club
 * detail does not become the list one tap away. */
const CLUB_DETAIL_DISCUSSIONS = 3

/**
 * The `Discussions` section on the merged club detail (`081`, PD-307) — shaped
 * like Members and Upcoming rides: a header with `See all`, a few rows, and an
 * affordance where the rows would be when there are none.
 *
 * ## A non-member of a PUBLIC club sees a join prompt and no content
 *
 * This is the requirement the whole change turns on. `clubs` SELECT admits any
 * signed-in rider to a public club; `081` admits only its **members** to the
 * threads. So a non-member's read here returns zero rows — not an error — and
 * an empty state would be a lie ("no discussions yet") while a count, a title,
 * an author or a time would each disclose something about a conversation they
 * are not in. They get a sentence and nothing else, and the section is **not**
 * hidden outright: a rider deciding whether to join should see that the club has
 * discussions as a feature.
 *
 * `isMember` comes from the club's own `viewer_role`, which the detail screen
 * already holds. It is a UX affordance, never the enforcement — a rider who
 * defeats it reads zero rows anyway.
 *
 * ## The unread marks fail to nothing
 *
 * Two reads: the threads, and one RPC answering `(discussion_id, has_unread)`
 * for all of them. A failed unread call resolves to `{}` inside
 * `getClubDiscussionUnread`, so the list renders unmarked rather than not
 * rendering. The reverse — a mark beside a row that failed to load — is
 * unreachable, because a mark is only ever looked up for a row this list
 * already has.
 *
 * **This section does not subscribe**, and neither does the list screen: one
 * channel per thread on a screen showing N threads multiplies subscriptions by
 * N, for a title that does not change. See `useClubDiscussionStream`, which the
 * *thread* screen mounts.
 */
export function ClubDiscussionsSection({
  clubId,
  isMember,
}: {
  clubId: string
  isMember: boolean
}) {
  // Not fetched at all for a non-member: the request is guaranteed to return
  // zero rows, and a `null` key is exactly `useQuery`'s "must not fetch and must
  // not throw" state.
  const discussions = useQuery(
    isMember ? queryKeys.clubs.discussions(clubId) : null,
    () => getClubDiscussions(clubId)
  )
  const unread = useQuery(
    isMember ? queryKeys.clubs.discussionsUnread(clubId) : null,
    () => getClubDiscussionUnread(clubId)
  )

  if (!isMember) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeader title="Discussions" className="px-4 py-0" />
        <p className="px-4 text-sm font-medium text-muted">
          Join the club to read and start discussions.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="Discussions"
        action={
          // Gated on there being something to open, the same policy the two
          // sections above apply: a `See all` onto an empty screen is PD-125's
          // defect, an entrance to nothing.
          discussions.data && discussions.data.length > 0
            ? { label: 'See all', href: routes.clubDiscussions(clubId) }
            : undefined
        }
        className="px-4 py-0"
      />

      {/* Gated on the data, never on `isLoading` — the first render pass has
          neither. A failed read draws the create affordance rather than an
          error: the club screen's own `ErrorState` owns the case where the club
          could not be read, and a section that cannot list threads must not take
          the club down with it — the same call `ClubMemberRail` makes. */}
      {discussions.data === undefined && !discussions.error ? (
        <div className="mx-4 flex h-14 items-center gap-3 rounded-lg border border-border px-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-3 w-32" />
        </div>
      ) : discussions.data && discussions.data.length > 0 ? (
        <>
          <ul className="flex flex-col">
            {discussions.data.slice(0, CLUB_DETAIL_DISCUSSIONS).map((discussion) => (
              <li key={discussion.id}>
                <ClubDiscussionRow
                  discussion={discussion}
                  hasUnread={unread.data?.[discussion.id] === true}
                />
              </li>
            ))}
          </ul>
          {/* Under the rows, not above them: the newest thread is what a rider
              came for, and a control between the heading and the list pushes it
              down on every visit for the sake of an action taken once. */}
          <StartDiscussionRow clubId={clubId} />
        </>
      ) : (
        <StartDiscussionRow clubId={clubId} />
      )}
    </section>
  )
}

/**
 * The create affordance, drawn under the rows as well as in place of them
 * (PD-312).
 *
 * **It used to render only when the club had no threads**, which is the shape
 * every other section here has — and on this one it was wrong in a way the
 * others are not. `Upcoming rides` and `Postcards` both have a `See all` that
 * leads to a screen carrying its own create control; Discussions did too, but a
 * rider on the club page with one thread saw only that thread and no way to
 * start a second. The affordance vanished at exactly the moment the club became
 * worth adding to. Product owner, 2026-08-27.
 *
 * Kept as a bordered row rather than a `Button`, in both positions, because it
 * is a destination like the rows above it rather than an action on this screen —
 * the same reason `ClubCreateRideRow` is a row.
 */
function StartDiscussionRow({ clubId }: { clubId: string }) {
  return (
    <Link
      href={routes.newClubDiscussion(clubId)}
      className="mx-4 flex h-14 items-center gap-3 rounded-lg border border-dashed border-border-strong bg-track px-3 text-left transition-colors active:bg-border"
    >
      <PlusCircleIcon className="h-6 w-6 shrink-0 text-muted" aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-foreground">Start a discussion</span>
        <span className="truncate text-xs font-medium text-muted">Ask the club a question</span>
      </span>
    </Link>
  )
}
