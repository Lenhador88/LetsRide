# Tasks — the create affordance becomes a floating action (both details)

**Read `design.md` before touching any of this.** Six of its findings change what the obvious
implementation would be:

1. **D3** — `resolveRideDetailActions` does **not** retire and does **not** keep its inputs.
   `canRsvp` splits into `mayAnswer` + `answer`, and mutual exclusion is what replaces the old
   arbitration. Deleting the function puts the composition back into the JSX.
2. **D3** — `timelineAdd` is **dead**, measured, and the `(+)` it fed goes with it. The evidence is
   in `proposal.md`; do not re-derive it, and do not keep the fallback "just in case".
3. **D3** — since `103` the **organizer holds a real `going` row**, so a chip gated on the stored
   status alone draws for them. `mayAnswer` is what excludes them, and `RideDetail.attendance` must
   not be used for the gate: it folds the organizer in.
4. **D2** — a floating action that reserves its clearance costs **more** vertical space than the bar
   (80px at 56, 72px at 48, against 64px). **Nothing breaks even.** The gain is horizontal. Do not
   write the issue body's value sentence.
5. **D6** — the ride's control is the **≥ 2** case since `108`: its name is `Create`, not
   `Add a photo`. That label is no longer in the tree.
6. **D5** — the 44×44 floor is real but is **not** in `CLAUDE.md`; two primitives cite it as being
   there. It applies to the **chip** as much as to the control.

**There is no owner gate on this work.** PD-404's composition question was answered on 2026-09-06 and
the route is a **recorded departure**. **Q1 — the club detail — was answered the same day and IS now
in scope**: group 8 below is that half, and it is the last group because it depends on group 9's
offset fix rather than on anything in groups 1–7. Q3–Q8 have stated defaults; build against them and
record the assumption rather than waiting.

