# Tasks — Explore asks where the rider rides from

**Read `design.md` before touching any of this.** Four of its findings change what the obvious
implementation would be:

1. **D1** — `nearLabel()` answers the literal `you` in two branches, so the new copy must take the
   **raw** `profiles.location` and reduce it with `localityOf` itself. Passing `nearLabel(...)?.name`
   through renders **`Still in you?`**.
2. **D2** — `ExploreRidesStrip.test.tsx` is **not** rewritten. The issue lists it; nothing in it
   references the row or the strip's props change.
3. **D4** — a **sixth** state (`confirm`), not a permission branch in the component.
4. **D6** — `JSON.parse('1')` succeeds and returns a number, so the guard validates the **shape**.

**There is no owner gate on this work.** The one open parameter was settled in `proposal.md` (30
days, doubling, capped at 180, reset on acting). Q1–Q4 there have stated defaults; build against them
and record the assumption rather than waiting.

**No migration and no `supabase/` file.** If a task starts to want one, stop — the whole change is
`localStorage`, a pure function, one component and four call sites.

## 0. Before any code

- [x] 0.1 Confirm the territory matches PD-447's marker: `src/lib/location/`,
      `src/components/location/`, `src/app/(app)/rides/`, `src/app/(app)/clubs/`,
      `src/lib/actions/profile.ts`, `src/lib/actions/auth.ts`, `src/components/push/PushPrimingRow.tsx`,
      `scripts/walk.mjs`, `docs/`, and this change directory. **`migration: N`, `primitive: N`.**
- [x] 0.2 Log the copy as a departure in `docs/FIGMA-FIDELITY-TODO.md`, **replacing** the existing
      entry near line 1935 (*"`UseMyLocationRow`'s two new labels — `Set where you ride from`…"*)
      rather than adding beside it. There is no Figma frame for this row or either sheet —
      `npm run figma -- ls` has no priming, permission or explainer frame — so `Still in Hoorn?` and
      `Where do you ride from?` are written, not measured, and must be recorded as such.
- [x] 0.3 Re-read `openspec/specs/client-render-shell/spec.md` §*A privacy control SHALL NOT render a
      guessed position* before writing the gate. This change widens the set of inputs the row waits
      for; it must not weaken that rule anywhere.

## 1. The dismissal ladder — `src/lib/location/dismissal.ts`

- [x] 1.1 **New file, and delete `src/lib/location/ask-once.ts`.** The name `ask-once` becomes a lie
      the moment the boolean does — this repo's comment trap, created deliberately if the file is
      edited in place instead of replaced.
- [x] 1.2 Key `letsride.location.dismissedQuestion`, value `{"at":<epoch ms>,"n":<int ≥ 0>}` as JSON.
      **`n` counts consecutive dismissals.**
- [x] 1.3 Export the interval as a **pure** function of the record and a `now` argument, so every
      case is testable without faking a clock:
      `quietFor(n) = min(30 days × 2 ** (max(n, 1) − 1), 180 days)` → 30, 30, 60, 120, 180, 180…
      Name the two constants (`QUIET_BASE_MS`, `QUIET_CAP_MS`) with the arithmetic in a comment, so
      neither number is typed twice.
- [x] 1.4 `isQuiet(record, now)` is true iff the record parses, `now >= at`, and `now < at + quietFor(n)`.
      **A record with `at > now` is treated as absent** — a device clock that moved backwards must
      not silence the question for ever.
- [x] 1.5 Validate the **shape**, not just the parse (D6): a non-null object, `at` a finite number,
      `n` a non-negative integer. Everything else — a throw, `null`, `1`, `"x"`, `[]`, a missing
      field — is *absent*, which fails **open**.
- [x] 1.6 `recordDismissal(now)` writes `{ at: now, n: previous + 1 }`, reading `previous` through
      the same validated parse so a corrupt record restarts the ladder at 1 rather than at `NaN`.
- [x] 1.7 `recordAnswered(now)` writes `{ at: now, n: 0 }` — quiet for the base interval with the
      ladder reset. `clearDismissal()` removes the key outright, for the grant and for sign-out.
- [x] 1.8 **Remove the retired key.** `clearDismissal()` also deletes `letsride.location.asked`, so a
      returning rider's device is not left carrying a value nothing reads. Never derive behaviour
      from its presence.
- [x] 1.9 Carry forward the two paragraphs of `ask-once.ts`'s header that are still true — why it
      persists per device rather than per session, and why every read and write fails open — and
      **rewrite** the paragraph about spending a once-ever ask, which is now false.
- [x] 1.10 Keep a `resetDismissalForTests()` seam matching `resetRiderLocationCacheForTests`.

## 2. The decision — `src/lib/location/priming.ts`

- [x] 2.1 Widen `LocationPrimingState` to
      `'hidden' | 'ask' | 'blocked' | 'town' | 'refine' | 'confirm'` (D4).
