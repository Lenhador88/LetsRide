import { CommentItem } from '@/components/postcards/CommentItem'
import type { PostcardComment } from '@/types'

type CommentListProps = {
  comments: PostcardComment[]
  /** The signed-in rider, or undefined if the session went away mid-render. */
  viewerId: string | undefined
  /** The postcard's author, who may remove any comment on their own photo. */
  postcardAuthorId: string
}

/**
 * The thread, oldest first — `getPostcardComments` orders it that way because a
 * photo's comments read as a conversation from the top, unlike the feed itself.
 *
 * There is no filtering here. 011's SELECT policy delegates a comment's
 * visibility to its postcard, so a comment from a rider the viewer blocked
 * never arrives in the first place; re-checking would be a second copy of a
 * rule RLS owns and free to drift from it.
 */
export function CommentList({ comments, viewerId, postcardAuthorId }: CommentListProps) {
  if (comments.length === 0) {
    return (
      <p className="py-2 text-sm text-muted">
        No comments yet. Be the first to say something.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          // The two rights 011's DELETE policy grants, evaluated once on the
          // server. `viewerId` being undefined must not make this true, which is
          // why the postcard-author arm compares against it rather than the
          // other way round.
          canDelete={
            viewerId !== undefined &&
            (comment.author_id === viewerId || postcardAuthorId === viewerId)
          }
        />
      ))}
    </div>
  )
}
