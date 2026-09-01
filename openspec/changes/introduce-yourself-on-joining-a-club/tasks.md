# Tasks — Introduce Yourself on Joining a Club

Read `proposal.md` §The three traps and `design.md` §D5 before writing any SQL. Two of the three
failures below are accepted at DDL time and appear only when a rider leaves a club — a green
migration and a green suite prove nothing about either unless the assertions in §5 are written the
way §5 says.

**This directory holds TWO stories.** §§1–10 are **phase A**, the introduction, migration `097`.
§11 is **phase B**, the return anchor, no migration. `proposal.md` §How this is built says why they
are separate sessions and why the notification work is a third change entirely.

**Nothing here is blocked.** Q1, Q4 and Q6 were answered on 2026-09-01. **Q3 is open and does not
block phase A** — its recommended arm (a) is a placeholder string in one component, and arm (b) is
a different story that this change does not build either way.

## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 **Q1 is answered — arm A.** Required to post, dismissible. Nothing forks on it any more;
      build the single arm in `design.md` §Q1 and do not reintroduce the others. If *"make it truly
      mandatory"* is raised later, the seventh-door argument in that section is the answer.
- [ ] 0.2 **Q3 is OPEN and must not be guessed.** The default club takes no prompt — that half is
      settled. Whether the sheet's textarea carries an editable starter (arm a) or the Welcome club
      gets an automatic canned introduction (arm b) is unanswered, and arm (b) carries an objection
      that must be put to the owner rather than built around. Phase A ships with an empty textarea
      and a placeholder; adopting (a) later is one string.
- [ ] 0.3 Confirm `097` is still the next free number and that both projects are still level:
      `list_migrations` against both refs, against `ls supabase/migrations/ | tail -3`.
      They were level at `096` on 2026-09-01; level is a state, not a property.
- [ ] 0.4 Re-measure the two counts this change claims a delta against, on both projects, so the
      "unchanged" claims in §9 are measured rather than inherited:
      `select count(*) from pg_trigger where tgname='enforce_participation_gate' and not
      tgisinternal;` and `get_advisors(security)`.
- [ ] 0.5 Confirm the tree still has no probe columns from the design measurements:
      `select column_name from information_schema.columns where table_schema='public' and
      table_name='club_threads';` — five columns, no `probe_*`.

## 1. `097` — the two columns and their constraints

- [ ] 1.1 Write `supabase/migrations/097_club_introductions.sql` with a header carrying: what an
      introduction is, why the marker is on `club_threads` and not on `club_members` (the measured
      role escalation), why the foreign key names its column list, why the pairing CHECK is
      one-directional, and the two rolled-back probes that establish the last two.
- [ ] 1.1a In that header, state **why the `SET NULL` cannot trip the participation gate**: the
      gate trigger on `club_threads` is `BEFORE INSERT` only, so the UPDATE the foreign key
      performs on a leave fires nothing. Without that sentence the next reader has to re-derive it,
      and the obvious wrong conclusion — that a leave by an un-onboarded rider is refused — reads
      exactly like the two traps above it.
- [ ] 1.2 `alter table public.club_threads add column introduces_user_id uuid` and
      `add column introduction text`. Both nullable, no default.
- [ ] 1.3 The bounds CHECK on `introduction`: non-blank and at most 1000 characters, matching
      `club_messages_body_length` exactly. Name the constraint after the column.
- [ ] 1.4 The pairing CHECK, **one-directional**:
      `check (introduces_user_id is null or introduction is not null)`. Do **not** write the
      biconditional — `design.md` §D5 has the measurement showing it refuses the leave with
      `23514`.
- [ ] 1.5 The composite foreign key
      `(club_id, introduces_user_id) references club_members (club_id, user_id)
       on delete set null (introduces_user_id)`. **The column list is not optional** — without it
      the leave fails with `23502`. This is the third table to use `club_members`' composite
      primary key; `092`'s `club_join_waves` is the precedent and it cascades rather than nulls,
      deliberately.
- [ ] 1.6 The partial unique index:
      `unique (club_id, introduces_user_id) where introduces_user_id is not null`.
