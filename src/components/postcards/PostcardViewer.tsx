'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { CloseIcon } from '@/components/icons/generated'
import { CommentForm } from '@/components/postcards/CommentForm'
import { CommentList } from '@/components/postcards/CommentList'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import {
  InsidePostcardViewerContext,
  PostcardViewerContext,
} from '@/components/postcards/viewerContext'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { getPostcardComments } from '@/lib/data/comments'
import { getCurrentProfile } from '@/lib/data/profile'
import { getPostcard } from '@/lib/data/postcards'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { postcardIdSchema } from '@/lib/validation/postcards'

/**
 * Opening a postcard is a **popup over wherever you were**, not a navigation —
 * product owner, 2026-08-27, asked of the ride Journal and then generalised in
 * the same breath: *"This should also be the behavior when we click on a
 * postcard in the homepage."*
 *
 * So the thread stops being somewhere a rider is *sent* and becomes something
 * drawn on top: the deck keeps its position and its swipe history, the ride plan
 * keeps its scroll, and closing puts the rider back exactly where they were with
 * no back-stack entry spent. That is the whole reason this is a dialog and not
 * `router.push` — a route change unmounts `PostcardDeck`, and the deck's
 * `dismissed` set is component state, so returning from the thread today
 * re-deals every card the rider had already swiped past.
 *
 * ## `/postcards/detail` stays, and is not the dialog's fallback
 *
 * The route keeps its own screen, unchanged. It is what a shared link opens —
 * `ShareButton` copies `routes.postcard(id)` and those URLs are already sitting
 * in people's messages (`src/lib/routes.ts` says so) — and a link that resolved
 * to "the home screen, with a dialog open" would need the dialog to be
 * URL-addressable, which is a router concern this app has no need to take on.
 * Two entry points, one body: the dialog and the route render the same three
 * reads and the same three components, which is why `PostcardViewerBody` below
 * is the shape they share rather than a copy.
 *
 * ## Why a context rather than a prop
 *
 * The card is drawn six levels down from anything that could own dialog state —
 * `PostcardDeck` → `PostcardCard` → `CommentsLink` — and it is drawn from five
 * different screens. Threading an `onOpen` through all of them means every
 * intermediate component grows a prop it does not use, and a screen that forgets
 * it silently keeps the old navigation.
 *
 * **`usePostcardViewer()` returns `null` where no provider is mounted, and the
 * call sites fall back to a link.** That is deliberate rather than defensive:
 * the provider sits in `(app)/layout.tsx`, so the one place a card renders
 * outside it is a test rendering `PostcardCard` on its own, and the honest
 * behaviour there is the anchor that was always there.
 *
 * Both contexts live in `./viewerContext` rather than here, because this file
 * renders `PostcardCard` and that card's own menu asks a question of the
 * viewer — see that file's header for the cycle and what the split buys.
 */
export function PostcardViewerProvider({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const pathname = usePathname()
  const [lastPathname, setLastPathname] = useState(pathname)

  // Stable, so every `PostcardCard` under this provider stays memo-comparable —
  // `PostcardCard` is memoised precisely because the deck re-renders at display
  // refresh rate through a swipe, and a context value rebuilt each render would
  // bust that comparison for all three visible cards on every `pointermove`.
  const open = useCallback((postcardId: string) => setOpenId(postcardId), [])
  const close = useCallback(() => setOpenId(null), [])

  /**
   * **A navigation closes the popup, and without this it does not.**
   *
   * The dialog holds two links that leave — the byline goes to the author's
   * profile and the club name to the club — and both land inside `(app)`, so
   * `AppLayout` is not remounted and this state survives. The rider ends up
   * reading a postcard laid over a screen they did not know they were on, and
   * Back then returns them to the previous screen with the popup still up.
   *
   * The route change is the only signal: nothing else distinguishes "the rider
   * followed a link out of the dialog" from "the rider is still reading it".
   * Stated the other way round, this is what keeps the header's promise that
   * closing puts them back exactly where they were — because by then they are
   * somewhere else.
   *
   * **Adjusted during render rather than in an effect**, which is React's own
   * documented shape for state that has to follow a changing input. An effect
   * runs after paint, so the popup would be drawn once over the screen the
   * rider has just arrived at — one frame of exactly the confusion this
   * removes — and it is what `react-hooks` flags as a cascading render. React
   * discards this pass and re-renders immediately instead; nothing below has
   * rendered yet, so nothing is thrown away.
   *
   * The tempting cheaper version — remembering which path the popup was opened
   * on and hiding it elsewhere — is wrong rather than merely different: going
   * to a profile and coming back to `/postcards` matches that path again, and
   * the popup springs back open around a postcard the rider closed by leaving.
   */
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setOpenId(null)
  }

  return (
    <PostcardViewerContext.Provider value={open}>
      {children}
      {openId && <PostcardViewerDialog postcardId={openId} onClose={close} />}
    </PostcardViewerContext.Provider>
  )
}

