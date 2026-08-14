import { memo } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { LikeButton } from '@/components/postcards/LikeButton'
import { CommentsLink } from '@/components/postcards/CommentsLink'
import { ShareButton } from '@/components/postcards/ShareButton'
import { PostcardMenu } from '@/components/postcards/PostcardMenu'
import { cn, formatPostcardDate } from '@/lib/utils'
import type { Postcard } from '@/types'

type PostcardCardProps = {
  postcard: Postcard
  /**
   * False on `/postcards/detail`, where the card heads its own thread and the
   * comment control would otherwise link to the page it is already on.
   */
  linkToThread?: boolean
  /**
   * True in the deck, where the card is a fixed 342×448 slot and a long caption
   * has to scroll inside itself rather than push the action row off the bottom.
   *
   * False on the thread screen, where the card sits in normal flow and grows to
   * its content. The distinction is load-bearing, not cosmetic: `flex-1` with
   * `min-h-0` inside an auto-height column collapses to zero, so a filling
   * caption in a flow context would render the card with no caption at all.
   */
  fill?: boolean
}

/**
 * `v2 / Component / Postcard`, variant `Type=Home` — every dimension below is
 * measured from the committed snapshot, replacing the guesses this file used to
 * carry. `npm run figma -- tree "v2 / Component / Postcard"` reproduces them.
 *
 *   342×448 · 4px padding · 8px radius · 8px gap between rows
 *   photo 334×200 (5:3, not the 4:5 previously inferred), 4px radius
 *   caption row fills the remaining 140px
 *   actions row 52px: like / comment / share, options pushed right
 *
 * The card is #FAFAFA in Figma but its fill *style* is White/100. A 1.5%
 * difference is invisible and `bg-surface` keeps it on the token, so the token
 * wins; the 2px white inner stroke is invisible against it for the same reason
 * and is not reproduced.
 *
 * **The design's photo overlay carries city and country and the schema has
 * neither** — `postcards` has no location columns. The date is real and renders;
 * the location does not, rather than borrowing the author's profile location,
 * which is where they live and not where the photo was taken. Registered in
 * docs/FIGMA-FIDELITY-TODO.md.
 *
 * **Memoised, and it is the deck that needs it (PD-198).** `PostcardDeck`
 * writes the drag offset to state on every `pointermove`, so a swipe re-renders
 * the deck at up to display refresh rate — and without this each of those
 * renders reconciled all three visible cards, every `Avatar`, `LikeButton`,
 * `CommentsLink`, `ShareButton` and `PostcardMenu` among them. The deck passes
 * `postcard` straight through from its own `postcards` prop and `fill` as a
 * literal, so both are referentially stable through a drag and every one of
 * those renders now bails at the comparison.
 *
 * The alternative — writing the transform to the DOM imperatively and keeping
 * `dx` out of state — was built and reverted. React diffs `style` against the
 * *previous props*, never the DOM, so a below-threshold release re-rendered
 * with an unchanged `translateX(0px)` string, emitted no write, and left the
 * card stranded wherever the finger dropped it. Every drag that does not commit
 * — the common case — ended worse than before the fix, and nothing in this repo
 * could have seen it: `vitest.config.ts` is `environment: 'node'`.
 */