**Groups 0–7 are the RIDE half and shipped on 2026-09-06** (`d4fd70b`, PR #417); their boxes are
left as they were ticked. **Groups 8 and 9 are what remains**, and group 9 comes first in the
branch even though it is numbered last — see its own note.

## 0. Before any component

- [x] 0.1 Write the departure into `docs/FIGMA-FIDELITY-TODO.md` §Ride detail **before** writing the
      components, as **three** entries and with the class of each named: the floating action (an
      addition — `2375:8771` draws no create control), the status chip (an addition), and **the RSVP
      bar becoming conditional (a contradiction — the frame draws `Content / Ride Details / Join Ride
      Selector 390×96` stacked and unconditional)**. Do not repeat the retired zero-frame-cost line.
- [x] 0.2 Name the invented elevation value in the same entry. The design system has none —
      `grep -in "shadow\|elevation" design/TOKENS.md` → 0 — so this is the app's first persistent
      one and `design-system` owns replacing it when the frame catches up.
- [x] 0.3 Confirm the branch's territory: `src/components/ui/`, `src/components/rides/`,
      `src/lib/rides/`, `src/app/globals.css`, `src/app/(app)/rides/`, this change directory and
      `docs/FIGMA-FIDELITY-TODO.md`. **No migration and no `supabase/` file.**

## 1. Geometry and elevation — before any component

- [x] 1.1 Add the control's size, offset and **elevation** tokens to `src/app/globals.css` beside
      `--navbar-action` and `--ride-rsvp-bar`, each with the same `/* 16 + 40 + 8 */`-style
      arithmetic comment, so every number is auditable rather than typed.
- [x] 1.2 Add a **new** clearance class for the floating pattern. Do **not** reuse or rename
      `.pb-navbar-action-extra` — it stays correct for the four `STICKY_ACTIONS` screens (D7). **It
      is no longer correct for the club detail**, which group 8 converts; that screen swaps to the
      new class rather than the class changing meaning under the screens that still want a bar.
- [x] 1.3 **Leave `--ride-rsvp-bar` and `.pb-rsvp-bar-extra` exactly as they are.** The RSVP bar still
      reserves its 96px whenever it is drawn, including when the chip has reopened it. The offset an
      earlier revision designed — lifting the control by that token — is **deleted**: the two
      controls are mutually exclusive and nothing needs lifting.
- [x] 1.4 Leave `/rides/explore`'s `.pb-navbar-action-extra` alone. It reserves 64px for a sticky
      action `STICKY_ACTIONS` does not hold — a real pre-existing defect, filed as PD-407, not to be
      swept up by a CSS pass.
- [ ] 1.5 Verify the stacking by rendering, not by reading: the control sits under the navigation
      bar's `z-50` and above the page, and **is not reparented by an ancestor transform**. The ride
      detail's `RidePlan` wrapper carries `motion-safe:animate-fade-in`, so mount the control outside
      that subtree (D4).

## 2. The primitive — `src/components/ui/FloatingAction.tsx`

- [x] 2.1 Presentational only. It takes its label, icon, action (an `href` or an `onClick`) and its
      offset as props. **No membership, crew, pathname or route knowledge** — the screen owns the
      gate (`create-affordance`: *the primitive decides nothing*).
- [ ] 2.2 Two shapes: **extended** (icon + visible label) and **plain** (icon only, accessible name
      required). **Default to extended**, on hit area rather than on arity (D5, D6, Q6).
- [x] 2.3 Hit area at least 44×44 CSS px. If the rendered box is smaller than the floor, extend the
      target with the invisible `::before` technique `Button` already uses rather than growing the
      drawn box.
- [x] 2.4 Focus-visible ring matching the existing primitives; `active:` rather than `hover:` for the
      pressed state — this is a touch surface and a stuck hover reads as a stuck selection.
- [x] 2.5 Bottom-right (Q7), from a token rather than a literal inset, so the corner is one decision.
- [x] 2.6 **No new dependency** — `node -p "Object.keys(require('./package.json').dependencies).length"`
      is 12 before and after.
- [ ] 2.7 A component test pinning: the accessible name is present in both shapes, and nothing renders
      when the gate prop is not `true`.

## 3. The decision — `src/lib/rides/bottom-slot.ts`

- [x] 3.1 Reshape `resolveRideDetailActions` to the D3 signature: inputs
      `{ rideId, mayAnswer, answer, canCreate, reopened }`, return
      `{ bottomSlot: 'rsvp' | 'create' | null, statusChip: 'going' | 'maybe' | null, createOptions }`.
      **Delete `timelineAdd`.**
- [x] 3.2 The four rules, exactly: `rsvp` iff `mayAnswer && (answer === null || reopened)`; `create`
      iff `canCreate` **and** the bar is not drawn; `statusChip` non-null iff
      `mayAnswer && answer !== null`; `createOptions` non-empty iff **`bottomSlot === 'create'`**.

      **That last rule is tighter than the `iff canCreate` this task first carried, and the tighter
      one is what shipped.** The two differ only in the reopened state, where a crew member has no
      control drawn: `iff canCreate` would compute rows for a sheet nothing can open. Both satisfy
      *never an empty sheet behind a live control*, but only this one also carries the converse —
      rows existing exactly when something can open them — which is the form `108` (PD-402)
      originally stated and the form the test asserts in both directions.
- [x] 3.3 Carry the docstring's argument forward and **replace** its collision section. The contest
      is neither a slot nor an offset any more: the two controls are mutually exclusive by
      construction. **Do not leave "PD-401's option D is not taken" in the file** — D3 records that D
      is superseded for the answered rider on *both* of its reasons, and a stale sentence here is how
      an overreach gets into `src/`.
- [x] 3.4 Record the organizer trap in the docstring, at the input that carries it: `mayAnswer` is
      what excludes the organizer, `103` gives them a real `going` row, and `RideDetail.attendance`
      must not be used because it folds them in.
- [x] 3.5 Rewrite `src/lib/rides/__tests__/bottom-slot.test.ts` **exhaustively over the whole input
      space** (2 × 3 × 2 × 2 = 24 combinations), asserting all three outputs. Keep the named rows for
      the five states in `proposal.md`'s table, and keep the property tests:
      - **the bar and the floating action are never both drawn** — the new invariant, and the one the
        owner's design rests on;
      - **`createOptions` is non-empty iff `canCreate`**, both directions;
      - **the chip is never drawn when the bar is the resting state** (`answer === null`), and never
        for `mayAnswer === false`.
- [x] 3.6 Verify the test both ways, as this repo requires of any assertion. Mutate the
      implementation — drop the `!rsvpBar` conjunct from `create`, then gate the chip on
      `answer !== null` alone — and confirm each mutation goes red before reverting it.

## 4. The chip

- [x] 4.1 Build it in `src/components/rides/`, taking its value (`'going' | 'maybe'`) and an
      `onReopen` handler as props. It decides nothing — same rule as the primitive.
- [x] 4.2 **A control, not a badge**: a pill with a visible affordance — a chevron or equivalent —
      and at least 44×44 of hit area, extended with `::before` if the drawn box is smaller (D5). Once
      the bar is hidden this is the **only** route back to the answer.
- [x] 4.3 Place it on the **first line of the scrolling content, sharing that row with the club
      link** rather than taking a dedicated one (Q8) — a row for one chip costs vertical space on
      the screen this change is meant to give space back on. Draw the row only when it has a club or
      a chip in it, so an empty flex row does not consume the parent's `gap-4`. **Not in
      `RideHeader`** — that row is 40px, already carries back plus the threads button and the
      options menu, and adding to it changes `--header-height`, which every screen derives its top
      padding from.
- [x] 4.4 Its accessible name says what tapping does, not only what it shows — the value alone
      (`Going`) reads as a badge to a screen reader.
- [x] 4.5 It renders the viewer's **own** stored answer and never anyone else's. **Do not derive it
      from the `riders` embed or the crew rail**; those are block-filtered and truncated, and this is
      one row: `102`'s SELECT policy leads with `user_id = auth.uid()`, so the viewer's own row is
      always readable.

## 5. The screen — `src/app/(app)/rides/detail/page.tsx`

- [x] 5.1 Compute the resolver's inputs on the page: `mayAnswer = is_upcoming && !is_organizer`,
      `answer` = the **stored** status, `canCreate = isCrew === true`, `reopened` = local state.
      Nothing may be gated on `isCrew !== false` — `undefined` draws nothing.
- [ ] 5.2 `answer` needs the raw `ride_members.status`, and `RideDetail.attendance` is the folded
      field. Add the unfolded value to what `getRide` returns (`src/lib/data/rides.ts` already has
      `ownRow?.status` in hand) rather than un-folding it on the page — and **leave `attendance`
      itself alone**, because `RideAttendanceBar` and the ride card both read it as it is. Extend
      `src/lib/data/__tests__/rides.test.ts` for the new field, including the organizer case.
- [x] 5.3 Own `reopened` on the page, per D9's table: `true` on chip tap, `false` on a **successful**
      `going`/`maybe` answer, **unchanged on a failed one**, and not persisted across navigation.
- [x] 5.4 Add one optional success callback to `src/components/rides/RideAttendanceBar.tsx`, fired
      only when `setRideAttendance` returned no error. **Change nothing else about that component** —
      not its markup, its border, its `.bottom-navbar` offset, its optimistic rollback or its
      `role="status"` line. A failed answer must leave the bar open with its message readable.
- [x] 5.5 Rewrite `RideCreateBar.tsx` as the floating control: same `RideCreateSheet`, same two rows,
      same `Create` label (D6). Carry its docstring forward — the `STICKY_ACTIONS` reasoning, the
      no-`border-t` history and the affordance-not-enforcement line — and rename the component if
      `…Bar` no longer describes it.
- [x] 5.6 Drive the clearance off the same decision that draws the control: `.pb-rsvp-bar-extra` on
      `bottomSlot === 'rsvp'`, the new class on `'create'`, and **nothing on `null` or while
      `ride.data` is `undefined`**.
- [x] 5.7 Remove `RideTimeline`'s `canAdd` and `createOptions` props, its `SectionHeader` `create`
      call and the `RideCreateSheet` mounted beside it (`src/components/rides/RideTimeline.tsx`,
      ~lines 74–215), and drop the props at the call site. Record in the change that a **40×40
      sub-floor** target was retired.
- [x] 5.8 Leave `SectionHeaderCreate`'s `onClick` union arm in place with **no caller** — deleting a
      primitive's API is `design-system`'s. Note it in the PR so its caller-less state is recorded
      rather than rediscovered:
      `grep -rn "create={" src --include=*.tsx -A 3 | grep onClick` → 0 after this change.
- [x] 5.9 Confirm nothing else on the screen changes: the crew rail, the map, the attribution, the
      blurb, `RideThreadsRow` and the timeline's own contents are untouched.

## 6. Verification

- [x] 6.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`.
- [ ] 6.2 `npm run walk` against DEV — **the only gate that renders anything**, and the only one that
      can see a control painted under the navigation bar or reparented by a transform. Read
      `scripts/supabase-relay.mjs`'s header first; the walk mints its own rider and needs no
      credential.
- [ ] 6.3 Walk the ride detail by hand through the five compositions: **unanswered** (bar, no chip, no
      control), **answered Going** (chip + control, no bar), **chip tapped** (bar back, control gone),
      **answered No** (bar, no chip, no control, and the threads row gone — the rider is no longer
      crew), and **organizer / past ride** (control, never a chip, never a bar).
- [ ] 6.4 The failure path, by hand: go offline, tap an answer from the reopened bar, and confirm the
      bar **stays open**, the pill rolls back and the message is readable. This is D9's load-bearing
      row and no automated gate covers it.
- [ ] 6.5 The gate states: `ride.data === undefined`, the error state, and a non-crew reader.
      Confirm no control, no chip and **no clearance reserved** in the first two.
- [ ] 6.6 Scroll to the last timeline row and confirm the occlusion decision Q4 named is what actually
      happens.
- [ ] 6.7 Sheet behaviour from the floating control: Escape closes, the scrim closes, Tab stays
      inside, focus returns to the control, the page behind does not scroll.
- [x] 6.8 A **jsdom** test for the chip → bar → answer → chip cycle, including the failed-answer case,
      because a static render cannot dispatch a tap — the reason all five existing jsdom tests exist.
- [x] 6.9 **No `supabase/` file changed** — confirm the diff rather than assuming it, so the
      no-migration/no-assertion pairing in `openspec/config.yaml` is satisfied by there being no
      migration.
- [x] 6.10 `npm run docs:check` if any doc claim moved, and
      `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs`, because these artifacts cite
      sections of other documents by name.

## 7. Record

- [x] 7.1 Comment on PD-404 with what landed, the defaults taken for Q3–Q8, **the corrected value
      sentence** (horizontal space, not vertical), and the `timelineAdd` finding with its evidence.
- [x] 7.2 **Leave PD-404 open** after the ride half. The title names both screens and Q1 was
      unanswered at that point. Per `docs/reference/linear.md` §Sequencing, partly delivered means it
      stays open: the club half is not a new row and not a comment on a closed one. **Q1 has since
      been answered and group 8 is that half — PD-404 closes when it merges.**
- [ ] 7.3 `reviewer` on the final diff, before the PR. It did not write this and that is the point.
- [ ] 7.4 PR to **`development`**, merged in the same session; the story reaches `Deployed to DEV`
      when it is running there.

## 8. The club half — `ClubCreateBar` → the same floating action (Q1)

**Only the trigger moves.** The sheet, its three rows, their order, their icons, the
`Create in this club` label and the club-scoped route each carries are all unchanged, so
`backFromCreateScreen` and `CREATE_CLUB_PARAM` keep working untouched. Do **not** reopen PD-312,
PD-318 or PD-342 — this replaces the bar, not those decisions.

- [ ] 8.1 Write the departure into `docs/FIGMA-FIDELITY-TODO.md` under a new **§Club detail**
      heading **before** writing the component, and put the **26** in it. This is the largest
      departure the change makes and it is a different *class* from the ride's three: `2043:10604`
      instances `v2 / Component / Navigation / Bar` at 390×152 with `Button Container 358×56` as a
      child of that instance, and 27 frames instance the component at 152 — so this **deletes a
      drawn child of a variant 26 other frames share**, where the ride's departures were confined to
      one frame. A note on this screen alone is invisible to the other 26, which is why the count
      goes in the log rather than only in `design.md`.
- [ ] 8.2 Rename `ClubCreateBar` to the shape it now is. The file's whole docstring is an argument
      about a *bar* — the `STICKY_ACTIONS` approximation, the 358×40 primary, the absent `border-t`
      "so the two read as one bar" — and every sentence of it is about to become false. Rewrite it
      rather than editing around it; a docstring describing a bar on a circle is the comment trap
      being created deliberately.
- [ ] 8.3 Keep the member gate **byte-for-byte**: the control is drawn on the club detail's existing
      `isMember` (`!!club.data.viewer_role`), the same expression that drew the bar. No `role` read,
      no owner branch, and specifically **not** `private.is_club_member_for` — the spec's own
      scenario forbids substituting it, because the affordance must reflect the membership row the
      screen already reads.
- [ ] 8.4 The label is the **category**, not an act: arity is 3, so the arity rule gives
      `Create in this club` rather than a name for any one row. It is icon-only, so this is the whole
      of what a screen reader gets — a bare `Create` would say nothing about *where*.
- [ ] 8.5 **Move the page's reserved clearance with the bar.** `src/app/(app)/clubs/detail/page.tsx`
      applies `isMember && 'pb-navbar-action-extra'`; that 64px is the bar's geometry
      (16 + 40 button + 8) and is the wrong number for a 56px floating control. Leaving it behind
      gives the club timeline a **64px dead strip**, which is PD-407's defect arriving on a second
      screen. It becomes `.pb-floating-action-extra`, and it stays gated on `isMember` so no
      clearance is reserved for a control that is not drawn — the spec requires exactly that.
- [ ] 8.6 Confirm the club timeline's last entry is not permanently underneath the control, the
      negative case PD-404's issue names by hand. This is why the club opts into clearance at all;
      the floating action reserves none by default.
- [ ] 8.7 Sheet behaviour from the new trigger: Escape closes, the scrim closes, Tab stays inside,
      focus returns to the control, the page behind does not scroll. `ContextMenu` already owns all
      six and none of them is being rewritten — this is confirming the trigger swap did not drop the
      wiring.
- [ ] 8.8 Record the hit-area loss rather than discovering it, as the spec requires: a 358×40 bar
      target becomes a 56×56 circle. It clears the 44×44 floor and is still roughly a **6×**
      reduction, which "clears the floor" does not describe.
- [ ] 8.9 Confirm nothing else on the club detail changes — the rides strip, the member rail,
      `ClubTimeline`, `ClubOptionsMenu` and the non-member branch are untouched.

## 9. The shared primitive's offset — PD-423, and it is built FIRST

**Numbered last, built first.** It is a separate issue with its own commit, and group 8 depends on
it: converting the club onto a known-wrong offset ships the reported defect onto a second screen and
then fixes it twice.

- [x] 9.1 `FloatingAction` inherited `.bottom-navbar`, which is correct for a full-width bar and
      wrong for a circle. Measured in Chromium at 390×844 against the real compiled stylesheet: nav
      top y775, control bottom y776 — a **−1px** gap — with `--shadow-floating`'s two offsets both
      downward, so the shadow fell entirely on the tab bar.
- [x] 9.2 The tab row measures **56px exactly**, matching `--navbar-tabs`, which rules out the
      other candidate cause the issue offered (a nav rendering taller than the variable). What the
      variable misses is the nav's own `border-t` — the same exclusion `--header-height` makes for
      the header's `border-b` and `scroll-padding-top` adds back as `+ 1px`.
- [x] 9.3 `.bottom-floating-action` = `.bottom-navbar` + that 1px + a 16px gap, the same number as
      the control's `right-4` so it is inset equally from both chrome edges. Re-measured: **+16px**.
- [x] 9.4 `--shadow-floating`, `z-40`, the absent `border-t` and the 56px size are all unchanged.
      Raising the z-index would have hidden the overlap rather than fixed it, and the tabs must stay
      reachable.
- [x] 9.5 `--floating-action-clearance` is derived from the offset rather than restated, 80px → 81px,
      so a page's reserved space cannot drift from where the control sits.
