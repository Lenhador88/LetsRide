import { memo } from 'react'
import Link from 'next/link'
import { LocationOutlineIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { LikeButton } from '@/components/postcards/LikeButton'
import { CommentsLink } from '@/components/postcards/CommentsLink'
import { ShareButton } from '@/components/postcards/ShareButton'
import { PostcardMenu } from '@/components/postcards/PostcardMenu'
import { usePostcardViewer } from '@/components/postcards/PostcardViewer'
import { routes } from '@/lib/routes'
import { cn, countryFlagEmoji, formatPostcardDate } from '@/lib/utils'
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
 * **The design's photo overlay draws `flag · City, Country`; this draws
 * `flag · name`.** `taken_place_name` (`072`, PD-279's town half) is vendor
 * text stored as one string rather than a city/country pair, so there is no
 * comma to draw — the flag comes from `taken_country_code` (`074`, PD-279's
 * flag half) instead of the design's traced `Element / Flag` SVG, built as a
 * regional-indicator emoji the same way `lib/countries.ts` already does for
 * the profile picker. Neither ever borrows the author's profile location,
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
  // `null` for a typed-and-never-picked town, which has no vendor country
  // behind it at all — the pin icon below is what that state falls back to,
  // matching what this card drew before PD-279's flag half existed.
  const flag = countryFlagEmoji(postcard.taken_country_code)
  // `null` outside `(app)` — see `PostcardViewer`. `linkToThread` is what the
  // popup and the thread screen already pass to silence the comment control,
  // and it means the same thing here: do not offer a way into the thread this
  // card is already heading.
  const openPostcard = usePostcardViewer()
  const canOpen = linkToThread && openPostcard !== null

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
        {/* Bottom left, against the date's bottom right (PD-279). Capped at
            half the width so a 200-character vendor name truncates instead of
            running under the date — the column is bounded at 200, not at
            something that fits.

            Drawn on a name alone, and what makes that safe differs by mode:
            under `place` the CHECK requires one, so the name IS the rider's
            choice by construction; under `precise` `073` leaves it optional
            and explicitly "cosmetic", so what makes it theirs is that
            `PlaceSearchField` stays mounted in every mode and the value is on
            screen when they post. **The second half is a property of the
            composer, not of the schema** — a change that hides that field puts
            an auto-filled vendor locality on a card nobody read. Hide is the
            arm where every capture column is NULL, so it draws nothing either
            way.

            `bg-scrim` rather than the 40px gradient behind it, and that is a
            contrast fix rather than styling. The gradient reaches only
            `#000000B3` at the very bottom edge: at this text's own height it is
            ~0.37–0.54 alpha, so `White/100` measures **2.58:1 at the glyph top**
            over a bright photo — below AA, and below even 3:1. `Grey/70%`
            bounds the composite at `#4C4C4C` however bright the photo is, which
            is 8.59:1, and it is the instrument `RideMap` already uses for the
            one other place this app puts text over rider imagery. */}
        {postcard.taken_place_name && (
          <span className="absolute bottom-1.5 left-2 flex max-w-[50%] items-center gap-1 rounded bg-scrim px-1.5 py-0.5 text-2xs font-medium text-white">
            {/* The design's `Element / Flag` — a country flag ahead of the town,
                never the location pin (`v2 / Component / Postcard`'s `Location`
                frame). Built as the regional-indicator pair `lib/countries.ts`
                already uses for the profile picker rather than as ~40 traced
                SVGs — same trade, same doc note (docs/FIGMA-FIDELITY-TODO.md
                §Countries). Falls back to the pin for a typed-and-never-picked
                town, which has no vendor country behind it to draw a flag for. */}
            {flag ? (
              <span aria-hidden="true" className="shrink-0 leading-none">
                {flag}
              </span>
            ) : (
              <LocationOutlineIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            {/* The icon (or flag) is decorative, so without this a screen reader
                hears a bare place name between the photo's alt text and the
                date, with nothing saying what it is. */}
            <span className="sr-only">Taken in</span>
            <span className="truncate">{postcard.taken_place_name}</span>
          </span>
        )}

        {/* The same pill, for the same measurement: this text has always had
            the caption's problem and shipped before anyone computed it. */}
        <time
          dateTime={postcard.created_at}
          className="absolute right-2 bottom-1.5 rounded bg-scrim px-1.5 py-0.5 text-2xs font-medium text-white"
        >
          {formatPostcardDate(postcard.created_at)}
        </time>

        {/* Tapping the picture opens the postcard as a popup — product owner,
            2026-08-27: *"This should also be the behavior when we click on a
            postcard in the homepage."*

            **An overlay rather than the wrapper becoming a `<button>`**, and
            that is a deck constraint rather than a preference: this div is the
            positioning context for the scrim, the town pill and the date, and
            a `<button>` carries a UA `text-align`, `font` and `padding` reset
            that those three would then each have to undo. Last in the DOM so
            it is above them; they are text, so nothing interactive is buried.

            **Safe inside the swipe deck**, on the mechanism the byline link
            already documents: capture is taken on distance rather than at
            `pointerdown`, so a tap's `click` arrives intact, and a gesture that
            became a drag is swallowed by the deck's `onClickCapture` before it
            reaches this handler. `pointerdown` still bubbles from here to the
            deck's wrapper, so a swipe may start on the photo exactly as before.

            The photo's own `alt` is the caption, so this label names the action
            rather than repeating it. */}
        {canOpen && (
          <button
            type="button"
            onClick={() => openPostcard(postcard.id)}
            aria-label={`Open ${username}'s postcard`}
            className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-3">
        {/* The avatar and username are one link to the author's profile —
            `view-rider-profile`. Gated on `postcard.author` resolving rather
            than on the username string, matching the club link's own gate a
            few lines down: an author whose username is NULL is withheld by
            the profiles policy, so the byline falls back to plain text
            instead of a link to a screen that can only render not-found.

            Decision #7: the username is the identity everywhere a person is
            shown. There is no full_name column to fall back to.

            Safe inside the swipe deck for the same reason the club link
            below already is — see its own comment for the mechanism; only
            the destination changed. Drawn with no underline and no colour of
            its own, matching the design's one 12px semibold run. */}
        {postcard.author ? (
          <Link href={routes.profile(postcard.author.id)} className="flex items-center gap-0.5">
            <Avatar src={postcard.author.avatar_url} name={username} size="xs" className="mr-1" />
            <span className="truncate text-xs font-semibold text-foreground">{username}</span>
          </Link>
        ) : (
          <>
            <Avatar src={undefined} name={username} size="xs" className="mr-1" />
            <span className="truncate text-xs font-semibold text-foreground">{username}</span>
          </>
        )}
        {/* club_id IS the audience — a club name here means club-members-only,
            its absence means the app-wide feed.

            The name is a link to that club, and the `in` is deliberately NOT
            part of it: the club is the destination, the preposition is prose.

            **It is safe inside the swipe deck for the reason `CommentsLink`
            already is** — the deck takes pointer capture on distance rather
            than at `pointerdown` (`armsDrag`), so a tap is never retargeted and
            this anchor's click arrives intact, while a swipe that begins on it
            is swallowed by `onClickCapture`, which calls `preventDefault`
            precisely because an anchor's own navigation survives React's
            `stopPropagation`.

            Drawn exactly as the design draws it, with no underline or colour
            of its own. The frame gives this row one 12px semibold run and
            adding an affordance here would be inventing v2 rather than
            reading it. */}
        {/* Still gated on the NAME rather than on the club, unchanged: a club
            with no name to draw rendered nothing before this link existed, and
            it must not start rendering an empty tap target now. */}
        {postcard.club?.name && (
          <>
            <span className="shrink-0 text-xs font-semibold text-foreground">&nbsp;in&nbsp;</span>
            <Link
              href={routes.club(postcard.club.id)}
              className="truncate text-xs font-semibold text-foreground"
            >
              {postcard.club.name}
            </Link>
          </>
        )}
      </div>

      {/* `touch-none` here is NOT redundant with the deck's, and this is
          PD-224 — a swipe that starts on the caption is cancelled by the
          browser, so the card leans a few pixels and springs back.

          **Scrolling its overflow is what does it**, and the walk deciding an
          element's effective `touch-action` is reset at such an element. So
          `PostcardDeck`'s `touch-none` on the front-card wrapper covers the
          photo, the byline and the action row and stops dead at this div's
          `overflow-y-auto`, where the value falls back to `auto` and any
          gesture is the browser's to claim. It claims, it fires
          `pointercancel`, and `onPointerCancel` returns the card to centre —
          correctly, per PD-221: a cancel aborts a gesture, it never completes
          one. The deck is not the thing that was wrong.

          **Scrolls, not clips**: the `<article>` and the photo wrapper above
          are both `overflow-hidden`, a scroll container in the CSS sense, and
          the wrapper's `touch-none` reaches through both — see `./deck`, which
          carries the rule and the one gotcha in it.

          Measured 2026-08-14 in Chromium 1194, driving raw touch through CDP
          against a **standalone repro of this structure — not this component**;
          the shipped card is unverified here, and PD-222 is the standing gap
          (Chromium in this container cannot reach Supabase, so `/postcards`
          will not load). The repro was faithful and the mechanism is a
          browser's, not React's, but the target includes iOS WKWebView and this
          was Chromium. PD-224 lists two candidate causes and the first is
          wrong — kept because it is the one anybody reaches for:

            as shipped               cancelled  (photo, identically: not)
            + user-select: none      cancelled  <- selectable TEXT is exonerated
            + overflow: hidden       not        <- clipping alone does not reset
            + overflow: visible      not        <- confirms: the scroller, not the text
            + touch-action: none     not        <- this line

          Vertical drift is not the trigger — 0px cancels exactly as 30px does —
          which is why the same swipe fails whether or not the rider keeps it
          level, and why a fix aimed at tolerating drift would have missed.

          `overflow: hidden` also fixes it and is the wrong fix: it buys nothing
          this does not, and it silently drops the *desktop* wheel scroll that
          `touch-action` leaves alone. `touch-action: pan-y` is the tempting
          middle — the deck takes horizontal, the caption keeps vertical — and
          is also wrong, because the browser picks the axis from the first few
          pixels, so a gesture that starts slightly vertical is claimed and this
          bug is back for exactly the riders who reported it.

          **The cost is real and is not "small": a caption longer than the ~7
          lines this slot draws is now unreachable by finger on the deck.**
          `POSTCARD_CAPTION_MAX_LENGTH` is 2000, so that is reachable content,
          and the compensations are thinner than they look — wheel and keyboard
          are untouched by `touch-action` but neither exists on a phone, which
          is what this app is. The honest path is the tap-through to the thread,
          which renders it in full at `fill={false}` with no swipe to compete
          with, and which today has no affordance saying the caption continues.
          Registered as a product decision (line-clamp plus a "more" control)
          rather than left implied.

          `select-none` rides along, and on its own rationale rather than this
          one: the measurement above exonerates selectable text as the *cancel*
          cause, but `touch-action` does not govern selection at all, so a
          press-and-drag on caption text can still raise iOS's selection callout
          mid-swipe. Nobody selects caption text inside a swipe deck. */}
      <div className={cn('px-3', fill && 'min-h-0 flex-1 overflow-y-auto touch-none select-none')}>
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
