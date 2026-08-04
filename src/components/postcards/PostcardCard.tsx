import { Avatar } from '@/components/ui/Avatar'
import { LikeButton } from '@/components/postcards/LikeButton'
import { CommentsLink } from '@/components/postcards/CommentsLink'
import { formatRelativeTime } from '@/lib/utils'
import type { Postcard } from '@/types'

type PostcardCardProps = {
  postcard: Postcard
  /**
   * False on `/postcards/[id]`, where the card heads its own thread and the
   * comment control would otherwise link to the page it is already on.
   */
  linkToThread?: boolean
}

/**
 * One card in the feed.
 *
 * **Every dimension here is inferred, not read.** The Figma file is rate
 * limited, so the 29 Home frames could not be opened — image aspect ratio,
 * whether the image is edge-to-edge or inset, byline placement, and the
 * caption treatment are all defensible guesses drawn from the verified token
 * set (radius 12, spacing 16/8, Grey/80 for secondary text). Each one is an
 * unchecked box in docs/FIGMA-FIDELITY-TODO.md §Home / Postcards feed and must
 * be verified against the design before this is called finished.
 *
 * What is NOT inferred: the colours and type sizes, which come from the token
 * tables in CLAUDE.md §Design System.
 */
export function PostcardCard({ postcard, linkToThread = true }: PostcardCardProps) {
  const username = postcard.author?.username ?? 'Rider'

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-3 p-4">
        <Avatar src={postcard.author?.avatar_url} name={username} size="md" />
        <div className="min-w-0 flex-1">
          {/* Decision #7: the username is the identity everywhere a person is
              shown. There is no full_name column to fall back to. */}
          <p className="truncate text-sm font-semibold text-foreground">{username}</p>
          <p className="truncate text-xs text-muted">
            <time dateTime={postcard.created_at}>{formatRelativeTime(postcard.created_at)}</time>
            {/* club_id IS the audience — a club name here means club-members-only,
                its absence means the app-wide feed. */}
            {postcard.club?.name && <> · {postcard.club.name}</>}
          </p>
        </div>
      </header>

      {postcard.image_url ? (
        /* A signed URL that expires hourly. next/image would key its optimiser cache on a
           URL that changes every hour, so every render is a cache miss and the private
           bucket gets proxied through the optimiser for no benefit. Avatar does the same. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={postcard.image_url}
          // The caption is the only text the author wrote about the photo; when
          // there is none there is nothing truthful to describe it with, and a
          // generated guess would be worse than an empty alt for a screen reader.
          alt={postcard.caption ?? ''}
          // 4:5 portrait is the inferred ratio — it suits a phone-shot photo on a
          // 390px frame. Unverified; see the file comment above.
          className="aspect-4/5 w-full bg-background object-cover"
          loading="lazy"
        />
      ) : (
        // A signed URL that failed rather than an image that does not exist.
        // Saying so beats a broken-image icon.
        <div className="flex aspect-4/5 w-full items-center justify-center bg-background px-6 text-center text-sm text-muted">
          This photo could not be loaded.
        </div>
      )}

      <div className="flex flex-col gap-2 p-4">
        {/* items-start so LikeButton's error message pushes down rather than
            re-centring the whole row. */}
        <div className="flex items-start gap-1">
          <LikeButton
            postcardId={postcard.id}
            likesCount={postcard.likes_count ?? 0}
            isLiked={postcard.is_liked ?? false}
          />
          <CommentsLink
            postcardId={postcard.id}
            count={postcard.comments_count ?? 0}
            href={linkToThread}
          />
        </div>
        {postcard.caption && (
          // No line clamp: the design's truncation rule and "more" affordance are
          // unread, and inventing a clamp would silently hide a rider's words.
          // Showing the caption in full is the reversible choice.
          <p className="text-sm whitespace-pre-line text-foreground">{postcard.caption}</p>
        )}
      </div>
    </article>
  )
}
