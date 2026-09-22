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
- [x] 2.4 `onPanelPointerMove` — while unarmed, re-baseline the start point for as long as
  `scrollerRef.current.scrollTop > 0`; once at the top, arm on `armsSwipeDismiss` and take pointer
  capture only at that point; while armed, track the finger into `dismissDy` (clamped at 0) and
  `preventDefault`.
- [x] 2.5 `onPanelPointerUp` — decide with `isSwipeDismiss`; close via the existing `onCloseRef`,
  or spring back to `dismissDy: 0`.
- [x] 2.6 `onPanelPointerCancel` — aborts exactly like `PostcardDeck`'s own cancel handler: never
  completes the gesture.
- [x] 2.7 The panel's transform (`translateY(dismissDy)`) and its `motion-safe:` spring-back
  transition, suppressed while `dismissing` is true so an active drag has no lag.
- [x] 2.8 No `touch-action` added anywhere on the panel — the scroller keeps its native vertical
  pan for as long as it has room, per `design.md`.

## 3. Component tests — jsdom, real `PointerEvent`s

- [x] 3.1 `src/components/postcards/__tests__/PostcardViewer.dismiss.dom.test.tsx`, header states
  why jsdom (real pointer events and a real scroll offset). Stub
  `Element.prototype.setPointerCapture` (absent in jsdom, called unconditionally in production —
  see `design.md`).
- [x] 3.2 Positive case: a strong downward pull from ordinary panel content, at `scrollTop === 0`,
  closes the popup.
- [x] 3.3 One continuous drag that starts while the scroller has room and reaches its top
  mid-gesture switches from scrolling to dismissing, measured from the point it ran out of room.
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

## 5. Close-out

- [x] 5.1 Commit the proposal/specs/design on their own, before any implementation commit.
- [ ] 5.2 Push the branch. No PR is opened by this session (out of scope per the brief).
- [x] 5.3 `/opsx:archive` this change as the final commit — synced the delta into
  `openspec/specs/postcard-viewer-dismissal/spec.md` and moved the directory under
  `openspec/changes/archive/2026-09-22-swipe-down-closes-a-postcard/`.
