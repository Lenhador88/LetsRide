'use client'

import Link from 'next/link'
import { PlusCircleIcon } from '@/components/icons/generated'
import { ClubThreadRow } from '@/components/clubs/ClubThreadRow'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { getClubThreadUnread, getClubThreads } from '@/lib/data/club-threads'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/** How many threads the section shows before `See all`. The Members rail's own
 * trade: enough to say what the club talks about, few enough that the club
 * detail does not become the list one tap away. */
const CLUB_DETAIL_THREADS = 3

/**
 * The `Threads` section on the merged club detail (`081`, PD-307) — shaped
 * like Members and Club rides: a header with `See all`, a create affordance,
 * and a few rows under it — the affordance also standing in place of them when
 * there are none.
 *
 * ## A non-member of a PUBLIC club sees a join prompt and no content
 *
 * This is the requirement the whole change turns on. `clubs` SELECT admits any
 * signed-in rider to a public club; `081` admits only its **members** to the
 * threads. So a non-member's read here returns zero rows — not an error — and
 * an empty state would be a lie ("no threads yet") while a count, a title,
 * an author or a time would each disclose something about a conversation they
 * are not in. They get a sentence and nothing else, and the section is **not**
 * hidden outright: a rider deciding whether to join should see that the club has
 * threads as a feature.
 *
 * `isMember` comes from the club's own `viewer_role`, which the detail screen
 * already holds. It is a UX affordance, never the enforcement — a rider who
 * defeats it reads zero rows anyway.
 *
 * ## The unread marks fail to nothing
 *
 * Two reads: the threads, and one RPC answering `(thread_id, has_unread)`
 * for all of them. A failed unread call resolves to `{}` inside
 * `getClubThreadUnread`, so the list renders unmarked rather than not
 * rendering. The reverse — a mark beside a row that failed to load — is
 * unreachable, because a mark is only ever looked up for a row this list
 * already has.
 *
 * **This section does not subscribe**, and neither does the list screen: one
 * channel per thread on a screen showing N threads multiplies subscriptions by
 * N, for a title that does not change. See `useClubThreadStream`, which the
 * *thread* screen mounts.
 */
export function ClubThreadsSection({
  clubId,
  isMember,
}: {
  clubId: string
  isMember: boolean
}) {
  // Not fetched at all for a non-member: the request is guaranteed to return
  // zero rows, and a `null` key is exactly `useQuery`'s "must not fetch and must
  // not throw" state.
  const threads = useQuery(
    isMember ? queryKeys.clubs.threads(clubId) : null,
    () => getClubThreads(clubId)
  )
  const unread = useQuery(
    isMember ? queryKeys.clubs.threadsUnread(clubId) : null,
    () => getClubThreadUnread(clubId)
  )

  if (!isMember) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeader title="Threads" className="px-4 py-0" />
        <p className="px-4 text-sm font-medium text-muted">
          Join the club to read and start threads.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="Threads"
        action={
          // Gated on there being something to open, the same policy the two
          // sections above apply: a `See all` onto an empty screen is PD-125's
          // defect, an entrance to nothing.
          threads.data && threads.data.length > 0
            ? { label: 'See all', href: routes.clubThreads(clubId) }
            : undefined
        }
        className="px-4 py-0"
      />

      {/* Gated on the data, never on `isLoading` — the first render pass has
          neither. A failed read draws the create affordance rather than an
          error: the club screen's own `ErrorState` owns the case where the club
          could not be read, and a section that cannot list threads must not take
          the club down with it — the same call `ClubMemberRail` makes. */}
      {threads.data === undefined && !threads.error ? (
        <div className="mx-4 flex h-14 items-center gap-3 rounded-lg border border-border px-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-3 w-32" />
        </div>
      ) : threads.data && threads.data.length > 0 ? (
        <>
          {/* Above the rows (PD-318). This section is a vertical list, so the
              tile was never *hidden* the way the two horizontal strips on this
              screen hid theirs — three rows above it at most, and it is on
              screen. It moves anyway, for consistency: the product owner asked
              for `Add ride, postcard, start a thread` together, and a create
              affordance that is first in two sections and last in the third is
              a rule the rider has to learn twice.

              What that costs is the argument this replaces — "the newest thread
              is what a rider came for, and a control between the heading and
              the list pushes it down on every visit for the sake of an action
              taken once" — and the cost is one 72px row, bounded, with the
              first thread still above the fold. On the strips the same argument
              cost the control entirely, which is why it lost there too. */}
          <StartThreadRow clubId={clubId} />
          <ul className="flex flex-col">
            {threads.data.slice(0, CLUB_DETAIL_THREADS).map((thread) => (
              <li key={thread.id}>
                <ClubThreadRow
                  thread={thread}
                  hasUnread={unread.data?.[thread.id] === true}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <StartThreadRow clubId={clubId} />
      )}
    </section>
  )
}

/**
 * The create affordance — drawn above the thread rows (PD-318), and in place of
 * them when there are none.
 *
 * **Its geometry is `ClubThreadRow`'s, not a card's**, and that is the whole
 * of the styling decision. It is a destination like the rows it sits with, so
 * it is a row of that list: same 72px height, same `px-4` full bleed, same
 * 40px leading tile, same text baseline. Drawn as an inset `h-14` card instead —
 * which is what it was while it only ever rendered *instead of* the list — it
 * stacks flush against a real row and misses on height, inset, icon size and
 * baseline at once.
 *
 * The dashed border moves to the **tile** rather than the container for the same
 * reason: it is what says "add" without making the row a different shape from
 * its neighbours.
 */
function StartThreadRow({ clubId }: { clubId: string }) {
  return (
    <Link
      href={routes.newClubThread(clubId)}
      className="flex min-h-[72px] items-center gap-3 px-4 py-3 text-left transition-colors active:bg-border"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong bg-track"
      >
        <PlusCircleIcon className="h-5 w-5 text-muted" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-semibold text-foreground">
          Start a thread
        </span>
        <span className="truncate text-sm font-medium text-muted">Ask the club a question</span>
      </span>
    </Link>
  )
}
