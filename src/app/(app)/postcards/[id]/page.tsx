import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { CommentForm } from '@/components/postcards/CommentForm'
import { CommentList } from '@/components/postcards/CommentList'
import { getPostcard } from '@/lib/data/postcards'
import { getPostcardComments } from '@/lib/data/comments'
import { getCurrentProfile } from '@/lib/data/profile'

/**
 * One postcard and its thread — the screen `addComment` has been revalidating
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
 */
export default async function PostcardThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // The comments are fetched alongside the postcard rather than after it, which
  // means they are fetched even for a postcard that turns out to be invisible.
  // That costs one wasted query on a 404 and saves a round trip on every real
  // load; RLS returns an empty list in the wasted case, never someone else's
  // thread.
  const [postcard, comments, profile] = await Promise.all([
    getPostcard(id),
    getPostcardComments(id),
    getCurrentProfile(),
  ])

  if (!postcard) notFound()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <Button href="/postcards" variant="link">
        Back to postcards
      </Button>

      <PostcardCard postcard={postcard} linkToThread={false} />

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-foreground">
          {comments.length === 0
            ? 'Comments'
            : `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`}
        </h2>

        <CommentList
          comments={comments}
          viewerId={profile?.id}
          postcardAuthorId={postcard.author_id}
        />

        <CommentForm postcardId={postcard.id} />
      </section>
    </div>
  )
}