/**
 * The popup itself — a near-full-screen sheet over a `Grey/70%` scrim.
 *
 * **Portalled to `document.body` for the reason `ContextMenu` records at
 * length**, and it is the same reason rather than a copied habit: `PostcardDeck`
 * puts a `transform` on every card, which makes that card the containing block
 * for any `position: fixed` descendant — so a dialog opened from a card and
 * rendered in place would be 342px wide, anchored to the card, and painted
 * inside the card's stacking context. It is opened from a card on the home
 * screen, so this is the live case and not a hypothetical one.
 *
 * **z-55/56, deliberately UNDER `ContextMenu`'s 60/70.** The postcard's own
 * overflow menu opens from inside this dialog, and a sheet that painted beneath
 * the thing that raised it is unusable. `Banner` at 80 stays above both, which
 * is what lets a hide or a block confirm over a dialog that is closing.
 */
function PostcardViewerDialog({
  postcardId,
  onClose,
}: {
  postcardId: string
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Where focus was before the dialog opened, so it can go back there on close.
  const triggerRef = useRef<Element | null>(null)

  // Held in a ref rather than named as a dependency — `onClose` is stable here,
  // but the effect below also calls `.focus()`, and `ContextMenu` records what
  // re-running that costs: it yanks focus off whatever the keyboard user has
  // tabbed to.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    triggerRef.current = document.activeElement

    /**
     * **Whether this dialog is the one on top.**
     *
     * The postcard's own overflow menu opens a `ContextMenu` from inside here,
     * and both listen for Escape on `document` with no `stopPropagation`
     * anywhere. This one is registered first, so it also *runs* first: a single
     * Escape aimed at the sheet tore the whole popup down underneath it.
     *
     * The z-index half of this nesting was reasoned about and got the right
     * answer (55/56 under the sheet's 60/70); the keyboard half is the same
     * nesting and needed the same thought. Both portal to `document.body`, so
     * document order is open order and the last modal is the topmost one.
     *
     * It guards Tab as well as Escape, and must: while the sheet is open its
     * own trap owns the focus ring, and two traps fighting over it is the same
     * defect in a slower shape.
     */
    function isTopmost() {
      const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      return modals.length === 0 || modals[modals.length - 1] === panelRef.current
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopmost()) return

      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      // The scrim is a sibling rather than a wrapper, so nothing else stops Tab
      // walking the deck behind it — and the deck's own sr-only "Next postcard"
      // button is back there, one Tab from a rider advancing a feed they cannot
      // see.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled])'
      )
      if (!focusable?.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      /**
       * **Focus is on the panel itself on the very first keystroke**, because
       * the effect below focuses it — and the panel is `tabIndex={-1}`, so it
       * is not in `focusable` and matches neither end. Comparing only against
       * the two ends therefore never fired, never called `preventDefault`, and
       * let the browser walk Shift+Tab straight out of a portal appended at the
       * end of `document.body` into the page behind.
       *
       * That is not a corner: one Shift+Tab then Enter landed on the deck's
       * sr-only "Next postcard" button and advanced the feed behind a dialog
       * the rider cannot see through — verbatim the case the comment above says
       * this trap exists to stop. And once focus was outside, every later Tab
       * missed too, so the trap stayed inert for the rest of the dialog's life.
       *
       * So the wrap is driven by *is focus inside the panel* rather than by the
       * two ends alone, which also recovers focus that escaped some other way.
       */
      const inside = active instanceof Node && active !== panelRef.current &&
        panelRef.current?.contains(active)

      if (!inside) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
    // Keyed on the postcard rather than on nothing: opening a second postcard
    // from inside the first (a byline tap cannot, but a future control might)
    // must re-run the trap against the new content rather than leave it pointing
    // at an unmounted subtree.
  }, [postcardId])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[55] bg-scrim motion-safe:animate-fade-in"
        onClick={onClose}
        // A convenience for pointer users; Escape and the Close button are the
        // exits a keyboard user actually reaches, so this carries no role.
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Postcard"
        tabIndex={-1}
        className={
          // Not `inset-0`: the strip of scrim left at the top is what says this
          // is drawn over the screen rather than being a new one, and it is
          // where a thumb reaches to dismiss. Below `env(safe-area-inset-top)`
          // so the notch never eats the dialog's own header.
          'fixed inset-x-0 bottom-0 z-[56] flex flex-col overflow-hidden rounded-t-2xl bg-background outline-none ' +
          'top-[calc(max(0.5rem,env(safe-area-inset-top))+2rem)] motion-safe:animate-fade-in'
        }
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
          <h2 className="flex-1 pl-2 text-base font-semibold text-foreground">Post</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
          >
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>

        {/* The scroller, and the one thing separating this from the route: the
            page version scrolls the document, so its bottom padding comes off
            the nav bar. Nothing is behind this one, so it pays only the home
            indicator. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <PostcardViewerBody postcardId={postcardId} onClose={onClose} />
        </div>
      </div>
    </>,
    document.body
  )
}

/**
 * The postcard and its thread — the same three reads, the same three components
 * and the same gates as `/postcards/detail`, which is why the two agree about a
 * 404, a failure and a comment count without either having to remember to.
 *
 * **The reads are shared with that screen rather than duplicated**: both use
 * `queryKeys.postcards.detail(id)` and `.comments(id)`, so a rider who opens the
 * dialog and then follows a shared link to the same postcard gets it from cache,
 * and `addComment`'s existing `postcards.all()` invalidation moves both.
 *
 * **A postcard the viewer may not see renders as "not available", not as
 * `notFound()`.** The route can call `notFound()` because it owns the whole
 * screen; a dialog cannot without taking the screen behind it down with it. The
 * distinction it must preserve is the one `getPostcard` exists for — "no such
 * postcard" and "not yours to read" have to look identical, or the response is
 * an existence oracle for club-scoped photos — so both land on the same words.
 */
function PostcardViewerBody({
  postcardId,
  onClose,
}: {
  postcardId: string
  onClose: () => void
}) {
  // Before the reads, exactly as the route does it: a malformed id reaches
  // Postgres as a `uuid`, comes back 22P02 → 400 → a throw from `unwrap`, and
  // renders a "Try again" on something that can never succeed.
  const valid = useMemo(() => postcardIdSchema.safeParse(postcardId).success, [postcardId])

  const postcard = useQuery(valid ? queryKeys.postcards.detail(postcardId) : null, () =>
    getPostcard(postcardId)
  )
  const comments = useQuery(valid ? queryKeys.postcards.comments(postcardId) : null, () =>
    getPostcardComments(postcardId)
  )
  const profile = useQuery(queryKeys.profile.me(), getCurrentProfile)

  const gate = combineQueries(postcard, comments, profile)
  if (gate.error) return <ErrorState onRetry={gate.refetch} />

  if (!valid || postcard.data === null) return <PostcardUnavailable />

  // Gated on the data rather than on `isLoading` — see `combineQueries` for the
  // tick where `isLoading` is false and there is still nothing to draw.
  if (postcard.data === undefined || comments.data === undefined) return <SkeletonDetail />

  return (
    // The one place this context is provided, and it wraps the card rather than
    // the whole dialog so that only the postcard the popup is *showing* answers
    // "I am inside the viewer" — a future control elsewhere in the sheet should
    // not inherit a `close` meant for this card's menu.
    <InsidePostcardViewerContext.Provider value={onClose}>
    <div className="flex flex-col gap-4">
      {/* `linkToThread={false}`: the comment control would open the dialog that
          is already open, and the photo would re-open the postcard it is
          showing. Same reason the route passes it. */}
      <PostcardCard postcard={postcard.data} linkToThread={false} />

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
        <h3 className="text-base font-semibold text-foreground">
          {comments.data.length === 0
            ? 'Comments'
            : `${comments.data.length} ${comments.data.length === 1 ? 'comment' : 'comments'}`}
        </h3>

        {/* `profile` is in the error gate but not the loading one — it only
            decides which comments show a delete control, so holding the thread
            behind the least important of the three reads is the wrong trade. */}
        <CommentList
          comments={comments.data}
          viewerId={profile.data?.id}
          postcardAuthorId={postcard.data.author_id}
        />

        <CommentForm postcardId={postcard.data.id} />
      </section>
    </div>
    </InsidePostcardViewerContext.Provider>
  )
}

function PostcardUnavailable() {
  return (
    <p className="px-2 py-8 text-center text-sm text-muted">
      This postcard isn&apos;t available.
    </p>
  )
}
