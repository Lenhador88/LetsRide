'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatThread } from '@/components/chat/ChatThread'
import { MarkChatSeen } from '@/components/chat/MarkChatSeen'
import { Header } from '@/components/layout/Header'
import { useBanner } from '@/components/ui/Banner'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SkeletonList } from '@/components/ui/Skeleton'
import {
  RideThreadOptions,
  canRemoveRideThread,
} from '@/components/rides/RideThreadOptions'
import {
  deleteOwnRideThreadMessage,
  markRideThreadSeen,
  sendRideThreadMessage,
} from '@/lib/actions/ride-threads'
import { groupMessages } from '@/lib/data/chat'
import { getRide } from '@/lib/data/rides'
import { getCurrentProfile } from '@/lib/data/profile'
import { getRideThread, getRideThreadMessages } from '@/lib/data/ride-threads'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import { useRideThreadStream } from '@/lib/realtime/useRideThreadStream'
import { RIDE_THREAD_MESSAGE_MAX_LENGTH } from '@/lib/validation/rides'
import type { RideThreadChatMessage } from '@/types'
import { useSwipeBack } from '@/lib/actions/navigate'

/**
 * One ride thread — `108`, PD-402, built from the same components the club's
 * thread screen uses rather than a copy of them.
 *
 * `Ride - Chat` (`2226:4999`) was the measured source for everything below the
 * header and **this change deletes that frame's screen**; what it measured —
 * the bubble runs, the day separators, the pinned composer — lives on in
 * `ChatThread` and `ChatComposer`, which are shared with the club and are not
 * this change's to alter. The header and the thread's title row are ours, there
 * being no v2 Threads frame in either domain.
 *
 * ## Who may be here, and how this screen knows
 *
 * It does not need to know. `108` gives a thread to the intersection of *can see
 * the ride* and *is on its crew*, so a rider outside either half reads zero rows
 * — and `getRideThread` answers `null`, which is a *decided* answer and reaches
 * `notFound()`. That is the same 404 a thread that never existed gets,
 * deliberately: distinguishing them would confirm a private club's ride
 * conversation exists to someone who may not see it.
 *
 * **So there is no "this is for the crew" state to draw here**, unlike the ride
 * plan, which is visible to riders who are not on the ride. The *list* screen
 * draws that prompt, because a rider can legitimately reach it and see nothing;
 * a single thread they may not read simply is not there.
 *
 * ## The empty thread is a designed state, not a failure
 *
 * Creation takes a title and no first message, so a thread with nothing in it is
 * reachable by construction. It draws its title, an empty-thread line and a
 * working composer.
 *
 * ## A one-sided conversation is also designed
 *
 * A blocked pair may both post here and each sees only their own messages —
 * `108` carries no block arm in either WITH CHECK, because refusing the insert
 * would disclose the block to the poster. Nothing on this screen may present
 * that as an error or a gap.
 *
 * ## `Back` goes to the ride's thread list
 *
 * No `?row=` anchor, unlike the club's thread screen: that parameter exists
 * because a club thread is reachable from five kinds of timeline row and the
 * rider has to land back on the one they left. A ride thread is reached from the
 * thread list and from the ride's own timeline, and PD-393 already gave the ride
 * `rideReturnTo` for the plan's arrow. Adding a second anchor scheme here would
 * be building the club's paging problem into a screen that does not have it.
 */
export default function RideThreadPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per thread — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <RideThreadScreen />
    </Suspense>
  )
}

function RideThreadScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const thread = useQuery(queryKeys.rides.thread(id), () => getRideThread(id))
  // Set the instant this screen's own delete succeeds — see `RideThreadOptions`'s
  // `onDeleted` header for why `router.replace` there is not enough on its own.
  // State rather than a ref: the render below reads it, and
  // `eslint-plugin-react-hooks`'s `refs` rule refuses a `.current` read during
  // render for exactly the staleness reason `useQuery.ts` documents.
  const [removedByThisScreen, setRemovedByThisScreen] = useState(false)
  const messages = useQuery(queryKeys.rides.threadMessages(id), () =>
    getRideThreadMessages(id)
  )
  // The ride, for the organizer's moderation right and for `Back`. Enabled only
  // once the thread has come back, because the ride id arrives with it.
  const rideId = thread.data?.ride_id
  const ride = useQuery(rideId ? queryKeys.rides.detail(rideId) : null, () =>
    getRide(rideId ?? '')
  )
  // Whose thread this is. Read under `profile.me()`, so on the common path — a
  // rider who arrived through their own ride — it is a cache hit rather than a
  // round trip. It decides whether the ⋯ row is drawn and nothing else; `108`
  // decides whether the delete succeeds.
  const me = useQuery(queryKeys.profile.me(), () => getCurrentProfile())

  const [sending, setSending] = useState<RideThreadChatMessage[]>([])

  // Read from the thread rather than the URL, because the URL names the thread
  // and not the ride. `/rides` while the thread is still arriving and after it
  // has failed — the same fallback the club's screen makes to `/clubs`.
  const backHref = rideId ? routes.ride(rideId) : '/rides'

  // PD-341: the edge swipe is a second route to the arrow beside it, so it goes
  // to the same place by construction — one value, read twice. The composer is a
  // textarea, which `declinesSwipeBack` refuses on its own, so the reply half is
  // unaffected.
  //
  // Above the `notFound()`, which throws during render: a hook past it runs on
  // the pass where the thread is still arriving and not on the one that decides
  // there is none.
  useSwipeBack(backHref)

  // `null` is decided — no such thread, or none this rider may see. `undefined`
  // is the effect not having answered yet, and 404ing on it would flash one on
  // every load. `removedByThisScreen` is the one exception: a `null` this
  // screen's own delete produced is not "no such thread" to the rider, it is
  // "gone, and you already saw the confirmation".
  if (thread.data === null && !removedByThisScreen) notFound()

  const isAuthor = !!thread.data && !!me.data && thread.data.author_id === me.data.id
  const isOrganizer = ride.data?.is_organizer === true

  return (
    <>
      <Header
        title={thread.data?.title}
        backHref={backHref}
        action={
          // Waits for all three: a menu drawn before the ride and the profile
          // land would offer the wrong row, or none, and then rewrite itself.
          //
          // **`canRemoveRideThread` is the gate rather than an unconditional
          // mount**, and that is required rather than tidy: with reporting
          // deferred (`proposal.md` Q4) the menu has exactly one conditional
          // row, so a crew member who is neither the author nor the organizer
          // would get a dots icon opening an empty sheet — which
          // `docs/reference/design-system.md` §The ⋯ options menu calls worse
          // than the icon's absence. The same expression decides both, so the
          // two cannot disagree.
          thread.data &&
          ride.data &&
          me.data &&
          canRemoveRideThread({ isAuthor, isOrganizer }) ? (
            <RideThreadOptions
              threadId={id}
              rideId={thread.data.ride_id}
              isAuthor={isAuthor}
              isOrganizer={isOrganizer}
              onDeleted={() => setRemovedByThisScreen(true)}
            />
          ) : undefined
        }
      />

      {/* Fixed to the viewport rather than scrolling under the shell's padding,
          like the club thread: a thread is a column that owns its own scrolling,
          with the composer pinned under it. */}
      <div className="pt-header fixed inset-0 flex flex-col">
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <RideThreadBody
            threadId={id}
            rideId={rideId}
            messages={messages}
            sending={sending}
            setSending={setSending}
            thread={thread}
          />
        </div>
      </div>
    </>
  )
}

