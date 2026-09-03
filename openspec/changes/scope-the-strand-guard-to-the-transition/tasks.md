# Tasks — scope the strand guard to the transition

**There is no migration in this change, and that is stated rather than left open.** The guard is
client + action only: the `rides` UPDATE policy already permits every write this unblocks, read
live off DEV. So `openspec/config.yaml`'s tasks rule — *"any task adding or changing a migration
must be paired with a task adding assertions to `supabase/tests/rls_test.sql`"* — is satisfied
vacuously, and **a diff for this change that touches `supabase/` is wrong**. Section 5 makes that
a checked claim rather than an intention.

## 0. Pre-flight

- [ ] 0.1 **Settle the archive order with `add-ride-club-edit-delete`.** This delta modifies
  `ride-lifecycle`, which is **not in `openspec/specs/`** — PD-101's change is still active.
  Archive it first, or the delta has no base text to attach to. Check with
  `npm run openspec -- list --json`. **The CLI is not installed in every container**
  (`node_modules` absent → `openspec: not found`); `npm ci` first rather than skipping the check.
- [ ] 0.2 **Read `design.md` §D1 before writing a line.** The Narrow reading is a *stated
  assumption*, not an owner decision — nobody was available when this was written. If the owner
  has since answered Wide, stop and re-cut the delta (§Open questions Q1 says exactly what
  shrinks); do not build Narrow and mention it in the PR.
- [ ] 0.3 Re-derive the two call sites rather than trusting the line numbers here — a partial fix
  leaves the halves disagreeing: `grep -rn "wouldStrand\|nobody but you" src/`. Measured
  2026-09-03: six hits across `EditRideForm.tsx` and `rides.ts`, two of them comments.
- [ ] 0.4 Confirm the premise is still live: the fourth `rides` SELECT arm
  (`private.has_live_ride_invite(id)`) and the `ride_invites` INSERT policy's absence of a club
  predicate. `execute_sql` against DEV, `pg_policy`. If either has moved, this change's whole
  argument moves with it.

## 1. The shared copy, first — everything else renders it

- [ ] 1.1 Add a plain copy module (suggested `src/components/rides/audienceCopy.ts`; the name is
  the build's, the strings are `design.md` §D4's) exporting **two** constants: the audience hint
  and the refusal.
- [ ] 1.2 The hint constant's value is **byte-identical** to what both forms render today:
  `Anyone signed in can see and join a public ride. A private ride is visible to its club, and to
  riders you invite.` Copy it from the file, do not retype it.
- [ ] 1.3 The refusal constant is the new sentence — `design.md` §D4. It replaces **both** the
  form's alert text and the action's error string; there is one copy after this change.
- [ ] 1.4 Render the hint constant from `CreateRideForm.tsx` and `EditRideForm.tsx`. **The
  rendered output must not change** — verify by diffing the two rendered strings, not by reading.

## 2. The predicate

- [ ] 2.1 Add the pure helper `design.md` §D3 describes — stored pair vs submitted pair, true iff
  the submitted pair is clubless-and-private and the stored pair is not. Put it where both a
  component and an action can import it without either importing the other.
- [ ] 2.2 `EditRideForm`: replace `wouldStrand` (`:185`) with the transition predicate computed
  against the `ride` prop. **Rename it** — `wouldStrand` names the retired premise. No data-layer
  change: `RideForEdit` already carries `is_public` and `club_id`.
- [ ] 2.3 Gate the `role="alert"` (`:306`) on the new predicate, and render the refusal constant
  in it. **Keep `role="alert"`** — the walk depends on the alert/status split (`design.md` §D5).
- [ ] 2.4 Gate the Save button's `disabled` (`:319`) on the same predicate. A ride that arrived
  clubless-and-private must render an enabled Save with no alert.
- [ ] 2.5 Rewrite the comment block at `:285-299`. It currently states that the alert argues from
  a retired premise and that PD-338 owns the sentences — both false after this. Replace, do not
  annotate (`CLAUDE.md` §Working Principles).
- [ ] 2.6 `updateRide`: add `is_public, club_id` to the existing `previous` select (`:445`), and
  **move the guard** (`:425-430`) below that read so it can compare. Zod parsing stays first.
- [ ] 2.7 The action's prior shape comes from that read and **never from a form field**. When
  `previous` is null, do not refuse and do not permit — fall through and let RLS report.