- [x] 2.2 Add two inputs: `town: string | null | undefined` (**raw** `profiles.location`;
      `undefined` is unsettled) and `quiet: boolean`. Return `hidden` while **any** of the four is
      unsettled, and `hidden` whenever `quiet` is true.
- [x] 2.3 **Lift the exclusion for the town half only.** Profile-sourced position with permission
      `denied` **or** `unavailable` → `confirm`. Profile-sourced with `prompt` stays `refine`.
      Nothing in `confirm` may reach the geolocation API.
- [x] 2.4 Keep `granted` → `hidden` in all three of its sub-states, and keep device-sourced +
      non-`granted` (the five-minute memo after a revocation) → `hidden`. Both are in the proposal's
      table with their reasons; write the reason at the branch, not in the header alone.
- [x] 2.5 Add the label function beside the state (D3 — **not** in `explore-label.ts` or
      `near-label.ts`): `refine`/`confirm` → `Still in ${localityOf(town)}?`, the other three visible
      states → `Where do you ride from?`. Reduce with `localityOf` **here**, the way
      `describeRiderLocation` does, and state in the header that `nearLabel()` must not be used and
      why (D1).
- [x] 2.6 Replace the header's PD-419 section with the reversal: what was removed, what was kept, and
      the accepted cost. A later session must not read the missing timer as an oversight.
- [x] 2.7 Rewrite `src/lib/location/__tests__/priming.test.ts` **exhaustively over the proposal's
      table** — every row, named. Assert the label as well as the state, including that no visible
      state ever renders `Still in you?` and that `confirm` never resolves to a device destination.
- [x] 2.8 **Verify the tests both ways.** Mutate the implementation — return `refine` instead of
      `confirm` for `denied`; drop the `town === undefined` guard; drop the `quiet` gate — and
      confirm each mutation goes red before reverting it.
- [x] 2.9 New `src/lib/location/__tests__/dismissal.test.ts`: the ladder's four rungs and its cap, a
      count above the cap, the reset, a `getItem` that throws, a `setItem` that throws, and each
      malformed value from 1.5 individually — `'1'` by name, since it is the retired value and it
      parses.

## 3. The component — `src/components/location/LocationQuestionRow.tsx`

- [x] 3.1 Rename `UseMyLocationRow` to `LocationQuestionRow` (file and export). The old name
      describes an offer the row no longer leads with.
- [x] 3.2 **Delete `auto`, `AUTO_ASK_DELAY_MS`, the timer effect and the `riderOpenedSheet` ref —
      with their headers** (D5). The latch has exactly one reader and it is the timer.
- [x] 3.3 `town` becomes a **required** prop typed `string | null | undefined`, raw. Its docstring
      says `undefined` is unsettled and draws nothing, and that it is the **column**, not
      `nearLabel`'s output.
- [x] 3.4 Add a `quiet`/dismissal read and hold the post-dismissal state locally too, so the row
      disappears in the same render as the dismissal rather than on the next mount.
- [x] 3.5 Route by state: `ask`/`refine` → `LocationPrimingSheet` `mode="ask"`; `blocked` →
      `mode="blocked"`; `town`/`confirm` → `TownQuestionSheet` directly. **No sheet copy changes.**