- [ ] 1.7 Comment both columns, and refresh `club_threads`' table comment to name the marker, the
      text, their immutability, the SET NULL behaviour on a leave, and the retention answer
      (indefinite; the row dies with its club or its author through the two existing cascades, and
      by nothing else — no scheduled job).

## 2. `097` — grants

- [ ] 2.1 `grant select (introduces_user_id, introduction) on public.club_threads to authenticated`.
      Without it every read naming either column answers `42501` and takes a whole screen with it.
- [ ] 2.2 Grant **no** INSERT and **no** UPDATE on either column, to any role. Assert it in §5 —
      `club_threads`' INSERT grant must still be exactly `(author_id, club_id, id, title)`.
- [ ] 2.3 Add no policy to `club_threads` and change none. The introduction inherits the thread's
      audience; a new arm would be the second copy §D1 refuses.
- [ ] 2.4 Add **no** UPDATE policy to `club_members`, and add nothing that needs one.

## 3. `097` — the writing function

- [ ] 3.1 `create function public.introduce_to_club(target_club uuid, body text) returns uuid`,
      `language plpgsql`, `security definer`, `set search_path = ''` (or the repo's pinned form),
      `#variable_conflict error` as `085`/`093` do.
- [ ] 3.2 Read the subject from `auth.uid()` and take **no** rider argument.
- [ ] 3.3 **Restate the participation gate** against the caller —
      `private.may_participate_for(v_uid)`. Mandatory: the trigger on `club_threads` carries
      `when (current_user = 'authenticated')` and cannot fire inside a definer body. Do **not** add
      a second trigger to compensate; `078.9` is the precedent for asserting an absence instead.
- [ ] 3.4 Refuse a non-member (`private.is_club_member(target_club)` — correct inside a definer
      because it reads `auth.uid()`, unlike a fan-out's recipient set).
- [ ] 3.5 Refuse the club's owner, and refuse the default club if Q3 kept the exemption.
- [ ] 3.6 Insert the `club_threads` row in one statement: `author_id = v_uid`, a **constant title
      naming nobody**, the marker, and the text. Return the new thread id.
- [ ] 3.7 **ONE raise site.** A club that does not exist, one the caller cannot see, one they are
      not a member of, and a second introduction must all produce the identical message and
      SQLSTATE. Map the unique-index violation onto it rather than letting `23505` escape.
- [ ] 3.8 `revoke all on function ... from public` then `grant execute to authenticated`. Do not
      grant to `anon` and do not grant to `service_role`.
- [ ] 3.9 Comment the function with the four refusals and the one-raise-site rule.

## 4. Validation and types

- [ ] 4.1 Add the introduction schema to `src/lib/validation/clubs.ts`, bounds identical to
      `1.3`'s CHECK, exported as a constant the form's counter and `maxLength` both read.
- [ ] 4.2 Add the introduction's types to `src/types/index.ts` — no inline types at call sites.
- [ ] 4.3 A placeholder string for the textarea. **Not** a prefilled value — Q3 arm (a) is the
      unanswered question about that, and a placeholder is what an empty field shows either way.

## 5. RLS assertions — paired with §§1–3, per `openspec/config.yaml`

Each of these is a policy or constraint change with no assertion until it is written. Compare
**label sets** with the previous run rather than counts, per `CLAUDE.md`.

- [ ] 5.1 `097.1` A member can introduce themselves once; the thread appears with the marker set.
- [ ] 5.2 `097.2` `authenticated` holds SELECT on both new columns and INSERT on **neither**;
      `club_threads`' INSERT grant is still exactly `(author_id, club_id, id, title)`. Scope the
      assertion to the grantee — a table-wide count reads high because `postgres` and
      `service_role` hold everything by Supabase default.
- [ ] 5.3 `097.3` A non-member is refused, and the raise is byte-identical to the refusal for a
      club that does not exist.
- [ ] 5.4 `097.4` A rider with `terms_accepted_at` NULL is refused — the gate, restated.
- [ ] 5.5 `097.5` A second introduction in the same club is refused; one in a *different* club
      succeeds.
- [ ] 5.6 `097.6` **A rider who HAS an introduction can leave the club.** The delete succeeds, the
      thread survives, `club_id` is intact and the marker is NULL. A leave by a rider with no
      introduction passes under every wrong shape in §The three traps and must not be substituted
      for this.
- [ ] 5.7 `097.7` The one-directional CHECK still refuses a marker with no text.
- [ ] 5.8 `097.8` After the leave, the ex-member reads none of the club's threads including their
      own former introduction, and every remaining member reads it unchanged.
- [ ] 5.9 `097.9` `club_members` still has **zero** UPDATE policies. This is the tripwire for the
      escalation in §Trap 2 and it is the assertion that has nothing to do with this feature and
      must exist anyway.
- [ ] 5.10 `097.10` A non-member of a **public** club reads the roster, zero threads and zero
      messages — the measurement `proposal.md` §Why is built on, pinned so a later policy change
      cannot open it quietly.
- [ ] 5.11 `097.11` Blocking, both directions: a rider who has blocked the subject reads neither
      the introduction nor any count of it, and the subject reads nothing of theirs.
- [ ] 5.12 `097.12` A rejoined rider's new membership carries no introduction, and the old thread's
      marker is still NULL.
- [ ] 5.13 `097.13` The author's delete and the admin moderation path both reach an introduction's
      thread and both cascade its comments.
- [ ] 5.14 `097.14` The participation-gate trigger count is **unchanged** by this migration.

## 6. Client — reads and writes

- [ ] 6.1 `src/lib/data/club-introductions.ts` — one batched read per club, scoped to the join
      subjects already on the stream, returning `{ threadId, commentCount }` per subject.
      `attachClubWaveState`'s shape, including its fail-to-`{}` rule and its
      resolved-versus-not-yet distinction. Use the proven embedded aggregate
      (`comments_count:postcard_comments(count)`'s shape). This read carries **no** introduction
      text — the text belongs to the thread detail, 6.5 — and the join row needs only the id and
      the number.
- [ ] 6.1a Any `profiles` embed off `club_threads` SHALL hint **`author_id`**, not `user_id`.
      `MEMBER_PROFILE_EMBED` is `profiles!user_id` and is correct off `club_members` **only**;
      `club_threads` has no `user_id` column and its relationship to `profiles` is already
      ambiguous through `club_thread_reads` and `club_thread_waves` (`design.md` §D8 carries the
      measurement). Copy `getClubThreadReplies`' spelling at `club-timeline.ts:692`. Then run
      `npx vitest run src/lib/data/__tests__/embed-hints.test.ts` — it is the only gate that sees
      this, and PD-363 is what an unhinted one costs.
- [ ] 6.2 `src/lib/actions/club-introductions.ts` — `introduceToClub(clubId, body)`, a plain async
      function calling the RPC, returning `{ error }` in the repo's shape, and invalidating the
      four keys §7 names.
- [ ] 6.3 Two cache keys in `src/lib/query/keys.ts`, both children of `clubs.detail(clubId)`, both
      documented in the file's own header table: the decoration, and the viewer's own
      "do I owe one" state. Do **not** reuse the wave keys.
- [ ] 6.4 The "does this rider owe an introduction" read — the rule in `club-introductions`
      §*The prompt SHALL be driven by the ABSENCE of an introduction*, evaluated from state.
- [ ] 6.5 **`getClubThread` SHALL select `introduction`** — today it selects
      `'id, club_id, author_id, title, created_at'` (`src/lib/data/club-threads.ts:106`), so
      without this task the text is written and never read by anything. Add
      `introduces_user_id` alongside it only if a screen needs the marker; the render does not
      (7.9).

## 7. Client — screens

- [ ] 7.1 `IntroductionPrompt` — a sheet on `ContextMenu`'s scrim and geometry. **There is no v2
      frame**; log the composition in `docs/FIGMA-FIDELITY-TODO.md` §Club detail with the
      `npm run figma -- ls` output that establishes it. Welcome copy naming what the rider can do
      in the club, a `Textarea`, a Post that is inert until the field holds non-whitespace text
      (Q1, decided), and a `Not now` that is always present.
- [ ] 7.2 Mount it on the club detail, driven by 6.4, never by `joinClub`'s success path.
- [ ] 7.3 Per-(rider, club) dismissal held for the session, cleared by `signOut` with the rest of
      the session state. Not a schema column — a dismissal is not a fact about the club.
- [ ] 7.4 `ClubTimelineEventRow` — delete `JoinOverflow` and its `ContextMenu`; add the comment
      icon and count as a sibling of the row's `Link`, not a child of it (a button inside an anchor
      fires both). Keep `ClubWaveButton` and its own-row absence untouched. Keep the avatar's own
      link to the profile.
- [ ] 7.5 The absent case: no icon, no number, no thread link when there is no introduction or the
      viewer cannot read it. Not a disabled control and not `0`.
- [ ] 7.6 `ClubTimelineThreadRow` — replace `replyLabel`'s words with the icon and the number, and
      **keep the `+`**. Its own header says why: without it the row asserts a total it cannot know.
- [ ] 7.7 Keep the accessible name intact on both rows. The count is now a glyph and a number, so
      whatever the eye reads from it has to be in the label — `ClubTimelineThreadRow`'s existing
      `aria-label` composition is the model.
- [ ] 7.8 **Phase A does NOT touch the back target.** It stays `routes.clubThreads(clubId)` for
      both the header arrow and `useSwipeBack`, exactly as today. The whole return path is §11, so
      that one session owns it end to end and two sessions do not both edit the thread page's
      navigation.
- [ ] 7.9 **Render the introduction on the thread detail**, above the messages, attributed to the
      thread's author. Gate the render on `introduction !== null` and **never** on
      `introduces_user_id` — after a leave the marker is NULL and the text survives, so a
      marker-gated render makes every ex-member's introduction and every comment under it vanish
      from a thread that still exists.
- [ ] 7.10 Narrow the empty-thread state: a thread with an introduction and no comments SHALL draw
      the introduction plus an invitation to reply, not the existing "nothing here yet" line. A
      thread with neither keeps that line unchanged.
- [ ] 7.11 The Threads list and the timeline's thread entries: every introduction carries the same
      constant title, so the row's `lead` line SHALL name the author. Derive it from the thread's
      author, so it survives the leave that nulls the marker.

## 8. Tests

- [ ] 8.1 Unit tests for the introduction validation schema, both bounds and the whitespace floor.
- [ ] 8.2 A component test for the join row asserting the **absence** of the ⋯ trigger and the
      absence of the count where there is no introduction — an absence is invisible to a test that
      only checks something rendered, and this row has now lost one control and gained another.
- [ ] 8.3 A component test asserting the wave control survives on the join row in both states, and
      is still absent on the viewer's own row. Verify it both ways: removing the wave must fail it.
- [ ] 8.4 A component test for the thread row asserting the floor mark survives the redesign, in
      **both** directions — `12+` must still render as `12+` on a row whose activity is `partial`,
      **and a row whose activity is not `partial` must render `12` with no mark**. The second case
      is the one that matters: an implementer who re-derives the rule from "the window filled"
      re-adds the `+` to every thread-creation row, and a test asserting only the first case passes
      under both behaviours. Verify both ways — forcing `partial` true on the exact-count case must
      fail it, and dropping the `+` from the floor case must fail it.
- [ ] 8.5 `PGPASSWORD=postgres npm test` — the full RLS suite, comparing label sets with the
      previous run, not counts.
- [ ] 8.6 `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [ ] 8.7 `npm run walk` against DEV — the only gate that renders anything. The prompt is behind a
      join, so the walk needs a membership it does not already have; use `WALK_FIXTURES=1` and
      check the `N/N` did not shrink.

## 9. Apply and promote — the part that cannot be reordered

- [ ] 9.1 Apply `097` to **DEV** and verify by object, not by recorded text:
      `pg_get_constraintdef` on `club_threads`' foreign key must show
      `ON DELETE SET NULL (introduces_user_id)`, the column list included.
- [ ] 9.2 **`036`'s hand-exercise gate.** `097` hangs no trigger, but `introduce_to_club` writes
      into a live table under a live gate and a live policy set. Exercise it by hand on DEV as
      `authenticated`, in a rolled-back transaction: a member introducing themselves, a non-member
      refused, an un-onboarded rider refused, a second introduction refused, and a leave by a rider
      who has one.
- [ ] 9.3 `get_advisors(security)` on DEV: exactly **one** new
      `authenticated_security_definer_function_executable`, for `introduce_to_club`. Two means a
      helper landed in `public` that belonged in `private`.
- [ ] 9.4 Merge to `development` — that merge **is** the DEV deploy — and set the Linear issue to
      `Deployed to DEV`.
- [ ] 9.5 **Promotion order — no gap to sequence.** Both projects are at `096`, so `097` applies
      to each the same way. `097` is safe on **either** side of the build and the tasks pick
      **migration-first**: an older bundle names none of it and nothing is triggered, while a newer
      bundle against a pre-`097` database gets `PGRST202` and loses only the prompt. State the
      chosen side in the PR body rather than inheriting "additive, so the order does not matter",
      which `CLAUDE.md` records as wrong in both directions for the `092`–`096` group.
      **Do not copy this ordering into story 3.** `098` adds notification types and must go
      *after* its bundle is confirmed serving — the opposite side, per `089`.
- [ ] 9.6 Repeat 9.1–9.3 against PROD after applying, and re-run 0.4's two counts there.

## 10. Documentation

- [ ] 10.1 `docs/reference/schema.md` — the `club_threads` row gains the marker, the text, the
      SET NULL rule, the one-directional CHECK, the immutability and the retention answer.
- [ ] 10.2 `docs/reference/product-scope.md` — Clubs gains introductions.
- [ ] 10.3 `docs/FIGMA-FIDELITY-TODO.md` §Club detail — the sheet has no v2 frame, and the join row
      swapped a control.
- [ ] 10.4 `CLAUDE.md` — only if a number it claims moved. `097` adds no table and no notification
      type, so the participation-gate count and the type list are unchanged; the security-advisor
      count moves by one. Write each beside the command that re-derives it.
- [ ] 10.5 A `reviewer` pass on this proposal **before** any SQL is written — `openspec/` sits in
      CI's denylist and the RLS suite can only assert what somebody thought to write down.

## 11. Phase B — the return anchor (Q4, answered: the scroll position is in scope)

**A separate session and a separate PR.** No migration, no schema, no policy. It depends on phase A
only because both edit `ClubTimelineEventRow` and the thread page, and one working tree is one
writer — see `CLAUDE.md` §Delegating while the owner is at the keyboard.

- [ ] 11.1 Extend `src/lib/routes.ts` with the return parameter: an **origin kind** from a closed
      set and a **row key**, both bounded, in `CREATE_CLUB_PARAM`'s shape. Parse with the existing
      id schemas, so the only route it can produce is `routes.club(<well-formed id>)` with a
      fragment. No URL, no allowlist, no `BACK_ORIGINS` entry — `routes.ts` already says why that
      list is the wrong reuse.
- [ ] 11.2 Give every timeline row an anchor id derived from the ordering key `mergeClubTimeline`
      already assigns it (`join:<uuid>`, `thread:<uuid>`, …), rather than a new identity. Covers
      `ClubTimelineEventRow`, `ClubTimelineThreadRow`, `ClubTimelineRideCard` and the `postcard`
      branch in `ClubTimeline`.
- [ ] 11.3 Every link **out** of a timeline row carries the origin and its own row key. That is the
      join row's introduction link (phase A), the thread rows, the reply rows and the ride card.
- [ ] 11.4 The thread page reads the parameter and builds its back destination from it, for
      **both** the header arrow and `useSwipeBack` — they must not disagree, which is the defect
      PD-341 closed on this screen once already. Absent → `routes.clubThreads(clubId)`, today's
      behaviour and what a notification tap, a shared URL and a reload all produce.
- [ ] 11.5 The club detail applies the position **after its rows exist, once**. Not on mount — the
      screen is client-rendered and has no rows at first paint, so native fragment handling finds
      nothing. Not on every render — an arriving row or an invalidated cache would move a rider who
      has started reading.
- [ ] 11.6 An anchor that does not resolve is a **no-op**: render at the top, no retry, no message.
      Deleted, past the horizon, and no-longer-readable are indistinguishable here and all three
      are ordinary.
- [ ] 11.7 A component test that the row anchors exist and match the stream's keys, and a test that
      an unresolvable anchor renders the screen normally. Verify the second both ways: a version
      that throws or reports on a missing anchor must fail it.
- [ ] 11.8 `npm run walk` — the walk already discovers detail routes from the lists, so this is the
      one gate that can see a back button landing somewhere wrong.