- [ ] 2.8 `createRide` is **not** touched. Confirm by diff; the spec now states the asymmetry is
  deliberate.

## 3. Tests — one per thing a refactor reverses in silence

Component tests render through `renderToStaticMarkup` under `environment: 'node'` unless they need
layout or an event; none of these do. Count the suite afterwards with
`git ls-files 'src/**/*.test.tsx' | wc -l` rather than trusting a number.

- [ ] 3.1 New `src/components/rides/__tests__/EditRideForm.test.tsx`:
  - a ride with `club_id: null, is_public: false` renders **no alert** and an **enabled** Save —
    the PD-338 headline, and the assertion that fails if the guard is ever re-broadened;
  - the same ride with the form's public box left clear still saves — no lever required;
  - a ride with a club, submitted clubless-and-private, renders the alert and a disabled Save;
  - a clubless **public** ride, un-published, renders the alert and a disabled Save;
  - the alert carries `role="alert"` (pins §D5's contract with the walk).
- [ ] 3.2 The hint-pair assertion PD-320's review deferred to this issue: both ride forms render
  the *same* audience sentence. With the shared constant this is a cheap regression pin — assert
  the two **rendered** strings are equal, so it still catches a build that inlines one again.
- [ ] 3.3 A unit test for the predicate itself, table-driven over the four stored shapes × the
  four submitted shapes. The two refused cells are the whole point; assert the other fourteen are
  permitted, so a future "tightening" has to delete an assertion rather than slip through.
- [ ] 3.4 An action-level test that `updateRide` refuses the transition against a **mocked
  resolver**, in the style of `src/lib/actions/__tests__/`, and that it does **not** refuse an
  edit to a ride already in the shape. Assert the refusal string is the shared constant, not a
  literal — that is what stops the two copies re-appearing.
- [ ] 3.5 `npx vitest run src/components/rides src/lib/actions` green, then `npm run test:unit`.
- [ ] 3.6 **Verify each new assertion both ways** (`CLAUDE.md` §Working Principles): break the
  predicate deliberately and confirm the test goes red. An assertion that has never failed is not
  known to test anything.

## 4. The walk, and the PD-311 handoff

- [ ] 4.1 Read `design.md` §D5's table. **Narrow does not fix PD-311** — a clubless *public*
  fixture ride flipped to private still hits a disabled Save, so the phase still cannot submit.
  Do not close PD-311 on this change.
- [ ] 4.2 Leave `checkEditRetention`'s `role="status"`-only rule exactly as it is, and do not
  change either ARIA role anywhere in this diff.
- [ ] 4.3 Add one line to PD-311 (main thread writes Linear, not a subagent) recording what
  changed underneath it: the guard now fires on the transition, so the fix is choosing a flip
  direction that reaches the action — or asserting the disabled state deliberately — rather than
  a fixture workaround.
- [ ] 4.4 Run the walk if the relay is available (`scripts/supabase-relay.mjs`'s header first) and
  read the `refused edit` phase's output. A shrunken `N/N` is a skip, not a pass.

## 5. Gates and the claims this change makes

- [ ] 5.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 5.2 **Assert the no-migration claim rather than stating it**: `git diff --name-only
  origin/development... -- supabase/` prints nothing. If it prints anything, this change grew a
  visibility decision nobody proposed.
- [ ] 5.3 `npm run docs:check` — the alert copy and the two-copies-of-one-message situation are
  the kind of thing a doc claim pins.
- [ ] 5.4 `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — these artifacts point at
  `CLAUDE.md` sections by name (§Working With the Product Owner, §Technology Decisions,
  §Working Principles, §The roadmap lives in Linear), and `openspec/` is in the sweep.
- [ ] 5.5 `npx openspec validate scope-the-strand-guard-to-the-transition --strict`.
- [ ] 5.6 **`reviewer` on the diff before the PR** — non-negotiable. Point it at the one claim
  this change most wants checked: that a relaxed client guard widened no policy.

## 6. Close-out

- [ ] 6.1 PR to `development`, never `main`.
- [ ] 6.2 PD-338 to `Deployed to DEV` once merged. **The story closes only if the thing it names
  exists** — a ride created under the private default is editable. If Q1 came back as Wide and
  only Narrow shipped, the issue stays open.
- [ ] 6.3 `/opsx:archive` this change **after** `add-ride-club-edit-delete` is archived, per 0.1.
