# Tasks — swipe down closes a postcard

## 1. The pure decision

- [x] 1.1 `src/lib/swipe-dismiss.ts` — `armsSwipeDismiss`, `isSwipeDismiss`, their constants, and
  `declinesSwipeDismiss` over a `SwipeDismissNode` structural interface, modelled on
  `swipe-back.ts`'s shape. No edge-zone test, no opt-out attribute, no scroller test (see
  `design.md` §Decisions for why each is absent rather than forgotten).
- [x] 1.2 `src/lib/__tests__/swipe-dismiss.test.ts` — the two ways to qualify (distance, flick),
  every refusal (upward, mostly-horizontal, resting too long, zero-duration), the arm slop, and
  `declinesSwipeDismiss` over every control tag plus `contentEditable`.
- [x] 1.3 Verify both ways: temporarily remove the axis-ratio guard in `isSwipeDismiss` and
  confirm the corresponding test goes red; restore and confirm green (byte-identical to the
  pre-break file via `diff`).

## 2. Wiring into `PostcardViewerDialog`

- [x] 2.1 Hoist `isTopmost` out of the keyboard-trap effect into a `useCallback([])` at component
  scope, and add it to that effect's own dependency array (stable identity, so no extra reruns).
- [x] 2.2 Add `scrollerRef` to the panel's scrollable body div.
- [x] 2.3 `onPanelPointerDown` — decline a mouse pointer, a non-primary pointer, a non-topmost
  dialog (`isTopmost`), and a gesture starting on a control (`declinesSwipeDismiss` over a real
  DOM `chain`); otherwise record the gesture's start.
- [x] 2.4 `onPanelPointerMove` — while unarmed, arm on `armsSwipeDismiss` measured from the ONE
  `pointerdown` start point and take pointer capture only at that point; while armed, track the
  finger into `dismissDy` (clamped at 0). **Superseded 2026-09-22** — see §6: `scrollTop` is
  checked once, at `pointerdown`, not re-sampled here; a version that re-sampled it here and let
  the gesture arm once it reached zero cannot exist on a real touch device.
- [x] 2.5 `onPanelPointerUp` — decide with `isSwipeDismiss`; close via the existing `onCloseRef`,
  or spring back to `dismissDy: 0`.
- [x] 2.6 `onPanelPointerCancel` — aborts exactly like `PostcardDeck`'s own cancel handler: never
  completes the gesture.
- [x] 2.7 The panel's transform (`translateY(dismissDy)`) and its `motion-safe:` spring-back
  transition, suppressed while `dismissing` is true so an active drag has no lag.
- [x] 2.8 No `touch-action` CSS added anywhere on the panel — the scroller keeps its native
  vertical pan for a gesture that starts with room to give. **Extended 2026-09-22** — see §6: a
  native, non-passive `touchmove` listener is what actually keeps the browser from claiming the
  touch once a gesture qualifies; `pointermove`'s own `preventDefault` does nothing for a touch pan.

## 3. Component tests — jsdom, real `PointerEvent`s

- [x] 3.1 `src/components/postcards/__tests__/PostcardViewer.dismiss.dom.test.tsx`, header states
  why jsdom (real pointer events and a real scroll offset). Stub
  `Element.prototype.setPointerCapture` (absent in jsdom, called unconditionally in production —
  see `design.md`).
- [x] 3.2 Positive case: a strong downward pull from ordinary panel content, at `scrollTop === 0`,
  closes the popup.
- [x] 3.3 **Rewritten 2026-09-22 (§6)** — was "one continuous drag switches from scrolling to
  dismissing"; now "never dismisses a gesture that started while the scroller had room, even if it
  reaches the top before release", pinning the corrected rule instead of the undeliverable one.
- [x] 3.4 A drag armed but released short of the threshold springs back (`transform` cleared).
- [x] 3.5 Negative — `scrollTop > 0` throughout: no dismissal however hard the pull.
- [x] 3.6 Negative — a gesture starting on a control (the Close button): no dismissal, and the
  control's own click still fires afterwards.
- [x] 3.7 Negative — a nested topmost dialog (simulated `[role="dialog"][aria-modal="true"]`
  appended above the panel): dismisses nothing underneath.
- [x] 3.8 Negative — an upward drag, including at a nonzero scroll position: closes nothing.
- [x] 3.9 Negative — a mostly-horizontal drag over the postcard `<article>`: closes nothing.
- [x] 3.10 Escape and the panel's `role`/`aria-modal`/`tabIndex` are unchanged.
- [x] 3.11 Verify both ways for the three component-level guards this suite alone can see
  (`scrollTop`, the control chain, `isTopmost`): break each one at a time, confirm its named test
  goes red, restore, confirm the file is byte-identical to before (`diff`) and green again.

## 4. Gates

- [x] 4.1 `npx tsc --noEmit` — clean.
- [x] 4.2 `npm run lint` — 0 errors, 10 pre-existing `<img>`/unused-var warnings in files this
  change does not touch.
- [x] 4.3 `npm run test:unit` — every test this change added or touched is green. This sandbox
  runs Node 26 against a repo pinned to 22.x (`.nvmrc`, `package.json` `engines`); 21 pre-existing
  failures under `src/lib/location/` and `src/lib/observability/` are Node 26's gated
  `globalThis.localStorage` and a moved `@sentry/capacitor` path, both already documented in
  `docs/reference/running-locally.md` §Node version and unrelated to `src/`/`src/lib/`
  touched by this branch.
