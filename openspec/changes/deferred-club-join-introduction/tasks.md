# Tasks — The Introduction Sheet Becomes the Join

**No migration, and none may be added.** This change touches no policy, grant, function, trigger,
column or table. `openspec/config.yaml`'s rule pairing a migration with new assertions in
`supabase/tests/rls_test.sql` is therefore satisfied by there being no migration — **not** by
skipping assertions for one. If an implementer concludes a migration is required, **stop and say
so**: it would mean `proposal.md` §The order is forced is wrong and the proposal needs re-reading.

**Territory.** `supabase/`, `src/components/profile/`, `src/components/postcards/`,
`src/lib/data/moderation.ts`, `src/lib/data/columns.ts`, `src/lib/actions/blocks.ts` and
`src/lib/actions/moderation.ts` are held by a parallel session. Nothing here needs them.
`src/lib/validation/clubs.ts` and `docs/FIGMA-FIDELITY-TODO.md` are inside this change's claim as
widened by the main thread; the claim comment is the main thread's to edit and no session working
this change edits it.

**The dismissal rule has TWO call sites.** §4.1 and §4.2 each own one, and fixing either alone
ships the defect on the other screen. It is stated once in `design.md` §D2 and applied twice.

## 0. Pre-flight

- [ ] 0.1 Read `proposal.md` §⚠ Read this first and `design.md` §D1 and §D2 before writing any
      code. A1–A4 are the four things in this change that cannot be re-derived from the codebase.
- [ ] 0.2 Confirm the forced order still holds — the introduction RPC still refuses a non-member:
      `src/lib/actions/club-introductions.ts`'s header lists the six collapsed conditions, and
      `097`'s body is the enforcement. If a later migration relaxed it, §D1's table changes and so
      does this change's shape.
- [ ] 0.3 Confirm the state rule is untouched by anything since the proposal:
      `git grep -n "viewerRole !== null" -- src/lib/data/club-introductions.ts` — one hit, in
      `owesIntroduction`. That conjunct is what keeps the sheet members-only, and no task here
      edits it.
- [ ] 0.4 Confirm the private-club routing still holds, so §The negative cases case 2 stays
      unreachable rather than merely refused:
      `git grep -n "RequestToJoinButton\|JoinClubButton" -- src/components/clubs/ClubCard.tsx` —
      the `is_public` ternary picks between them. **Read it, do not count it.**

## 1. The action — the ordering rule gets one home

- [ ] 1.1 Add a composite write to `src/lib/actions/club-introductions.ts` that joins and then
      introduces, calling the two existing writers in that order. It SHALL NOT be an RPC and SHALL
      NOT be a transaction: `proposal.md` §Non-Goals refuses a seventh membership-writing door.
- [ ] 1.2 Its result SHALL tell the caller **which** write failed, and SHALL report a successful
      join with a failed introduction as a distinct outcome — not as a plain error. That
      distinction is what the sheet's copy and its second control both key off.
- [ ] 1.3 Each write's existing cache claims stay with that write, issued only on its own success.
      Add no new key.
- [ ] 1.4 Header comment: why the order is forced, why there is no compensating delete, and why
      this is not an RPC. One paragraph, pointing at `design.md` §D1 rather than restating it.
- [ ] 1.5 Unit test it against the mocked resolver, in `src/lib/actions/__tests__/`, covering all
      three outcomes: both succeed, the join fails and the introduction is never attempted, and
      the join succeeds while the introduction fails. Assert the *ordering* and the not-attempted
      case, since those are the two a refactor reverses in silence.

## 2. The sheet

- [ ] 2.1 Give `IntroductionPromptBody` a **required** mode — no default. Pre-join draws the
      deferral control and the new copy; member mode draws exactly what it draws today,
      byte-for-byte. A default would let a caller forget it and draw *"Welcome to the club!"* over
      a non-member, which is the defect this change exists to remove.
- [ ] 2.2 The mode latches: pre-join becomes member the moment its own membership write succeeds,
      and never returns. It SHALL NOT be derived from a cache read — `design.md` §D3.
- [ ] 2.2a The latch lives **in the sheet, per instance**, and is not hoisted to the page. Explore
      keys the sheet per club and the detail screen is one club, so per-instance is
      per-(rider, club); a page-level latch makes the *next* club unjoinable. `design.md` §D3.
- [ ] 2.2b `onDismiss` gains an argument: whether a membership exists at that instant. The sheet is
      the only thing that knows, and the page is what records the dismissal.
- [ ] 2.3 Pre-join `Post` calls the composite from §1; member `Post` keeps calling
      `introduceToClub` unchanged.
- [ ] 2.4 The three outcomes render as `client-render-shell`'s table says. The half-succeeded case
      gets the one new string, and the second control relabels with the latch.
- [ ] 2.5 Dismissal is inert in pre-join mode from `Post` **until the membership write resolves**,
      and no longer — the control, the scrim and Escape. Once the membership exists the sheet is in
      member mode and keeps "always dismissible, pending or not"; holding it shut for the
      introduction's flight would contradict that rule. The scrim and Escape are `ContextMenu`'s,
      so the wrapper's close handler needs to see that state; do not duplicate the flag in two
      components.
