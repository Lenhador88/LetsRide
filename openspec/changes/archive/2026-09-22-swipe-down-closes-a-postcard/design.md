## Context

See `proposal.md` for the motivation. Two existing pieces this design builds on rather than
replaces:

- `PostcardViewerDialog` (`src/components/postcards/PostcardViewer.tsx`) already tracks a
  `scrimArmed` ref from a document-level, capture-phase `pointerdown`, so it can tell a scrim
  *tap* from a drag that merely lifts over the scrim (PD-339). That mechanism is untouched.
- `src/lib/swipe-back.ts` already answers a structurally similar question for a horizontal
  gesture (PD-341) — "is this drag far enough, or fast enough, and dominant on the axis I care
  about" — as a pure module with a DOM-shaped structural interface (`SwipeBackNode`) so the
  decision itself can be unit-tested outside jsdom.

## Goals / Non-Goals

**Goals:**
- A downward drag starting inside the panel closes the popup, gated on distance/speed, vertical
  dominance, the panel's own scroll position, and dialog nesting.
- The panel visually tracks the finger once the gesture is plainly a dismiss attempt, and eases
  back to rest otherwise.
- The pure decision is unit-tested exactly the way `swipe-back.ts` is; the DOM wiring is
  jsdom-tested with real `PointerEvent`s and a real scrollable node.

**Non-Goals:**
- Any resistance/rubber-banding curve on the translate — it follows the finger 1:1, clamped at 0.
- A generic "any sheet in the app gets this gesture" mechanism. This wires one dialog.
- Changing `/postcards/detail`'s own gesture surface (PD-341's swipe-back stays as is).
- Retiring or restructuring `scrimArmed` — it answers a different question (did the gesture begin
  on the scrim) and stays exactly as it is.

## Decisions

**A pointer-events state machine on the panel, not a window listener.** `useSwipeBack` listens on
`window` because the back gesture belongs to a whole screen with no single node to wrap. This
gesture is scoped to one element — the panel — so its own `onPointerDown`/`onPointerMove`/
`onPointerUp`/`onPointerCancel` props are simpler and cannot fire for a gesture that never touched
the panel at all (an early, free win: a gesture starting on the scrim or on the deck behind it is
invisible to this code by construction, not by a guard).

**Two independent guards for direction and axis dominance — `armsSwipeDismiss` (at arm time) and
`isSwipeDismiss` (at release) — rather than one.** They ask different questions at different
moments: arming decides whether the panel should start visibly tracking the finger at all (so a
mostly-horizontal wobble never nudges it), and release decides whether accumulated travel commits
to closing. Both independently refuse an upward or mostly-horizontal gesture, which is
deliberately redundant — measured while building this: a version keeping only the release check
still refuses correctly, but a version keeping only the arm check does not, because a rider can
arm on a brief vertical lean and then travel mostly sideways before releasing. Belt and braces
here costs one more comparison, not a second vocabulary.

**No edge-zone test, and this is stated as a subtraction rather than an omission.**
`startsInEdgeZone` exists because a back gesture shares its screen with things that also want the
horizontal axis — a ride's strip of cards, `FilterTile` — so it only claims travel starting at the
screen's own edge. A dismiss has no such neighbour: the whole panel is fair game, and a rider's
thumb usually lands in the middle of the photo. Importing the edge test would refuse the ordinary
case.

**The scroller's `scrollTop` is read directly off the DOM node via a ref, not walked to like
`declinesSwipeBack` walks to a horizontal scroller.** There is exactly one scroller on this sheet
— the panel's own body — so the geometry-walk `declinesSwipeBack` needs (because ride strips can
appear anywhere in a screen) has no work to do here. Reading `scrollTop` is also the one part of
this feature that is inherently about a *live, mutable* DOM property rather than a fact fixed at
`pointerdown`, which is why it stays out of the pure module entirely (see `swipe-dismiss.ts`'s own
header).

**The arm/dismiss start point slides forward for as long as the scroller has room, rather than
being fixed at `pointerdown`.** A version measuring travel from the original `pointerdown`
throughout would arm the instant `scrollTop` reached zero mid-gesture, snapping the panel to
wherever the finger already was — a visible jump, and a false reading of how far the rider had
actually pulled *past* the point scrolling ran out. Sliding the reference point forward on every
move while the scroller still has room means the dismiss gesture's own distance is measured from
where it genuinely began.

**`declinesSwipeDismiss` carries no opt-out attribute and no scroller test, unlike
`declinesSwipeBack`.** The horizontal gesture needs an opt-out because a component can own that
axis through pointer handlers with no scrollable overflow for the geometry test to notice
(`PostcardDeck`). Nothing on this sheet owns the vertical axis that way, and the one scroller that
matters is handled by the `scrollTop` check above — so the control-chain test only needs tag names
and `isContentEditable`.

**`Element.prototype.setPointerCapture` is called unconditionally in production code, and stubbed
only in the test file.** jsdom does not implement it at all (measured: `el.setPointerCapture is
not a function`). `PostcardDeck` already calls it with no guard for its own horizontal drag, and
adding a defensive `?.()` here for a test-environment gap would be the inconsistency, not the
fix — `CountrySelect.test.tsx` and `ClubTimeline.test.tsx` already stub the equally-unimplemented
`Element.prototype.scrollIntoView` for the same reason.

**`isTopmost` is hoisted out of the keyboard-trap effect into the component body, as a
`useCallback` with no dependencies.** It used to be a function recreated inside that effect on
every `[postcardId]` re-run; the drag handlers need the identical check (the postcard's own
overflow menu absorbs a drag exactly as it already absorbs Escape) and duplicating the
`querySelectorAll` logic would be the one place this feature could drift from the keyboard rule it
is deliberately mirroring. `useCallback([])` rather than a plain function: it closes only over
`panelRef`, which is stable, so a fresh identity every render would buy nothing and would (if
named in the effect's dependency array, which `react-hooks/exhaustive-deps` requires once it is
referenced there) re-run that effect every render otherwise.

## Risks / Trade-offs

**[Risk] No real device or Chromium-with-Supabase exercise of the touch feel** (`overscroll-contain`
rubber-banding alongside the JS-driven translate, exact arm/release thresholds) → **Mitigation**:
the decision logic is unit-tested exhaustively and the DOM wiring is jsdom-tested end to end,
including the scroll-then-dismiss transition; the walk cannot exercise a drag gesture
(`CLAUDE.md`'s own note), so this is the ceiling available in this environment. Thresholds are
lifted from `swipe-back.ts`'s already-shipped values rather than invented, on the same population
of riders.

**[Risk] jsdom has no layout, so `scrollTop` is a plain settable number rather than a real,
clamped scroll offset** → **Mitigation**: the component reads `scrollTop` as a boolean fact
("more than zero or not"), never a magnitude, so the tests set it directly to exercise both states
without needing real layout.

## Migration Plan

None. No schema, no route, no new dependency, no flag. The gesture ships live the moment this PR
merges to `development`; nothing gates it.
