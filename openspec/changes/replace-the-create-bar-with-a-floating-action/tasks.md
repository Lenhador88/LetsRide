# Tasks — the create affordance becomes a floating action

**Read `design.md` before touching any of this.** Four of its findings change what the obvious
implementation would be:

1. **D2** — a floating action that reserves its clearance costs **more** vertical space than the bar
   it replaces (72px against 64px). The gain is horizontal. Do not write the change record's value
   sentence from the issue body.
2. **D3** — `resolveRideDetailActions` does **not** retire. It is reshaped, because the two controls
   still contend for the same pixels even though they no longer contend for the same slot. Deleting
   it puts the clearance condition back into the JSX, which is what it exists to prevent.
3. **D1** — the club detail's departure and the ride detail's are different classes. The ride detail
   contradicts **no** frame and can move first if the owner wants motion.
4. **D5** — the 44×44 floor is real but is **not** in `CLAUDE.md`; two primitives cite it as being
   there. Do not conclude from a grep of `CLAUDE.md` that there is no floor.

**T0 is a hard gate.** Q1 in `proposal.md` is the product owner's, has no default, and nothing below
group 1 may start without it — that is the issue's own *"the build must not pick one silently"*.
Q2 gates the ride detail only. Q3–Q7 all have stated defaults; build against the defaults and record
the assumption rather than waiting.

## 0. The gate

- [ ] 0.1 **Q1 answered by the product owner** — Figma-first (A) or recorded departure (B), or the
      split named at the end of Q1 (ride detail under B now, club detail under A later). Record the
      answer as a comment on PD-404 and in this file. **No code before this.**
- [ ] 0.2 **Q2 answered** — A (RSVP bar plus a lifted floating action), B (RSVP bar alone, the
      timeline `(+)` survives) or C (RSVP into the page body). Default **A** if the owner answers Q1
      and not Q2. Groups 4 and 5 branch on it.
- [ ] 0.3 If Q1 is **A**: hand the design work to `design-system` with an explicit owner ask for the
      Figma write — the floating action, its **elevation token** (the app has none), and the club
      detail's navigation-bar variant dropping 152 → 88. Wait for `figma:pull` before group 2.
- [ ] 0.4 If Q1 is **B**: open `docs/FIGMA-FIDELITY-TODO.md` entries for both screens **before**
      writing the components, naming the elevation value as invented rather than measured, and
      record on PD-404 that the club detail's departure is against a **shared component instance**
      (D1) rather than a screen.
- [ ] 0.5 Confirm no collision with the live `slot-1` territory before branching —
      `supabase/migrations/107_*`, `supabase/tests/rls_test.sql`,
      `openspec/changes/preserve-postcards-when-a-club-outlives-its-members/`,
      `docs/reference/schema.md`, `docs/reference/migrations.md`. This change touches none of them
      and adds **no** migration; if a build session later wants one, that is a different story.

## 1. Geometry — one token and one class, before any component

- [ ] 1.1 Add the control's size and offset tokens to `src/app/globals.css` beside
      `--navbar-action` and `--ride-rsvp-bar`, with the same `/* 16 + 40 + 8 */`-style arithmetic
      comment, so the number is auditable rather than typed.
- [ ] 1.2 Add a **new** clearance class for the floating pattern. Do **not** reuse or rename
      `.pb-navbar-action-extra` — it stays correct for the four `STICKY_ACTIONS` screens this change
      does not touch (D7), and one class serving two patterns makes the later conversion a
      search-and-replace across five files that all read the same.
- [ ] 1.3 Leave `/rides/explore`'s `.pb-navbar-action-extra` **exactly as it is**. It reserves 64px
      for a sticky action that is not in `STICKY_ACTIONS` — a real pre-existing defect (proposal
      finding 5), out of scope here, and not to be swept up by a CSS pass.
- [ ] 1.4 Verify the offset by rendering, not by reading: the control must sit under the navigation
      bar's layer and above the page, and must not be reparented by any ancestor transform.

## 2. The primitive — `src/components/ui/FloatingAction.tsx`

- [ ] 2.1 Presentational only. It takes its label, its icon, its action (an `href` or an `onClick`)
      and its offset as props. **No membership, crew, pathname or route knowledge** — the screen
      owns the gate (`create-affordance`: *the primitive decides nothing*).
- [ ] 2.2 Two shapes: **extended** (icon + visible label) and **plain** (icon only, accessible name
      required). Default to extended where the control carries the act's name (D6, Q6).
- [ ] 2.3 Hit area at least 44×44 CSS px. If the rendered box is smaller than the floor, extend the
      target with the invisible `::before` technique `Button` already uses rather than growing the
      drawn box.
- [ ] 2.4 Focus-visible ring matching the existing primitives; `active:` rather than `hover:` for the
      pressed state, because this is a touch surface and a stuck hover reads as a stuck selection.
- [ ] 2.5 **No new dependency.** Twelve runtime dependencies is the count and this does not move it —
      `node -p "Object.keys(require('./package.json').dependencies).length"`.