- [ ] 2.6 Copy constants go in `src/lib/validation/clubs.ts` beside the existing starter, and
      nothing anywhere compares against any of them.
- [ ] 2.7 Both pinned invariants survive in **both** modes: `Post` inert until non-whitespace text,
      and the starter a `placeholder` rather than a `defaultValue`.

## 3. The two join controls

- [ ] 3.1 `ClubMembershipButton` takes the club's default-club status and an opener callback. Where
      an introduction is owed it opens the sheet and writes nothing; on the default club it joins
      outright as today.
- [ ] 3.2 `JoinClubButton` does the same. **Keep its `hasIntroducedClub` read and move it in front
      of the sheet**, issued on tap before anything is written: it is the freshness guard against a
      cached row that still says `Join club`, and without it a stale tap reports a join that
      created nothing (`joinClub` upserts with `ignoreDuplicates`). `design.md` §D4. Its header's
      `onJoined` paragraph is rewritten to say what the callback now means — *open the sheet*, not
      *a join happened*. Rename it if that reads better; do not leave the old name with a new
      meaning.
- [ ] 3.2a `ClubMembershipButton` takes the same read on the same terms. Both controls sit above
      cached data and neither may infer freshness from its own position.
- [ ] 3.2b Nothing in this change may report a join from a non-erroring upsert alone. Where a
      confirmation is needed that a row was created, read it; otherwise say nothing about it.
- [ ] 3.3 Neither control hardcodes the default-club status. `JoinClubButton`'s header already
      records the defect that came of asserting it; keep that reasoning.

## 4. The two screens

- [ ] 4.1 `src/app/(app)/clubs/detail/page.tsx`: one sheet, two openers. The state rule is
      unchanged and keeps every conjunct; it may not open a second sheet, remount the open one, or
      reset its draft when the membership write lands. `design.md` §D3.
- [ ] 4.1a **This screen's own `onDismiss` must stop recording a dismissal for a declined join.**
      It calls `dismissIntroductionPrompt(id)` unconditionally today, and `ContextMenu`'s scrim and
      Escape close through that same handler — so a `Join later`, a scrim tap or an Escape all
      reach it. Apply the iff here using `onDismiss`'s new argument (§2.2b). **Leave `onPosted`'s
      write alone**: a successful `Post` means a membership exists, so it already satisfies the
      iff, and it is what closes the sheet without waiting on the invalidated read.
      This is the reachable defect the reviewer caught — fixing §4.2 alone ships it on the screen
      the story is about.
- [ ] 4.2 `src/app/(app)/clubs/explore/page.tsx`: the sheet stays owned by the page. Its
      `advanceIntroductions` **must stop recording a dismissal for a deferred join** — today it
      calls `dismissIntroductionPrompt` unconditionally, and carrying that over records a
      dismissal for a club the rider never joined, which then silences the members-only prompt if
      they are admitted by another door. This is the single easiest line in the change to get
      wrong (`design.md` §D2).
- [ ] 4.3 Keep the property that a draft can never be posted to a club other than the one it was
      composed for, however the queue ends up shaped.

## 5. Tests

- [ ] 5.1 `IntroductionPrompt.test.tsx`: the four existing **invariants** survive — they describe
      member mode — but the file changes, because `mode` is required (§2.1) and each render must
      now pass it explicitly. That is the intended cost of a required prop: a green diff here would
      have meant a default nobody can forget to pass. Add the pre-join mode through the same
      `IntroductionPromptBody` seam — the deferral control's label, the heading that does not
      welcome, and `Post` inert on open. `ContextMenu` renders nothing under `environment: 'node'`,
      so nothing here may need jsdom.
- [ ] 5.2 `JoinClubButton.test.tsx`: tapping Join for a club owing an introduction writes no
      membership and asks its parent to open the sheet; tapping it for the default club joins
      outright and opens nothing; and tapping it for a club the rider already introduced themselves
      to — the stale-row case — joins nothing new and opens nothing.
- [ ] 5.2a One test for the dismissal iff on **each** of the two screens, or one test per call site
      if the screens themselves are hard to render. What it pins: a deferred join records no
      dismissal, and a declined introduction does.
- [ ] 5.3 Verify each new test both ways, per `CLAUDE.md`'s verify-both-ways rule — swap the shape
      it pins and confirm it goes red. A test that passes against both shapes pins nothing.
- [ ] 5.4 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`.

## 6. Documentation

- [ ] 6.1 `docs/FIGMA-FIDELITY-TODO.md`: the sheet has no v2 frame and now has a second mode. Log
      it where the first one is logged, rather than opening a new section.
- [ ] 6.2 No claim added anywhere without the command that checks it, per `CLAUDE.md`.

## 7. The walk

- [ ] 7.1 The walk refuses a create and an edit; it does not join a club, and this change does not
      add a phase to it. Adding one means adding a reason, not broadening a remit — say so in the
      PR rather than extending the walk silently.