- [x] 4.4 `npm run docs:check` — the jsdom component-test count (15 → 16) and its restatement in
  `docs/reference/running-locally.md` fixed in this branch. `CLAUDE.md`'s own component-test total
  (58 → 59) is reported rather than edited — agents do not write `CLAUDE.md`.
- [x] 4.5 `npm run build` (with the placeholder Supabase env pair `docs/reference/ci.md` names) —
  46 static routes, exit 0.
- [x] 4.6 `npx openspec validate swipe-down-closes-a-postcard --strict` — valid.

## 6. Post-review fixes — real Chromium touch input, not only jsdom

The reviewer drove raw touch through CDP (`Input.dispatchTouchEvent`) against real Chromium and
found the gesture never reached `pointerup` while armed: the browser claimed the drag as its own
pan and delivered `pointercancel` a few samples in, on every surface — including the header,
which has no scroller at all. jsdom cannot see this: it has no compositor and dispatches no
`pointercancel` of its own, so §3's suite was green against a defect real touch input reproduces
every time.

- [x] 6.1 `src/lib/swipe-dismiss.ts` — added `isDownwardVertical(dx, dy)`, the same
  direction-and-axis test as `armsSwipeDismiss` with no `SWIPE_DISMISS_ARM_PX` floor: a native
  `touchmove` listener has to answer before that slop clears, because Chromium's own pan-claim is
  faster than it (measured: committed within a few samples in the harness below).
- [x] 6.2 `PostcardViewer.tsx` — `onPanelPointerDown` now decides `scrollTop` ONCE, at
  `pointerdown` (`declines and never arms if > 0`), replacing the per-move re-baseline in §2.4.
  Reason: the component deliberately never suppresses the native scroll while `scrollTop > 0`, so
  the browser claims the touch and ends the sequence in `pointercancel` — there is no later
  `pointermove` in which a re-sampled `scrollTop` could ever be read.
- [x] 6.3 `PostcardViewer.tsx` — a native, non-passive `touchmove` listener added to the panel via
  `useEffect`/`addEventListener` (not a React prop, which cannot express `{ passive: false }`).
  Calls `preventDefault` once a gesture is armed, or — before arming — the instant
  `isDownwardVertical` says so, with no distance floor. This is what actually stops the pan;
  `onPanelPointerMove`'s own `preventDefault` is kept for what it DOES do (a mouse drag's text
  selection and phantom click) and its comment corrected to stop claiming it stops a touch pan.
- [x] 6.4 `onPanelPointerMove` — `state.startAt` is re-based to the moment of arming, not left at
  `pointerdown`'s timestamp: since `scrollTop` is now decided at `pointerdown` (6.2) rather than
  re-sampled, a thumb resting on the panel before pulling was spending
  `SWIPE_DISMISS_MAX_MS` on time nobody moved. Chosen over dropping the time cap entirely, because
  the cap's job — refusing a gesture the rider visibly paused mid-drag, not merely rested before
  starting — is still wanted once arming has begun.
- [x] 6.5 **Verified against the reviewer's own harness shape, in Chromium via CDP**, not only
  jsdom — `repro-fix.mjs` in the scratchpad, built on `repro.mjs`'s exact HTML/CSS and touch
  sequence. Before (settled harness, `repro.mjs`'s logic): every surface — the overflowing
  scroller, the non-overflowing one, and the header — arms then `CANCEL`s at `move20`. After (6.2
  + 6.3's logic): all three reach `UP armed=true dy=200`; the `scrollTop > 0` case correctly
  declines at `pointerdown` and never arms. Deterministic across 5 repeated runs. (A run
  immediately after `page.setContent` with no settle delay was flaky in both directions — the
  compositor had not yet established touch-handling regions — so `repro.mjs`'s own baseline was
  re-measured with the same 250ms settle added, rather than compared against a colder run.)
- [x] 6.6 Component suite: rewrote 3.3 (see its own line); added a positive case for a rest longer
  than `SWIPE_DISMISS_MAX_MS` before an otherwise-qualifying pull (pins 6.4); a `pointercancel`
  case (never closes, always springs back); a mouse-exclusion case; a long horizontal drag whose
  vertical travel alone would qualify (pins the axis-ratio check independently of the arm-slop
  floor the original horizontal case couldn't distinguish it from); a PD-339 case (a panel drag
  released over the scrim strip does not retrigger the scrim's own tap-to-dismiss); renamed the
  topmost-overlay case, which names Escape's nesting rule rather than PD-339. Every new or changed
  guard verified both ways (break, confirm red, restore, confirm `diff` clean and green).
- [x] 6.7 `openspec/specs/postcard-viewer-dismissal/spec.md` and this change's own delta spec both
  rewritten in step for the corrected scroller requirement — no drift between them.

## 7. Close-out

- [x] 7.1 Commit the proposal/specs/design on their own, before any implementation commit.
- [x] 7.2 Push the branch. No PR is opened by this session (out of scope per the brief).
- [x] 7.3 `/opsx:archive` this change as the final commit — synced the delta into
  `openspec/specs/postcard-viewer-dismissal/spec.md` and moved the directory under
  `openspec/changes/archive/2026-09-22-swipe-down-closes-a-postcard/`.
- [x] 7.4 Post-review fixes (§6) committed and pushed on the same branch, gates re-run green.
