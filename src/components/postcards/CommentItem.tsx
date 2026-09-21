'use client'

import { useState, useTransition } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { useBanner } from '@/components/ui/Banner'
import { deleteComment } from '@/lib/actions/comments'
import { reportPostcardComment } from '@/lib/actions/moderation'
import { formatRelativeTime } from '@/lib/utils'
import type { PostcardComment } from '@/types'

type CommentItemProps = {
  comment: PostcardComment
  /**
   * Whether to offer the delete control. Computed on the server from the two
   * rights 011's DELETE policy grants — your own comment, or any comment on a
   * postcard you authored — and it decides *display only*. `deleteComment`
   * re-checks both server-side, so a rider who forges this gets refused by the
   * database rather than by this prop.
   */
  canDelete: boolean
  /**
   * Whether to offer the report control — `123`, PD-454. Computed the same
   * defensive way as `canDelete`: `viewerId !== undefined && comment.author_id
   * !== viewerId`. `123`'s INSERT policy would accept a self-report too
   * (`design.md` D9), but a menu row is a display hint, never an
   * authorization, so it is simply not drawn for the comment's own author.
   */
  canReport: boolean
}

/**
 * One comment in the thread.
 *
 * Deleting is two-tap rather than immediate. A comment cannot be edited (011
 * has no UPDATE policy and no UPDATE grant — editing is deliberately not
 * designed), so deleting is the only way to take words back and it is
 * irreversible. An inline confirm is the smallest affordance that prevents a
 * mis-tap on a phone. The frame reads offline as of 2026-08-25 and draws no
 * delete affordance on a comment at all — it gives each item a `Reply` control
 * and a trailing heart — so this remains a registered guess, now against a read
 * frame rather than an unread one.
 * See docs/FIGMA-FIDELITY-TODO.md §Comments.
 *
 * **`Report` is inline text beside `Delete`, on the same 44px floor and
 * negative-margin pattern — `123`, PD-454, `design.md` D10.** No frame draws
 * either control (`docs/FIGMA-FIDELITY-TODO.md` §Postcard overflow menu,
 * registered beside the two entries already recording the same reporting
 * gap), so this reuses what the row already has rather than inventing a sheet
 * or an icon for a list that can run to fifty rows. One tap, a banner, no
 * confirm and no navigation — `PostcardMenu.onReport`'s shape — because
 * reporting changes nothing the reporter, the commenter or the postcard's
 * author can see.
 */
export function CommentItem({ comment, canDelete, canReport }: CommentItemProps) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()

  const username = comment.author?.username ?? 'Rider'

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await deleteComment(comment.id)
      if (result.error) {
        setError(result.error)
        setConfirming(false)
        return
      }
      // No local removal: deleteComment revalidates the thread, so the row
      // leaves the list when the server says it has. Hiding it here first would
      // be an optimistic delete of something that cannot be undone.
    })
  }

  function report() {
    startTransition(async () => {
      const result = await reportPostcardComment(comment.id)
      if (result.error) {
        showBanner(result.error, 'error')
        return
      }
      showBanner('Comment reported')
      // No navigation and no local change: reporting leaves the comment
      // exactly where it was, matching `PostcardMenu.onReport`.
    })
  }

  return (
    <article className={pending ? 'flex gap-3 opacity-60' : 'flex gap-3'}>
      <Avatar src={comment.author?.avatar_url} name={username} size="sm" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {/* Decision #7: the username is the identity everywhere a person is shown. */}
          <p className="text-sm font-semibold text-foreground">{username}</p>
          <time dateTime={comment.created_at} className="text-xs text-muted">
            {formatRelativeTime(comment.created_at)}
          </time>
        </div>

        <p className="text-sm whitespace-pre-line break-words text-foreground">{comment.body}</p>

        {(canReport || canDelete) && (
          <div className="flex items-center gap-3">
            {canReport && (
              <button
                type="button"
                onClick={report}
                disabled={pending}
                // 44px minimum touch target — the glove-friendly floor. The
                // negative margin keeps the visual row tight while the hit area
                // stays full size, `Delete`'s own trick below.
                className="-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-70"
              >
                Report
              </button>
            )}

            {canDelete &&
              (confirming ? (
                <>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={pending}
                    className={
                      (canReport ? '' : '-ml-1 ') +
                      'inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-semibold text-danger transition-colors hover:text-danger-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-70'
                    }
                  >
                    {pending ? 'Deleting…' : 'Confirm delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={pending}
                    className="inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={pending}
                  // 44px minimum touch target — the glove-friendly floor. The
                  // negative margin keeps the visual row tight while the hit area
                  // stays full size, the same trick LikeButton uses. Only applied
                  // when this is the row's first control — see `Report` above.
                  className={
                    (canReport ? '' : '-ml-1 ') +
                    'inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-70'
                  }
                >
                  Delete
                </button>
              ))}
          </div>
        )}

        {error && (
          <p role="status" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </article>
  )
}
