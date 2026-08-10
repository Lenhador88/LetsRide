'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound, useSearchParams } from 'next/navigation'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { RideChatComposer } from '@/components/rides/RideChatComposer'
import { RideChatThread } from '@/components/rides/RideChatThread'
import { RideHeader } from '@/components/rides/RideHeader'
import { getRide, getRideCrew, withOrganizer } from '@/lib/data/rides'
import { getRideMessages, groupMessages } from '@/lib/data/ride-messages'
import { sendRideMessage } from '@/lib/actions/ride-messages'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import { useRideMessageStream } from '@/lib/realtime/useRideMessageStream'
import type { RideChatMessage } from '@/types'

/**
 * `Ride - Chat` (`2226:4999`) — the ride's group chat.
 *
 * ## Who may be here, and how this screen knows
 *
 * `034` gives the chat to the ride's **crew**: the organizer, plus anyone
 * holding a `ride_members` row of either status. That is narrower than the ride
 * itself, which any signed-in rider can see when it is public.
 *
 * The consequence is a state the design does not draw and the screen must:
 * a rider who can open this URL but is not on the ride. RLS answers them with an
 * empty list, which is indistinguishable from a chat nobody has written in — so
 * the *thread* cannot tell them apart and the *ride* can. `getRide` answers it
 * as `is_crew`, the client's mirror of `private.is_ride_crew`, derived there
 * once rather than in each of the three screens that need it — see that
 * function and the field on `RideDetail`.
 *
 * **That is a UX affordance, not the enforcement**, the same way the route guard
 * is not a security boundary. A rider who defeats it reaches a thread whose every
 * query returns nothing and whose every send is refused.
 *
 * ## Three reads, and why the third is not `getRide`'s job
 *
 * The header's `10 riders` is a crew count, and `getRide` deliberately does not
 * produce one — its docstring records that an earlier version derived a headline
 * number from an unbounded roster read and labelled it "going" while counting
 * `maybe` too, so it disagreed with the crew page one tap away.
 *
 * So this reads the roster the crew page reads, under the crew page's key,
 * through the crew page's `withOrganizer`. The number is then identical **by
 * construction** rather than by two derivations agreeing — and on the common
 * path it is a cache hit, because the rider arrived through the ride. The cost
 * is a bounded roster read for one integer when it is not.
 */
export default function RideChatPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per ride — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <RideChatScreen />
    </Suspense>
  )
}

function RideChatScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const ride = useQuery(queryKeys.rides.detail(id), () => getRide(id))
  const messages = useQuery(queryKeys.rides.messages(id), () => getRideMessages(id))
  const roster = useQuery(queryKeys.rides.crew(id), () => getRideCrew(id))

  /**
   * Messages this rider has sent that the database has not confirmed yet.
   *
   * Held here rather than written into the query cache, and the distinction is
   * deliberate: the cache holds what the server said, and a refetch landing
   * mid-send must not be able to drop a message the rider is watching. These are
   * merged at render and retired by *identity* — the id was chosen before the
   * request, so the moment the real row arrives carrying it, the optimistic copy
   * stops being rendered without a flicker in between. `034` leaves `id`
   * client-suppliable for exactly this.
   */
  const [sending, setSending] = useState<RideChatMessage[]>([])

  // `null` is decided — no such ride, or none this rider may see. `undefined` is
  // the effect not having answered yet, and 404ing on it flashes one on every
  // load.
  if (ride.data === null) notFound()

  const isCrew = ride.data?.is_crew
  const crew = ride.data && roster.data
    ? withOrganizer(roster.data, ride.data.organizer_id, ride.data.organizer)
    : null

  return (
    <>
      <RideHeader
        rideId={id}
        title={ride.data?.title}
        current="chat"
        // Never draws either button on the page it links to, but both props
        // are required so a sub-page cannot silently omit one — see RideHeader.
        isCrew={isCrew}
        isOrganizer={ride.data?.is_organizer}
        ridersCount={crew ? crew.going.length + crew.maybe.length : undefined}
      />

      {/* Fixed to the viewport rather than scrolling under the shell's padding,
          like `/postcards`: a chat is a column that owns its own scrolling, with
          the composer pinned under it. `pt-header` here and
          `pt-header-sub-extra` on the child, because both set `padding-top` and
          a single element cannot carry the 120px header's two halves. */}
      <div className="pt-header fixed inset-0 flex flex-col">
        <div className="pt-header-sub-extra flex min-h-0 flex-1 flex-col">
          <ChatBody rideId={id} isCrew={isCrew} messages={messages} sending={sending} setSending={setSending} ride={ride} roster={roster} />
        </div>
      </div>
    </>
  )
}