- [x] 3.6 Record a dismissal on **every** close without an answer — the sheet buttons, the scrim and
      Escape (Q2's default). Do **not** record one when `TownQuestionSheet` reports `onSaved`, and do
      not record one when a fix came back.
- [x] 3.7 On a fix: keep the existing pair — the resolver memo is overwritten and
      `invalidate(queryKeys.riderLocation())` is called — and add `clearDismissal()`.
- [x] 3.8 Keep the `refine` path's existing behaviour on a denial: the row re-renders as `confirm`
      rather than unmounting, which is a **change** from the comment in `onContinue` that says the
      row unmounts and takes the sheet with it. Rewrite that comment; it will be false.
- [x] 3.9 Keep the accessible name saying what tapping does, per the spec's scenario.
- [x] 3.10 Rewrite `UseMyLocationRow.dom.test.tsx` as `LocationQuestionRow.dom.test.tsx`: delete the
      six automatic-ask tests, keep the two-sheets-never-open-at-once test, and add a tap → dismiss →
      row gone test and a `confirm` → town-sheet test. **State in the header which of the four jsdom
      reasons it needs** — it is now an *event* and a *portal*, no longer a timer in a mounted
      effect.

## 4. The four call sites

- [x] 4.1 `src/app/(app)/rides/page.tsx` (~205) — delete the row and its comment block; the strip
      stays. Check whether `label` is still used by the strip (it is) before touching the read.
- [x] 4.2 `src/app/(app)/clubs/page.tsx` (~171) — same, including the `className="px-0"` wrapper
      argument, which goes with it.
- [x] 4.3 `src/app/(app)/rides/explore/page.tsx` (~110) — drop `auto`, pass `town={city.data}` raw,
      and **move the row outside the `rides.data` branch** (D7) so it renders during load and on the
      error path.
- [x] 4.4 `src/app/(app)/clubs/explore/page.tsx` (~120) — drop `auto`, pass `town={city.data}` raw.
      Its placement is already outside the list gate; make the two screens' placement identical and
      say so in one comment rather than two.
- [x] 4.5 Add a render assertion to the two tab roots' tests (or one new component test) that the
      strip slot holds exactly **one** row, in all three of the strip's states — the negative D2 asks
      for in place of a rewrite.

## 5. The writers

- [x] 5.1 `setRiderTown` in `src/lib/actions/profile.ts` calls `recordAnswered()` on success,
      beside its existing invalidations (D9) — **only when a town was STORED, never on the
      `null` clear path**, which is `LocationSetting.clear()` and leaves the rider in exactly the
      state the question exists to fix. **In the action, not in the sheets.** `setHomeTown` in
      `src/lib/actions/onboarding.ts` writes `profiles.location` too and carries the same call:
      the proposal's "only writer" was wrong, and the second route already existed.
- [x] 5.2 `signOut` in `src/lib/actions/auth.ts` calls `clearDismissal()` alongside
      `clearRiderLocation()` and `clearIntroductionDismissals()`. It is the **seventh** local clear;
      count them in the diff rather than trusting this sentence.
- [x] 5.3 Confirm `src/lib/actions/__tests__/writers-invalidate.test.ts` still passes and that
      nothing here writes a guard stamp — `setRiderTown` touches none of `terms_accepted_at`,
      `onboarding_completed_at` or `has_username`, so it owes no `invalidateOnboardingState()`.

## 6. The stale neighbours (D8)

- [x] 6.1 `src/components/push/PushPrimingRow.tsx` — its header says the location row draws on
      **three screens** (now two) and that `UseMyLocationRow` **has** an automatic ask (now none).
      Rewrite both sentences; the push row's posture is no longer the stricter one.
- [x] 6.2 `src/components/profile/LocationSetting.tsx` — its header names `UseMyLocationRow` as the
      one control that may prompt. Update the name and confirm the sentence stays true.
- [x] 6.3 `docs/reference/running-locally.md` line ~15 names `ask-once.test.ts` in the Node-26
      `localStorage` measurement, and line ~487 justifies the jsdom test as *"a timer inside a mounted
      effect"*. Update both. **Re-run the measurement's command against the renamed file** rather
      than editing the path under a number nobody re-derived.
- [x] 6.4 `scripts/walk.mjs` — delete `dismissLocationSheet()` and its three call sites (~3513,
      ~3737, ~4158). With no automatic ask it can never fire, it asserts nothing and it swallows its
      own failures, so it would sit in the walk reading as live. **`LOCATION_SHEETS` goes with it**;
      the comment in `TownQuestionSheet` that pairs its `label` with that constant must be updated in
      the same commit, since the pairing it warns about will no longer exist.

## 7. Verification

- [x] 7.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`.
- [x] 7.2 `npm run docs:check` and `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — these
      artifacts and the doc edits in group 6 cite files and sections by name.
- [ ] 7.3 `npm run walk` against DEV, with the relay (read `scripts/supabase-relay.mjs`'s header
      first). It mints its own rider, so it exercises the **no town, `prompt`, never dismissed** row
      — and it is the one gate that would catch a sheet still opening by itself.
- [ ] 7.4 By hand on DEV, the four states no automated gate reaches, using the two disposable
      fixtures in `docs/HANDOFF.md` §Test accounts: **no town + `prompt`**, **town + `prompt`**
      (`Still in <town>?`), **town + `denied`** (the lifted exclusion — the row draws and goes
      straight to the town sheet), and **`granted`** (no row at all).
- [ ] 7.5 By hand: dismiss, confirm the row leaves immediately and is still gone after a reload;
      then set the stored `at` back 31 days and confirm it returns. Then change the town and confirm
      the row goes quiet with `n` back to 0.
- [ ] 7.6 By hand, offline: open the town sheet, save, confirm the failure is readable, the town is
      unstored **and no dismissal was recorded** for that close.
- [ ] 7.7 Sign out and back in as the other fixture; confirm the question is asked rather than
      inherited.
- [x] 7.8 Confirm the diff touches **no `supabase/` file**, so the config's migration/assertion
      pairing is satisfied by there being no migration.

## 8. Record

- [x] 8.1 Comment on PD-447 with the settled interval, the defaults taken for Q1–Q4, and the two
      findings that contradict its premise: `nearLabel`'s `you` (D1) and `ExploreRidesStrip.test.tsx`
      not needing a rewrite (D2).
- [x] 8.2 Note on PD-419 that its automatic ask has been deliberately reversed, with the accepted
      cost, so the reversal is visible from the issue that introduced it.
- [x] 8.3 `reviewer` on the final diff, before the PR opens. It did not write this, which is the
      point.
- [x] 8.4 `/opsx:archive` this change before the PR, or say in the PR body why it stays open.
- [x] 8.5 PR to **`development`**, merged in the same session; PD-447 reaches `Deployed to DEV` when
      it is running there.
