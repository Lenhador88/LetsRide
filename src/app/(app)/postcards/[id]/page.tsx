'use client'

import { notFound, useParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { CommentForm } from '@/components/postcards/CommentForm'
import { CommentList } from '@/components/postcards/CommentList'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { getPostcard } from '@/lib/data/postcards'
import { getPostcardComments } from '@/lib/data/comments'
import { getCurrentProfile } from '@/lib/data/profile'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { postcardIdSchema } from '@/lib/validation/postcards'

/**
 * One postcard and its thread — the screen `addComment` has been invalidating
 * since 011 shipped, before any route answered to the path.
 *
 * A postcard the viewer may not see comes back as null rather than an error
 * (`getPostcard` uses maybeSingle for exactly that reason), and this renders it
 * as 404. That is deliberate: "this club's postcard exists but is not yours to
 * read" and "no such postcard" must look identical from outside, or the
 * response becomes an existence oracle for club-scoped photos.
 *
 * Composition is inferred — the design's thread screen is one of the 29 Home
 * frames the Figma rate limit has kept shut. See docs/FIGMA-FIDELITY-TODO.md
 * §Comments.
 *
 * ## The three-way answer this screen needs, and why `null` is not `undefined`
 *
 * A `useQuery` result carries both, and conflating them turns a 404 into a
 * flash of one on every load. `undefined` is "the effect has not answered yet";
 * `null` is "answered, and there is nothing here you may see". Only the second
 * is `notFound()`. The server version had no such distinction — it awaited the
 * read, so there was no state in which the answer had not arrived.
 */
export default function PostcardThreadPage() {
  const { id } = useParams<{ id: string }>()

  // Before either read, not after: `id` reaches Postgres as a `uuid` and a
  // malformed segment comes back as 22P02 → 400 → a throw from `unwrap`, which
  // never reaches the `notFound()` below and renders the error boundary
  // instead — a "Try again" button on a URL that can never succeed.
  //
  // Expressed as `enabled` rather than an early `notFound()`, because hooks
  // cannot live behind a conditional return. A disabled query is exactly the
  // "must not fetch and must not throw" state `useQuery` documents for a null
  // key, so nothing is issued; the refusal happens below, past every hook.
  const valid = postcardIdSchema.safeParse(id).success

  const postcard = useQuery(valid ? queryKeys.postcards.detail(id) : null, () => getPostcard(id))
  // Issued alongside the postcard rather than after it, which means they are
  // issued even for a postcard that turns out to be invisible. That costs one
  // wasted query on a 404 and saves a round trip on every real load; RLS
  // returns an empty list in the wasted case, never someone else's thread.
  const comments = useQuery(
    valid ? queryKeys.postcards.comments(id) : null,
    () => getPostcardComments(id)
  )
  const profile = useQuery(queryKeys.profile.me(), getCurrentProfile)

  if (!valid) notFound()

  const gate = combineQueries(postcard, comments, profile)
  if (gate.error) return <ErrorState onRetry={gate.refetch} />

  if (postcard.data === null) notFound()
  if (postcard.data === undefined || comments.data === undefined) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
        <SkeletonDetail />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <Button href="/postcards" variant="link">
        Back to postcards
      </Button>

      <PostcardCard postcard={postcard.data} linkToThread={false} />

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-foreground">
          {comments.data.length === 0
            ? 'Comments'
            : `${comments.data.length} ${comments.data.length === 1 ? 'comment' : 'comments'}`}
        </h2>

        {/* `profile` is in the error gate but not in the loading one. It only
            decides which comments show a delete control, so holding the whole
            thread behind the least important of the three reads would be the
            wrong trade — a momentarily absent control is smaller than a
            momentarily absent thread. */}
        <CommentList
          comments={comments.data}
          viewerId={profile.data?.id}
          postcardAuthorId={postcard.data.author_id}
        />

        <CommentForm postcardId={postcard.data.id} />
      </section>
    </div>
  )
}