function ChatBody({
  rideId,
  isCrew,
  messages,
  sending,
  setSending,
  ride,
  roster,
}: {
  rideId: string
  isCrew: boolean | undefined
  messages: ReturnType<typeof useQuery<RideChatMessage[] | null>>
  sending: RideChatMessage[]
  setSending: React.Dispatch<React.SetStateAction<RideChatMessage[]>>
  ride: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getRide>>>>
  roster: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getRideCrew>>>>
}) {
  // Live delivery. The callback only *signals* — see the hook for why it does
  // not hand the payload row to the cache. Wrapped so the hook's effect does not
  // re-run for a new closure identity on every render.
  /**
   * Retire optimistic rows the server has confirmed.
   *
   * Rendering already hides them by id, so nothing draws twice without this —
   * but the array would grow for the life of the screen, and the hiding is only
   * as durable as the `RIDE_MESSAGES_PAGE_SIZE` window it checks against. Left
   * unpruned, a long session busy enough to push a sent row out of the newest
   * 200 would see its optimistic copy reappear, `pending` and out of order, at
   * the bottom of the thread. Pruning on arrival keeps the retire-by-identity
   * contract from depending on the page size.
   */
  const serverIdsKey = messages.data?.map((message) => message.id).join(',')
  useEffect(() => {
    if (!messages.data) return
    const confirmed = new Set(messages.data.map((message) => message.id))
    setSending((current) =>
      current.some((message) => confirmed.has(message.id))
        ? current.filter((message) => !confirmed.has(message.id))
        : current
    )
    // Keyed on the ids rather than the array, which is a fresh object on every
    // refetch — and this effect calls setState, so an identity dependency would
    // loop. The guard above makes the state update a no-op when nothing landed;
    // the key makes the effect not run at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIdsKey, setSending])

  const refetchMessages = messages.refetch
  useRideMessageStream(
    // Not subscribed for a rider who is not on the ride: Realtime evaluates
    // `034`'s SELECT policy per subscriber, so the channel would be correct and
    // permanently silent — an open socket for nothing.
    isCrew ? rideId : undefined,
    useCallback(() => refetchMessages(), [refetchMessages])
  )

  const send = useCallback(
    async (body: string, messageId: string): Promise<string | null> => {
      const optimistic: RideChatMessage = {
        id: messageId,
        ride_id: rideId,
        // Unknown until the server row arrives, and never rendered: the design
        // draws no name and no avatar on your own bubble. Grouping does not read
        // it either — `groupMessages` keys a `mine` row on identity-as-rendered
        // rather than on this column, precisely so an optimistic message can
        // still join the run above it. See that function.
        author_id: '',
        body,
        created_at: new Date().toISOString(),
        author: null,
        mine: true,
        startsGroup: true,
        startsDay: false,
        pending: true,
      }
      setSending((current) => [...current, optimistic])

      const result = await sendRideMessage(rideId, body, messageId)

      if (result.error) {
        // Withdrawn, not left dimmed for ever. `.claude/agents/realtime.md`: a
        // message must never be left looking sent when it was not. The composer
        // puts the text back in the field.
        setSending((current) => current.filter((message) => message.id !== messageId))
        return result.error
      }
      return null
    },
    [rideId, setSending]
  )

  const gate = combineQueries(ride, messages, roster)

  if (gate.error) {
    return (
      <div className="px-4">
        <ErrorState onRetry={gate.refetch} />
      </div>
    )
  }

  // Gated on the data, never on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is nothing to draw.
  if (isCrew === undefined || !messages.data) {
    return (
      <div className="px-4">
        <SkeletonList />
      </div>
    )
  }

  if (!isCrew) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-base font-semibold text-foreground">This chat is for the crew</p>
        <p className="text-sm text-muted">
          Say you are going and you will be able to read and post here.
        </p>
        <Link href={routes.ride(rideId)} className="text-sm font-semibold text-accent">
          Back to the ride
        </Link>
      </div>
    )
  }

  // Regrouped over the list actually being drawn rather than reusing the flags
  // the read computed: an optimistic message changes whether the one before it
  // ends a run, and grouping stale by one row is exactly the case that shows a
  // duplicate name. See `groupMessages`.
  const serverIds = new Set(messages.data.map((message) => message.id))
  const shown = groupMessages([
    ...messages.data,
    ...sending.filter((message) => !serverIds.has(message.id)),
  ])

  return (
    <>
      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-base font-semibold text-foreground">No messages yet</p>
          <p className="text-sm text-muted">Say hello to the riders coming along.</p>
        </div>
      ) : (
        <RideChatThread messages={shown} />
      )}
      <RideChatComposer onSend={send} />
    </>
  )
}
