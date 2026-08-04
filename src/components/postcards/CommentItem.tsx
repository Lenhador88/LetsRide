'use client'

import { useState, useTransition } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { deleteComment } from '@/lib/actions/comments'
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
}

/**
 * One comment in the thread.
 *
 * Deleting is two-tap rather than immediate. A comment cannot be edited (011
 * has no UPDATE policy and no UPDATE grant — editing is deliberately not
 * designed), so deleting is the only way to take words back and it is
 * irreversible. An inline confirm is the smallest affordance that prevents a
 * mis-tap on a phone; the design's own treatment is unread, so this is a
 * registered guess rather than a measurement.
 * See docs/FIGMA-FIDELITY-TODO.md §Comments.
 */
export function CommentItem({ comment, canDelete }: CommentItemProps) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

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

        {canDelete && (
          <div className="flex items-center gap-3">
            {confirming ? (
              <>
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending}
                  className="-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-semibold text-danger transition-colors hover:text-danger-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-70"
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
                // 44px minimum touch target — the glove-friendly floor. The
                // negative margin keeps the visual row tight while the hit area
                // stays full size, the same trick LikeButton uses.
                className="-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Delete
              </button>
            )}
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