function PostcardCardComponent({
  postcard,
  linkToThread = true,
  fill = false,
}: PostcardCardProps) {
  const username = postcard.author?.username ?? 'Rider'

  return (
    <article
      className={cn(
        'flex flex-col gap-2 overflow-hidden rounded-lg bg-surface p-1',
        fill && 'h-full'
      )}
      style={{
        // Three stacked drop shadows, measured exactly: a neutral one below and a
        // cool/warm pair either side. The tint is what stops a white card on a
        // cream gradient reading as flat, and it is invisible if simplified to one.
        boxShadow:
          '0 4px 8px #00000014, -4px -2px 16px #00AAFF14, 4px 2px 16px #FF005514',
      }}
    >
      <div className="relative shrink-0 overflow-hidden rounded" style={{ aspectRatio: '334 / 200' }}>
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
            className="h-full w-full bg-background object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          // A signed URL that failed rather than an image that does not exist.
          // Saying so beats a broken-image icon.
          <div className="flex h-full w-full items-center justify-center bg-background px-6 text-center text-sm text-muted">
            This photo could not be loaded.
          </div>
        )}

        {/* 40px scrim, transparent to Grey/70%, so the date stays legible on a
            bright photo. Measured, including the 70% end stop. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{ background: 'linear-gradient(180deg, #00000000 0%, #000000B3 100%)' }}
        />
        <time
          dateTime={postcard.created_at}
          className="absolute right-2 bottom-1.5 text-2xs font-medium text-white"
        >
          {formatPostcardDate(postcard.created_at)}
        </time>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-3">
        <Avatar src={postcard.author?.avatar_url} name={username} size="xs" className="mr-1" />
        {/* Decision #7: the username is the identity everywhere a person is
            shown. There is no full_name column to fall back to. */}
        <span className="truncate text-xs font-semibold text-foreground">{username}</span>
        {/* club_id IS the audience — a club name here means club-members-only,
            its absence means the app-wide feed. */}
        {postcard.club?.name && (
          <>
            <span className="shrink-0 text-xs font-semibold text-foreground">&nbsp;in&nbsp;</span>
            <span className="truncate text-xs font-semibold text-foreground">{postcard.club.name}</span>
          </>
        )}
      </div>

      {/* `touch-none` here is NOT redundant with the deck's, and this is
          PD-224 — a swipe that starts on the caption is cancelled by the
          browser, so the card leans a few pixels and springs back.

          **Being a scroll container is what does it**, and the walk that
          decides an element's effective `touch-action` stops at one. So
          `PostcardDeck`'s `touch-none` on the front-card wrapper covers the
          photo, the byline and the action row and stops dead at this div's
          `overflow-y-auto`, where the value falls back to `auto` and any
          gesture is the browser's to claim. It claims, it fires
          `pointercancel`, and `onPointerCancel` returns the card to centre —
          correctly, per PD-221: a cancel aborts a gesture, it never completes
          one. The deck is not the thing that was wrong.

          Measured in Chromium 2026-08-14 on this card's own structure, five
          gestures, and PD-224 lists two candidate causes of which the first is
          wrong — worth keeping because it is the one anybody reaches for:

            as shipped               cancelled  (photo, identically: not)
            + user-select: none      cancelled  <- selectable TEXT is exonerated
            + overflow: visible      not        <- confirms: the container, not the text
            + touch-action: none     not        <- this line

          Vertical drift is not the trigger — 0px cancels exactly as 30px does —
          which is why the same swipe fails whether or not the rider keeps it
          level, and why a fix aimed at tolerating drift would have missed.

          `overflow: visible` also fixes it and is the wrong fix: the overflow
          is load-bearing (see `fill`), and clipping is what keeps the action
          row on the card. `touch-action: pan-y` is the tempting middle — the
          deck takes horizontal, the caption keeps vertical — and it is also
          wrong, because the browser picks the axis from the first few pixels,
          so a gesture that starts slightly vertical is claimed and this bug is
          back for exactly the riders who reported it.

          The cost is deliberate and small: on the front card of the deck a long
          caption no longer pans under a finger. Wheel and keyboard scrolling
          are untouched (neither is governed by `touch-action`), and tapping
          through to the thread renders the caption in full at `fill={false}`,
          where there is no swipe to compete with. */}
      <div className={cn('px-3', fill && 'min-h-0 flex-1 overflow-y-auto touch-none')}>
        <p className="text-sm whitespace-pre-line text-foreground">{postcard.caption}</p>
      </div>

      <div className="relative flex shrink-0 items-center gap-0 px-2 pt-1 pb-2">
        <LikeButton
          postcardId={postcard.id}
          likesCount={postcard.likes_count ?? 0}
          isLiked={postcard.is_liked ?? false}
        />
        <CommentsLink
          postcardId={postcard.id}
          count={postcard.comments_count ?? 0}
          linkToThread={linkToThread}
        />
        <ShareButton postcardId={postcard.id} />
        {/* The design closes this row with the overflow menu, pushed right. */}
        <div className="ml-auto">
          <PostcardMenu
            postcardId={postcard.id}
            authorId={postcard.author_id}
            authorName={username}
            isOwn={postcard.is_own ?? false}
          />
        </div>
      </div>
    </article>
  )
}

export const PostcardCard = memo(PostcardCardComponent)
