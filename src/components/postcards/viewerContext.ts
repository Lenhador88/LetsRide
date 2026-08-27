'use client'

import { createContext, useContext } from 'react'

/**
 * The two contexts behind the postcard popup, and the hooks that read them —
 * split out of `PostcardViewer.tsx` so the graph has no cycle.
 *
 * The cycle is real rather than theoretical: the dialog renders `PostcardCard`,
 * which asks whether a viewer is mounted, and `PostcardMenu` inside it asks
 * whether it is the card *in* the viewer. Left in one file that is
 * `PostcardViewer → PostcardCard → PostcardMenu → PostcardViewer`. ES modules
 * survive it — every use is inside a component body, so nothing reads a binding
 * during evaluation — but "survives because no one moved a call to module
 * scope" is a trap rather than a design, and the same split is what `deck.ts`
 * already does for `PostcardDeck`.
 *
 * It buys something too: `PostcardStamp` needs only `usePostcardViewer`, and
 * importing it from here rather than from `PostcardViewer.tsx` keeps the
 * dialog — and the three `lib/data` reads it pulls in — out of the ride plan's
 * import graph until a rider actually opens one.
 */

/**
 * How anything drawing a postcard opens it. `null` where no provider is
 * mounted, which is a fallback the call sites honour rather than a state to
 * guard against — see `PostcardViewer`'s header.
 */
export const PostcardViewerContext = createContext<((postcardId: string) => void) | null>(null)

/**
 * Provided by `PostcardViewerBody` and by nothing else, so a component can ask
 * *"am I the card inside the popup"* rather than inferring it from the route.
 *
 * That question has one caller — `PostcardMenu`, whose hide/block/delete rows
 * have to take the rider somewhere once the postcard stops being readable — and
 * it exists because the menu's existing test, `pathname === '/postcards/detail'`,
 * is structurally false in there: the popup does not change the route, so the
 * menu reads whichever screen raised it. Left alone, deleting your own postcard
 * from the popup succeeded and then sat on "This postcard isn't available."
 * until the rider closed it by hand.
 *
 * A second context rather than a `close` added to the one above, because they
 * answer different questions: every card under `(app)` can *open* the viewer,
 * and exactly one card at a time is *inside* it.
 */
export const InsidePostcardViewerContext = createContext<(() => void) | null>(null)

/** The way in for anything that draws a postcard. `null` means no provider. */
export function usePostcardViewer() {
  return useContext(PostcardViewerContext)
}

/**
 * `null` unless this component is rendered inside the popup; otherwise the
 * function that closes it.
 */
export function useInsidePostcardViewer() {
  return useContext(InsidePostcardViewerContext)
}
