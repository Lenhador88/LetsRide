# Tasks — Introduce Yourself on Joining a Club

Read `proposal.md` §The three traps and `design.md` §D5 before writing any SQL. Two of the three
failures below are accepted at DDL time and appear only when a rider leaves a club — a green
migration and a green suite prove nothing about either unless the assertions in §5 are written the
way §5 says.

**§0 is blocking.** `design.md` §Q1 is the product owner's and it forks §1, §4 and §6.

## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 Get **Q1** answered: mandatory-and-dismissible (arm A, recommended), atomic join+intro
      (arm B), or fully optional (arm C). Record the answer at the top of `design.md` §Q1 as a
      dated banner, the way `club-timeline-engagement` records PD-356's Q1 — do not delete the
      argument, it is what makes the chosen arm defensible.
- [ ] 0.2 Get **Q3** answered: does the default club take introductions? Default is **no**. If the
      answer flips, it is one clause in §D7's rule and one assertion — not a redesign.
- [ ] 0.3 Confirm `092`–`096` are still DEV-only and that `097` is still the next free number:
      `list_migrations` against both refs, against `ls supabase/migrations/ | tail -3`.
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
- [ ] 4.3 If Q1 chose arm B, add the second RPC's signature here and fork §6.2 as well.

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
      (`comments_count:postcard_comments(count)`'s shape); name the foreign key on any `profiles`
      embed, per `MEMBER_PROFILE_EMBED` and PD-363.
- [ ] 6.2 `src/lib/actions/club-introductions.ts` — `introduceToClub(clubId, body)`, a plain async
      function calling the RPC, returning `{ error }` in the repo's shape, and invalidating the
      four keys §7 names.
- [ ] 6.3 Two cache keys in `src/lib/query/keys.ts`, both children of `clubs.detail(clubId)`, both
      documented in the file's own header table: the decoration, and the viewer's own
      "do I owe one" state. Do **not** reuse the wave keys.
- [ ] 6.4 The "does this rider owe an introduction" read — the rule in `club-introductions`
      §*The prompt SHALL be driven by the ABSENCE of an introduction*, evaluated from state.

## 7. Client — screens

- [ ] 7.1 `IntroductionPrompt` — a sheet on `ContextMenu`'s scrim and geometry. **There is no v2
      frame**; log the composition in `docs/FIGMA-FIDELITY-TODO.md` §Club detail with the
      `npm run figma -- ls` output that establishes it. Welcome copy, a `Textarea`, the submit rule
      Q1 chose, and a way out that always exists.
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
- [ ] 7.8 The back target (Q4): a bounded origin parameter in `CREATE_CLUB_PARAM`'s shape in
      `src/lib/routes.ts`, read by the thread page for **both** the header arrow and
      `useSwipeBack` — they must not disagree. Absent → the thread list, which is today's
      behaviour and what every deep link produces.

## 8. Tests

- [ ] 8.1 Unit tests for the introduction validation schema, both bounds and the whitespace floor.
- [ ] 8.2 A component test for the join row asserting the **absence** of the ⋯ trigger and the
      absence of the count where there is no introduction — an absence is invisible to a test that
      only checks something rendered, and this row has now lost one control and gained another.
- [ ] 8.3 A component test asserting the wave control survives on the join row in both states, and
      is still absent on the viewer's own row. Verify it both ways: removing the wave must fail it.
- [ ] 8.4 A component test for the thread row asserting the floor mark survives the redesign —
      `12+` must still render as `12+`. Verify both ways: dropping the `+` must fail it.
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
- [ ] 9.5 **Promotion order.** `092`–`096` go first, in filename order, then `097`. `097` itself is
      safe on either side of the build and the tasks pick **migration-first**: an older bundle
      names none of it and nothing is triggered, while a newer bundle against a pre-`097` database
      gets `PGRST202` and loses only the prompt. State the chosen side in the PR body rather than
      inheriting "additive, so the order does not matter", which `CLAUDE.md` records as wrong in
      both directions for the `092`–`096` group.
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
</content>
