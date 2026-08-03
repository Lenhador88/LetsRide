import { Button } from '@/components/ui/Button'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { getFeed } from '@/lib/data/postcards'

/**
 * The home screen. `/dashboard` used to hold this slot and has been deleted —
 * see docs/HANDOFF.md; the route had to exist before the redirect could move,
 * or login would land on a 404.
 *
 * Pagination is not wired up yet: `getFeed` is bounded at FEED_PAGE_SIZE and
 * accepts a `before` cursor, but whether the design pages or infinite-scrolls
 * is one of the unread questions in docs/FIGMA-FIDELITY-TODO.md. Showing a
 * bounded first page is the honest subset — it is correct as far as it goes,
 * and does not commit to an interaction the design has not been read for.
 */
export default async function PostcardsPage() {
  const postcards = await getFeed()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Postcards</h1>
        <Button href="/postcards/new" size="sm" className="w-auto">
          New postcard
        </Button>
      </div>

      {postcards.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-medium text-foreground">No postcards yet</p>
          <p className="mt-1 text-sm text-muted">
            Share a photo from your last ride and it will show up here.
          </p>
          <Button href="/postcards/new" size="md" className="mt-6">
            Post the first one
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {postcards.map((postcard) => (
            <PostcardCard key={postcard.id} postcard={postcard} />
          ))}
        </div>
      )}
    </div>
  )
}
