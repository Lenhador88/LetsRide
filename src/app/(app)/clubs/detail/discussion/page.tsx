'use client'

import { Suspense, useCallback, useEffect, useState, useTransition } from 'react'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatThread } from '@/components/chat/ChatThread'
import { MarkChatSeen } from '@/components/chat/MarkChatSeen'
import { DeleteIcon, OptionsIcon } from '@/components/icons/generated'
import { Header } from '@/components/layout/Header'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SkeletonList } from '@/components/ui/Skeleton'
import {
  deleteClubDiscussion,
  deleteClubMessage,
  markClubDiscussionSeen,
  moderateClubDiscussion,
  sendClubMessage,
} from '@/lib/actions/club-discussions'
import { groupMessages } from '@/lib/data/chat'
import { getClub } from '@/lib/data/clubs'
import { getCurrentProfile } from '@/lib/data/profile'
import {
  getClubDiscussion,
  getClubDiscussionMessages,
} from '@/lib/data/club-discussions'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import { useClubDiscussionStream } from '@/lib/realtime/useClubDiscussionStream'
import { CLUB_MESSAGE_MAX_LENGTH } from '@/lib/validation/clubs'
import type { ClubChatMessage } from '@/types'

/**
 * One club discussion — the app's **second** live thread (`081`, PD-307), built
 * from the ride chat's own components rather than a copy of them.
 *
 * `Ride - Chat` (`2226:4999`) is the measured source for everything below the
 * header; the header itself and the thread's title row are ours, there being no
 * v2 Discussions frame.
 *
 * ## Who may be here, and how this screen knows
 *
 * It does not need to know. `081` gives a thread to the club's **members**, so a
 * rider who is not one reads zero rows — and `getClubDiscussion` answers `null`,
 * which is a *decided* answer and reaches `notFound()`. That is the same 404 a
 * thread that never existed gets, deliberately: distinguishing them would
 * confirm a private club's conversation exists to someone who may not see it.
 *
 * So, unlike the ride chat, there is no "this is for the crew" state to draw:
 * the ride is visible to a rider who is not on it, while a thread simply is not.
 *
 * ## The empty thread is a designed state, not a failure
 *
 * Creation takes a title and no first message (design.md §Thread creation), so a
 * thread with nothing in it is reachable by construction. It draws its title, an
 * empty-thread line and a working composer.
 *
 * ## A one-sided conversation is also designed
 *
 * A blocked pair may both post here and each sees only their own messages —
 * `081` carries no block arm in either WITH CHECK, because refusing the insert
 * would disclose the block to the poster. Nothing on this screen may present
 * that as an error or a gap.
 */
export default function ClubDiscussionPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per thread — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubDiscussionScreen />
    </Suspense>
  )
}

function ClubDiscussionScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const discussion = useQuery(queryKeys.clubs.discussion(id), () => getClubDiscussion(id))
  const messages = useQuery(queryKeys.clubs.discussionMessages(id), () =>
    getClubDiscussionMessages(id)
  )
  // The club, for the owner's moderation right and for `Back`. Enabled only once
  // the thread has come back, because the club id arrives with it.
  const clubId = discussion.data?.club_id
  const club = useQuery(clubId ? queryKeys.clubs.detail(clubId) : null, () =>
    getClub(clubId ?? '')
  )
  // Whose thread this is. Read under `profile.me()`, so on the common path — a
  // rider who arrived through their own club — it is a cache hit rather than a
  // round trip. It decides which of the two delete paths the ⋯ row takes and
  // nothing else; `081` decides both.
  const me = useQuery(queryKeys.profile.me(), () => getCurrentProfile())

  const [sending, setSending] = useState<ClubChatMessage[]>([])

  // `null` is decided — no such thread, or none this rider may see. `undefined`
  // is the effect not having answered yet, and 404ing on it would flash one on
  // every load.
  if (discussion.data === null) notFound()

  return (
    <>
      <Header
        title={discussion.data?.title}
        backHref={clubId ? routes.clubDiscussions(clubId) : '/clubs'}
        action={
          // Waits for all three: a menu drawn before the club and the profile
          // land would offer the wrong row, or none, and then rewrite itself.
          discussion.data && club.data && me.data ? (
            <DiscussionOptions
              discussionId={id}
              clubId={discussion.data.club_id}
              isAuthor={discussion.data.author_id === me.data.id}
              // `viewer_is_owner` is `clubs.owner_id`, NOT `viewer_role ===
              // 'owner'` — `moderate_club_discussion` gates on the column, and
              // an owner holding no roster row is a reachable state. Gating the
              // row on the role would hide it from exactly that owner.
              canModerate={club.data.viewer_is_owner}
            />
          ) : undefined
        }
      />

      {/* Fixed to the viewport rather than scrolling under the shell's padding,
          like the ride chat: a thread is a column that owns its own scrolling,
          with the composer pinned under it. */}
      <div className="pt-header fixed inset-0 flex flex-col">
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <ThreadBody
            discussionId={id}
            clubId={clubId}
            messages={messages}
            sending={sending}
            setSending={setSending}
            discussion={discussion}
          />
        </div>
      </div>
    </>
  )
}