function RideThreadBody({
  threadId,
  rideId,
  messages,
  sending,
  setSending,
  thread,
}: {
  threadId: string
  rideId: string | undefined
  messages: ReturnType<typeof useQuery<RideThreadChatMessage[] | null>>
  sending: RideThreadChatMessage[]
  setSending: React.Dispatch<React.SetStateAction<RideThreadChatMessage[]>>
  thread: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getRideThread>>>>
}) {
  const online = useOnlineStatus()
  const showBanner = useBanner()

  /**
   * Retire optimistic rows the server has confirmed — the club thread's own
   * pruning, for its own reason: rendering already hides them by id, but the
   * array would grow for the life of the screen and the hiding is only as
   * durable as the page-size window it checks against.
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
    // loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIdsKey, setSending])

  const refetchMessages = messages.refetch
  useRideThreadStream(
    // Not subscribed until the thread has resolved: a rider who may not read it
    // gets a correct and permanently silent channel — an open socket for
    // nothing.
    thread.data ? threadId : undefined,
    useCallback(() => refetchMessages(), [refetchMessages])
  )

  const send = useCallback(
    async (body: string, messageId: string): Promise<string | null> => {
      const optimistic: RideThreadChatMessage = {
        id: messageId,
        thread_id: threadId,
        // Unknown until the server row arrives, and never rendered: the design
        // draws no name on your own bubble, and `groupMessages` keys a `mine`
        // row on identity-as-rendered rather than on this column.
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

      const result = await sendRideThreadMessage(threadId, body, messageId, rideId)

      if (result.error) {
        // Withdrawn, not left dimmed for ever: a message must never be left
        // looking sent when it was not. The composer puts the text back in the
        // field. Offline lands here too, through the same refusal.
        setSending((current) => current.filter((message) => message.id !== messageId))
        return online ? result.error : "You're offline — that message was not sent."
      }
      return null
    },
    [threadId, rideId, setSending, online]
  )

  /**
   * A failed delete has to say so, and this is the one refusal on this screen
   * that cannot show itself.
   *
   * The neighbour above already does — `send` withdraws the optimistic row and
   * returns the reason. This one has no optimistic half to withdraw: the bubble
   * is a server row and simply stays. Discarding the `ActionState` therefore
   * leaves a rider who tapped Delete offline looking at the message they believe
   * they deleted, with nothing said — and they will believe it is gone.
   */
  const deleteMessage = useCallback(
    async (messageId: string) => {
      const result = await deleteOwnRideThreadMessage(messageId, threadId, rideId)
      if (result.error) {
        // Offline is reported as offline rather than as a refusal, matching
        // `send` — the RPC failing because there is no network is not the same
        // thing as the database declining, and only one of them is worth
        // retrying now.
        showBanner(
          online ? result.error : "You're offline — that message was not deleted.",
          'error'
        )
      }
    },
    [threadId, rideId, online, showBanner]
  )

  const markSeen = useCallback(
    // The id `MarkChatSeen` hands back, named to avoid shadowing the `thread`
    // prop above — the query, not an id.
    (id: string) => {
      if (!rideId) return
      void markRideThreadSeen(id, rideId)
    },
    [rideId]
  )

  const gate = combineQueries(thread, messages)

  if (gate.error) {
    return (
      <div className="px-4">
        {/* An error state with a retry, never an empty conversation — a thread
            that failed to load must not read as one nobody has written in. */}
        <ErrorState
          message={online ? undefined : "You're offline — try again once you're back."}
          onRetry={gate.refetch}
        />
      </div>
    )
  }

  // Gated on the data, never on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is nothing to draw.
  if (!thread.data || !messages.data) {
    return (
      <div className="px-4">
        <SkeletonList rows={4} />
      </div>
    )
  }

  // Regrouped over the list actually being drawn rather than reusing the flags
  // the read computed: an optimistic message changes whether the one before it
  // ends a run. See `groupMessages`.
  const serverIds = new Set(messages.data.map((message) => message.id))
  const shown = groupMessages([
    ...messages.data,
    ...sending.filter((message) => !serverIds.has(message.id)),
  ])

  return (
    <>
      {/* Below the gate rather than beside it, so "only somebody who can read
          this thread marks it read" is expressed by whether this is on the page.
          Keyed on the newest *server* message: an optimistic copy of your own
          send can never be unread for its own author, so keying on it would fire
          a write that changes nothing. */}
      <MarkChatSeen
        threadId={threadId}
        newestMessageId={messages.data[messages.data.length - 1]?.id}
        onMark={markSeen}
      />

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center motion-safe:animate-fade-in">
          <p className="text-base font-semibold text-foreground">No replies yet</p>
          <p className="text-sm text-muted">Say what you think and the crew will see it.</p>
        </div>
      ) : (
        <ChatThread
          messages={shown}
          className="motion-safe:animate-fade-in"
          onDeleteMessage={deleteMessage}
        />
      )}

      <ChatComposer
        onSend={send}
        maxLength={RIDE_THREAD_MESSAGE_MAX_LENGTH}
        placeholder="Message the crew"
      />
    </>
  )
}