- [ ] 2.6 A component test pinning: the accessible name is present in both shapes, and the control
      renders nothing when its gate prop is not `true`.

## 3. Club detail

- [ ] 3.1 Rewrite `src/components/clubs/ClubCreateBar.tsx` as the floating control. **Keep the
      existing `ContextMenu`** and all three rows unchanged, each still carrying the club so the
      composer opens scoped and `backFromCreateScreen` returns (Q3 default, D4).
- [ ] 3.2 Keep the member gate exactly as it is — `isMember` from `club.data.viewer_role`, drawn only
      on `true`, never on `undefined`. Do **not** read `club_members.role`.
- [ ] 3.3 Rename the component if the bar name no longer describes it, and carry its docstring
      forward — the `STICKY_ACTIONS` reasoning, the no-`border-t` rule's history and the
      affordance-not-enforcement line are why the shape is what it is.
- [ ] 3.4 Swap the page's clearance class in `src/app/(app)/clubs/detail/page.tsx`, still gated on
      `isMember` so nothing is reserved for a control that is not drawn.
- [ ] 3.5 **Leave the section `(+)` and the empty-section create tiles alone** (PD-342, PD-312,
      PD-318). This story replaces the bar, not those.
- [ ] 3.6 Confirm the private-club branch is untouched: `ClubPreviewScreen` renders no control and
      issues no query that could return zero rows.

## 4. Ride detail — branches on Q2

- [ ] 4.1 Rewrite `src/components/rides/RideCreateBar.tsx` as the floating control, **one action,
      navigating directly**, keeping the *Add a photo* label visible (D6). No sheet until PD-402.
- [ ] 4.2 Reshape `src/lib/rides/bottom-slot.ts`. Same inputs `(canRsvp, canCreate)`; the return
      becomes `{ rsvpBar, floatingAction, clearance }`. Carry the docstring's argument forward and
      **add** D3's finding: the contest is now an offset rather than a slot, and PD-401's option D is
      made *unnecessary* rather than reopened.
- [ ] 4.3 Rewrite `src/lib/rides/__tests__/bottom-slot.test.ts` exhaustively over the four input
      combinations, asserting the clearance as well as the two booleans.
- [ ] 4.4 **Q2 = A**: the RSVP bar and the control coexist, the control lifted by the RSVP bar's
      height. Remove `timelineAdd`, remove `RideTimeline`'s `canAdd` prop and its `SectionHeader`
      `create` call, and record in the change that a 40×40 sub-floor target was retired (D5).
- [ ] 4.5 **Q2 = B**: leave `resolveRideDetailActions` semantically as it is — the control takes the
      slot only when the RSVP bar does not, and the `(+)` survives. Only the control's shape changes.
- [ ] 4.6 **Q2 = C**: PD-401's option D. Requires the frame decision for `2375:8771` as well as
      `2043:10604`, so it folds back into T0 rather than being taken here.
- [ ] 4.7 Keep the crew gate on `isCrew === true`, never on `!== false` — `undefined` must draw
      nothing.

## 5. Verification

- [ ] 5.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`.
- [ ] 5.2 `npm run walk` against DEV — **the only gate that renders anything**, and the only one that
      can see a control painted under the navigation bar or dropped onto a barless screen. Read
      `scripts/supabase-relay.mjs`'s header first; the walk mints its own rider and needs no
      credential.
- [ ] 5.3 Walk the two screens by hand in the four states the gate can be in: gate `undefined`, gate
      `false`, gate `true`, and read-failed. Confirm the control is absent in the first, second and
      fourth, and that clearance is reserved only in the third.
- [ ] 5.4 Scroll each screen to its last row and confirm the occlusion decision Q4 named is what
      actually happens.
- [ ] 5.5 Sheet behaviour on the club detail: Escape closes, the scrim closes, Tab stays inside,
      focus returns to the control, the page behind does not scroll. If Q3 went to expand-in-place,
      this is a **jsdom** test rather than a manual check.
- [ ] 5.6 **No `supabase/` file changed**, so no RLS assertion is owed and the `RLS Policy Tests` job
      does not run — confirm the diff rather than assuming it. `openspec/config.yaml`'s task rule
      pairs a migration with an assertion, and the pairing is satisfied by there being no migration.
- [ ] 5.7 `npm run docs:check` if any doc claim moved, and
      `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` because this change's artifacts
      cite sections of other documents by name, and moving a section is what breaks those.

## 6. Record

- [ ] 6.1 Comment on PD-404 with the Q1 and Q2 answers as taken, the defaults used for Q3–Q7, and
      **the corrected value sentence** — horizontal space, not vertical (D2).
- [ ] 6.2 If Q5 was answered "they must match", say so on the issue and **re-scope before writing
      code**: converting the four `STICKY_ACTIONS` screens changes the shared navigation component
      and is a different story, not an extension of this one.
- [ ] 6.3 `reviewer` on the final diff, before the PR. It did not write this and that is the point.
- [ ] 6.4 PR to **`development`**, merged in the same session; the story reaches `Deployed to DEV`
      when it is running there.