function ThreadBody({
  discussionId,
  clubId,
  messages,
  sending,
  setSending,
  discussion,
}: {
  discussionId: string
  clubId: string | undefined
  messages: ReturnType<typeof useQuery<ClubChatMessage[] | null>>
  sending: ClubChatMessage[]
  setSending: React.Dispatch<React.SetStateAction<ClubChatMessage[]>>
  discussion: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getClubDiscussion>>>>
}) {
  const online = useOnlineStatus()
  const showBanner = useBanner()

  /**
   * Retire optimistic rows the server has confirmed — the ride chat's own
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
  useClubDiscussionStream(
    // Not subscribed until the thread has resolved: a rider who may not read it
    // gets a correct and permanently silent channel — an open socket for
    // nothing.
    discussion.data ? discussionId : undefined,
    useCallback(() => refetchMessages(), [refetchMessages])
  )

  const send = useCallback(
    async (body: string, messageId: string): Promise<string | null> => {
      const optimistic: ClubChatMessage = {
        id: messageId,
        discussion_id: discussionId,
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

      const result = await sendClubMessage(discussionId, body, messageId)

      if (result.error) {
        // Withdrawn, not left dimmed for ever: a message must never be left
        // looking sent when it was not. The composer puts the text back in the
        // field. Offline lands here too, through the same refusal.
        setSending((current) => current.filter((message) => message.id !== messageId))
        return online
          ? result.error
          : "You're offline — that message was not sent."
      }
      return null
    },
    [discussionId, setSending, online]
  )

  /**
   * A failed delete has to say so, and this is the one refusal on this screen
   * that cannot show itself.
   *
   * The two neighbours above and below already do — `send` withdraws the
   * optimistic row and returns the reason, and the thread's own delete banners
   * it. This one has no optimistic half to withdraw: the bubble is a server row
   * and simply stays. Discarding the `ActionState` therefore leaves a rider who
   * tapped Delete offline looking at the message they believe they deleted,
   * with nothing said — and they will believe it is gone.
   */
  const deleteMessage = useCallback(
    async (messageId: string) => {
      const result = await deleteClubMessage(messageId, discussionId)
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
    [discussionId, online, showBanner]
  )

  const markSeen = useCallback(
    (thread: string) => {
      if (!clubId) return
      void markClubDiscussionSeen(thread, clubId)
    },
    [clubId]
  )

  const gate = combineQueries(discussion, messages)

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
  if (!discussion.data || !messages.data) {
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
        threadId={discussionId}
        newestMessageId={messages.data[messages.data.length - 1]?.id}
        onMark={markSeen}
      />

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center motion-safe:animate-fade-in">
          <p className="text-base font-semibold text-foreground">No replies yet</p>
          <p className="text-sm text-muted">Say what you think and the club will see it.</p>
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
        maxLength={CLUB_MESSAGE_MAX_LENGTH}
        placeholder="Message the club"
      />
    </>
  )
}

/**
 * The thread's own ⋯ menu — deletion and nothing else.
 *
 * **No Edit row, and its absence is the enforcement rather than an omission.**
 * `081` grants no UPDATE and declares no UPDATE policy on either content table,
 * so a title cannot change; drawing an edit affordance would be a control that
 * always fails. The stated remedy for a thread a rider regrets is deletion and
 * re-creation.
 *
 * Two different writes behind one row, because they are two different rights:
 * an author deletes through `081`'s DELETE policy, while the **club owner** goes
 * through `moderate_club_discussion` — a `security definer` RPC, because RLS
 * filters a DELETE by what the caller may READ and an owner who blocked the
 * author cannot see the row, so a policy-arm delete would match zero rows and
 * report success.
 */
function DiscussionOptions({
  discussionId,
  clubId,
  isAuthor,
  canModerate,
}: {
  discussionId: string
  clubId: string
  isAuthor: boolean
  canModerate: boolean
}) {
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()

  // A sheet with no rows in it is worse than no control at all —
  // `ClubOptionsMenu`'s own rule, and here the sheet would be empty for every
  // member who is neither the author nor the owner.
  if (!isAuthor && !canModerate) return null

  function onDelete() {
    setOpen(false)
    startTransition(async () => {
      // The author's own delete first: it is the narrower right, and an owner
      // who also authored the thread reaches the same outcome through it.
      // `moderate_club_discussion` is the owner's path to somebody ELSE's
      // thread, and it must not be the path to their own — a definer function
      // is the wider hammer, so the policy is used wherever it suffices.
      const result = isAuthor
        ? await deleteClubDiscussion(discussionId, clubId)
        : await moderateClubDiscussion(discussionId, clubId)

      if (result.error) {
        showBanner(result.error, 'error')
        return
      }
      showBanner('Discussion deleted')
      // `replace`, not `push`: the thread this was invoked from no longer
      // exists, so Back must not return to a screen that now 404s.
      router.replace(routes.clubDiscussions(clubId))
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Discussion options"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Discussion options">
        <ContextMenuItem
          icon={<DeleteIcon className="h-6 w-6" />}
          variant="warning"
          onClick={onDelete}
        >
          Delete discussion
        </ContextMenuItem>
      </ContextMenu>
    </>
  )
}
