# Swiping down inside an open postcard closes it

> Linear **PD-475**. This file is the specification and the issue must not restate it.

## Why

`PostcardViewerDialog` (`src/components/postcards/PostcardViewer.tsx`) is the popup a postcard
opens into from every screen that shows one. It already closes on the Close button, on Escape
when it is the topmost dialog, on a route change, and on a tap whose `pointerdown` began on the
scrim above the panel (PD-339). It does **not** close on a drag that begins *inside* the panel —
over the photo, the caption or the comment thread — which is the one gesture every bottom sheet on
a phone answers. A rider reading a postcard has no way to pull it away; they have to find the
small Close button in the header.

**This must not undo PD-339.** That change made the panel stop short of the top on purpose,
leaving a strip of scrim above it, and taught the scrim to dismiss only a gesture that *began* on
it — a drag that starts inside the sheet and lifts on that strip is not a scrim tap. Answering
"closes from inside" for the first time must not turn that strip back into an accidental exit: a
gesture that begins inside the panel is judged by this change's own rules end to end, never
re-litigated as a scrim tap because it happened to end up over the strip.

## What Changes

- A downward drag that begins inside the panel, and is strong enough by distance or by a fast
  flick, closes the postcard. Direction and axis dominance are checked the same way `swipe-back.ts`
  already checks them for the horizontal "back" gesture (PD-341) — reused as a shape, not
  literally imported, because a dismiss has no left edge to avoid.
- **The scroller owns the gesture whenever it has anywhere to go.** The panel's body is
  `overflow-y-auto overscroll-contain`; a pull-down while `scrollTop > 0` scrolls the thread and
  nothing else, however far or fast it is dragged. Only once the scroller is back at its top does
  further downward travel arm the dismiss.
- A gesture that starts on a control — an input, a textarea, a button, a link, a `select`, or
  anything `contentEditable` — keeps its own behaviour (typing, a caret, a click) and is never
  read as the start of a dismiss.
- A gesture is refused outright while a nested dialog (the postcard's own overflow menu) is the
  topmost one, the same nesting rule Escape already follows.
- The panel visually follows the finger once armed, and eases back to rest on a drag that ends
  without qualifying.
- **`/postcards/detail` is explicitly out of scope, and stated as a decision rather than an
  oversight.** That route renders the same postcard full-screen rather than as a sheet over
  something else — there is no panel edge to pull and nothing underneath to reveal — it already
  answers a strong swipe right with a back navigation (PD-341, `useSwipeBack`), and a downward
  pull at the top of an ordinary page is the platform's own overscroll/pull-to-refresh idiom. Only
  the popup gets this gesture.

## Capabilities

### New Capabilities

- `postcard-viewer-dismissal`: every way the open-postcard popup may be closed by a rider's own
  gesture or keypress — the Close button, Escape, a tap that began on the scrim, and now a
  downward drag that began inside the panel — and the conditions under which each one does
  **not** fire. No spec currently owns any of this; the popup shipped (PD-316, PD-339) without one.

### Modified Capabilities

None. No existing `openspec/specs/` capability describes the postcard viewer dialog.

## Impact

| Touched | What |
|---|---|
| `src/lib/swipe-dismiss.ts` (new) | The pure decision — arm, release, and the control-chain opt-out. Modelled on `src/lib/swipe-back.ts`'s shape; no edge-zone test. |
| `src/components/postcards/PostcardViewer.tsx` | Pointer handlers on the panel; a `scrollTop`-aware arm; `isTopmost` hoisted so the drag guard can share it with the existing keyboard trap; the panel's transform and spring-back transition. |
| `src/lib/__tests__/swipe-dismiss.test.ts` (new) | Unit tests over the pure module. |
| `src/components/postcards/__tests__/PostcardViewer.dismiss.dom.test.tsx` (new) | jsdom component tests — real pointer events, a real scroller, a real nested-dialog check. |
| `supabase/**` | Nothing. No schema, no RLS, no migration — this is a client gesture over data the dialog already reads. |

No new dependency, no design-system component, no route. `Element.prototype.setPointerCapture`
does not exist in jsdom and is stubbed in the test file only, the same way `Element.prototype
.scrollIntoView` already is in `CountrySelect.test.tsx` and `ClubTimeline.test.tsx` — production
code calls it unconditionally, exactly as `PostcardDeck` already does for its own drag.
