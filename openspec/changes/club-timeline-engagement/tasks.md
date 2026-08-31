# Tasks — club-timeline-engagement (PD-299, extending PD-355)

**This change HAS a migration**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing a policy is paired with a task adding assertions to `supabase/tests/rls_test.sql`. §0 is
pre-flight and §7 is the ordering, which is the one part that cannot be reordered for convenience.

> **`design.md` §Q1 is BLOCKING and is the product owner's.** It is the share affordance, and it is
> the one place this change declines an ask as stated. Everything else has a default and can
> proceed.

## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 Read **PD-299** and **PD-355**, bodies **and** comments. Read 2026-08-31: PD-299 is
  `Needs decision` with one comment closing its question 1; PD-355 is `Deployed to DEV` with one
  comment recording that sources **declare** their horizon and that a `reply` event exists — both
  load-bearing for the `club-timeline` delta. **There is no sub-issue for this work**; opening one,
  with the five-rating block, is the main thread's.
- [ ] 0.2 Re-derive the two parent policies rather than trusting `proposal.md`'s table. Any change
  to either reopens every inheritance decision in this change:
  ```sql
  select tablename, policyname, cmd, qual, with_check from pg_policies
   where schemaname='public' and tablename in ('club_threads','club_members');
  ```
  Measured on DEV 2026-08-31 — `club_threads` SELECT is
  `EXISTS(clubs) AND private.is_club_member(club_id) AND (author_id = auth.uid() OR NOT
  private.is_blocked(auth.uid(), author_id))`; `club_members` SELECT is
  `(private.is_club_member(club_id) OR EXISTS(clubs c … c.is_public)) AND (user_id = auth.uid() OR
  NOT private.is_blocked(auth.uid(), user_id))`. **The public-club disjunct on the second and its
  absence on the first is the asymmetry the role table in the capability spec rests on.**
- [ ] 0.3 Confirm `club_members`' primary key is still `(club_id, user_id)`. If it is not, the
  composite foreign key in §1.2 is unavailable and §D4's whole argument has to be re-taken:
  ```sql
  select conname, pg_get_constraintdef(oid) from pg_constraint
   where conrelid='public.club_members'::regclass and contype='p';
  ```
- [ ] 0.4 Record the gate-trigger count **before** the migration, so the after-count means
  something: `select count(*) from pg_trigger where tgname='enforce_participation_gate' and not
  tgisinternal;` — **17** on DEV, 2026-08-31.
- [ ] 0.5 Read both `notifications` CHECK constraints verbatim; §2 rewrites them and they are the
  one existing object this change touches:
  ```sql
  select conname, pg_get_constraintdef(oid) from pg_constraint
   where conrelid='public.notifications'::regclass and contype='c';
  ```
- [ ] 0.6 Read the design offline. **Do not call the Figma API.**
  `npm run figma -- tree "Private club - Timeline"`, then `--all` for the layers Figma has toggled
  off. The `Event` row is 44px with a 28px avatar; whether it has room for a wave control at all is
  a composition question this change must answer from the frame, not from the desire to add one.
- [ ] 0.7 **Answer `design.md` §Q1** — the share affordance. It is the only blocking question and
  it is the objection at the top of `proposal.md`.

## 1. `092` — the two tables

- [ ] 1.1 `club_thread_waves (thread_id, user_id, created_at)`, PK `(thread_id, user_id)`.
  `thread_id → club_threads(id) ON DELETE CASCADE`, `user_id → profiles(id) ON DELETE CASCADE`.
  `created_at` **server-owned**: withheld from the INSERT column grant, per `034` §4b — a default
  applies only when the column is OMITTED and PostgREST will happily name it.
- [ ] 1.2 `club_join_waves (club_id, subject_user_id, user_id, created_at)`, PK
  `(club_id, subject_user_id, user_id)`, with
  **`FOREIGN KEY (club_id, subject_user_id) REFERENCES club_members (club_id, user_id) ON DELETE
  CASCADE`** and `user_id → profiles(id) ON DELETE CASCADE`. The composite key is §D4 and is the
  single line most worth getting right in this file.
- [ ] 1.3 **An index leading with `user_id` on each table**, for the `profiles` cascade. Both
  primary keys lead with another column, so neither serves it, and `029`'s standing rule is that
  every foreign key into `profiles` has an index Postgres can use.
- [ ] 1.4 `comment on table` for each, naming `postcard_likes` as the same concept under the older
  name (§D1), stating the per-viewer count and its three consequences (§D6), and stating **retention
  explicitly**: indefinite, dying with the subject, the reactor and — for joins — the membership,
  through three cascades and nothing else. `club_thread_reads`' comment is the model for stating a
  retention rather than leaving it silent.
- [ ] 1.5 `alter table … enable row level security` on both.

## 2. `092` — the notification type

- [ ] 2.1 Widen `notifications_type_check` with `club_waved`.
- [ ] 2.2 Widen `notifications_subject_shape` with a `WHEN 'club_waved'` arm requiring `club_id IS
  NOT NULL` and the other three NULL — **identical to `club_joined`'s**, so
  `notifications_event_key` collapses per `(recipient, type, actor, club)` with no new column and
  no ninth index. Verify the `ELSE false` fallthrough survives the rewrite; it is what makes a
  forgotten arm loud.
- [ ] 2.3 **No `thread_id` column on `notifications`.** A thread wave notifies nobody (§Q2). Adding
  the column "for later" would owe an index, a shape arm and a cascade path.

## 3. `092` — policies and grants

- [ ] 3.1 SELECT on each: the parent `EXISTS` plus
  `user_id = auth.uid() or not private.is_blocked(auth.uid(), user_id)`. **Nothing else.** Write the
  comment that says why no membership, club-visibility or parent-author-block conjunct appears —
  and, per `081`'s lesson, do not justify anything as *"the parent alone is a leak"* unless it is.
- [ ] 3.2 INSERT on each: `user_id = auth.uid()` plus the **same** `EXISTS`, plus
  `user_id <> subject_user_id` on `club_join_waves` only. Comment the asymmetry with §Q3's reason so
  it is not removed for consistency.
- [ ] 3.3 DELETE on each: `using (user_id = auth.uid())`, **no visibility conjunct** (`009`'s rule).
  Comment that the SELECT policy's own-row disjunct is what makes this reachable at all, citing
  `081`'s measurement that RLS applies SELECT to a `DELETE … where`.
- [ ] 3.4 **No UPDATE policy and no UPDATE grant** on either — a wave has no mutable column.
  `009` says the same of `postcard_likes`. Assert the absence in both directions, because a
  well-meaning `grant all` restores only one of them.
- [ ] 3.5 `revoke all … from anon, authenticated`, then `grant select, delete` at table level and
  `grant insert (…)` **per column**, omitting `created_at`. Nothing to `anon` — decision #1.

## 4. `092` — triggers

- [ ] 4.1 `enforce_participation_gate` on both, `before insert … for each row when (current_user =
  'authenticated')`. **The `when` clause is not decoration** — `023` §2. Update the
  `comment on function public.enforce_participation_gate()` to say **nineteen**, because that
  comment is the `data` agent's first read via `list_tables` and no edit to `CLAUDE.md` reaches it.
- [ ] 4.2 `private.notify_club_waved()` — `security definer`, `set search_path = ''`, recipient
  `new.subject_user_id` read from the row, actor `new.user_id`, `not private.is_blocked(new.user_id,
  new.subject_user_id)` written with the honest redundancy comment, `on conflict do nothing`.
  `revoke all on function … from public, anon, authenticated`.
- [ ] 4.3 `private.retract_club_waved()` — `after delete`, scoped by **all four** of `user_id`,
  `type`, `actor_id`, `club_id` (`036` §7.2). **No `pg_trigger_depth` guard.**
- [ ] 4.4 Both fan-out triggers carry **no `when` clause** — `036` §7.8: copying `023`'s guard here
  would stop the fan-out firing for the seed the RLS suite runs as.

## 5. RLS assertions — paired with §§1–4, per `openspec/config.yaml`

Each is a statement about a **role** and a **resource**. Verify every one **both ways** per
`CLAUDE.md` §Working Principles: confirm it fails against the mistake it names.

- [ ] 5.1 A non-member of a **public** club reads zero `club_thread_waves` and cannot insert one.
  (Fails if the parent `EXISTS` is dropped.)
- [ ] 5.2 A non-member of a **private** club reads zero of both.
- [ ] 5.3 A member reads a fellow member's wave; after a block **in each direction**, reads zero and
  the **count** drops by one. Two cases, not one — the row and the aggregate.
- [ ] 5.4 A rider blocked with a thread's **author** can neither read nor insert a wave on it, and
  the refusal comes from the parent rather than from a conjunct in this file.
- [ ] 5.5 A rider blocked with a join's **subject** can neither read nor insert a wave on it.
- [ ] 5.6 A rider **can always read and delete their own wave**, while blocked by the parent's
  author. (Fails if the SELECT own-row disjunct is removed — the delete-path assertion of §3.3.)
- [ ] 5.7 A club **owner** and an **admin** reach exactly what a member reaches; **no policy names
  `role`**, asserted by reading `pg_policies` rather than by two role fixtures agreeing.
- [ ] 5.8 A self-wave on a join is refused; a self-wave on a thread succeeds.
- [ ] 5.9 `anon` holds **no** table privilege on either table, and no policy targets a role other
  than `authenticated`.
- [ ] 5.10 **Leaving a club deletes the join's waves**, and rejoining shows zero. This is §D4 and it
  is the assertion that fails against the bare-`profiles` key.
- [ ] 5.11 Deleting a **reactor's** profile deletes their waves; deleting a **subject's** profile
  deletes their memberships and, by cascade, the waves on them.
- [ ] 5.12 Every foreign key into `profiles` on both tables leads an index — the `pg_constraint` /
  `pg_index` form `029` uses, never a timing.
- [ ] 5.13 `enforce_participation_gate` is present **by table name** on both, and the flat count is
  **19**. Both, because a count alone cannot tell a new gate from a moved one.
- [ ] 5.14 The fan-out writes **exactly one** row, addressed to the joiner. Count it.
- [ ] 5.15 The retraction removes exactly its own row: two wavers, one un-waves, the other's
  notification survives.
- [ ] 5.16 A wave/un-wave/wave loop leaves **at most one** live notification, through
  `notifications_event_key`; assert `indnullsnotdistinct` is true rather than inferring the
  collapse.
- [ ] 5.17 No UPDATE policy and no UPDATE grant on either table.
- [ ] 5.18 Re-run the whole suite and **compare label sets, not counts** — a count cannot tell a
  rename from a loss.

## 6. Client

- [ ] 6.1 `src/lib/data/club-waves.ts` — `attachClubWaveState`, one batched read per subject kind,
  scoped to ids the timeline already holds. **Try the PostgREST embed first, fall back to the
  batched read** (§Q4): `club_join_waves`' key into `club_members` is composite and whether an
  embeddable relationship resolves for it is exactly the sort of thing that quietly does not.
  Whichever lands, write down which and why at the call site.
- [ ] 6.2 Neither function restates a membership, block, club-visibility or role predicate. Say so
  in each docstring, the way `getClubThreads` does.
- [ ] 6.3 `src/lib/actions/club-waves.ts` — four plain async functions. `invalidate` only the wave
  keys; **not** the thread list, whose rows have not changed.
- [ ] 6.4 Two keys in `src/lib/query/keys.ts`, both children of `clubs.detail(clubId)`, each with
  the docstring that file's convention requires. **No key holding a decorated entry.**
- [ ] 6.5 Extract `LikeButton`'s optimistic toggle into one shared control and re-point both
  callers. **Extract, do not copy** — two copies of the rollback and the `aria-pressed` rule is two
  places to drop the accessibility half from.
- [ ] 6.6 `ClubTimelineEventRow` gains the control on `join` and `thread` entries only. **Not** on
  `ride` (an RSVP is a stronger signal sitting beside a weaker one), **not** on `reply` (its thread
  already carries one, and two targets would count one thing twice), **not** on `club-created` (no
  person to address), and **not** on `postcard` — `PostcardCard` already carries `LikeButton`.
- [ ] 6.7 The zero count draws **nothing**. Check the 44px row still holds its avatar, sentence,
  unread dot, control and `Time Since` at the narrowest supported width before adding a sixth slot.
- [ ] 6.8 **Say welcome** on the join row's overflow (§D3, §Q6) — a pre-filled title into
  `CreateThreadForm`, editable, writing nothing until submit. No new column, no link back.
- [ ] 6.9 `notificationCopy`, `NotificationsListItem`'s `describe`, and the type union in
  `src/types/index.ts` gain `club_waved`. All three are exhaustive; missing one is a runtime break
  rather than a type error only in the one that is not.
- [ ] 6.10 Icons from `@/components/icons/generated` — `WaveIcon`, the existing glyph. Primary
  buttons are near-black `Grey/100`, never green.
- [ ] 6.11 **No share affordance on a thread**, pending §Q1.

## 7. Ordering — the one part that cannot be reordered

- [ ] 7.1 Merge to `development`. Vercel builds the Preview against `letsride-dev`.
- [ ] 7.2 **Confirm DEV is serving the new bundle** — a `READY` deployment on the merge sha,
  `aliasError` null — **then** apply `092` to DEV. `089`'s rule: additive in schema, ordered by the
  client, because `notificationCopy` and `describe` are exhaustive switches and one `club_waved` row
  under an older bundle takes a rider's notifications screen down.
- [ ] 7.3 Hand-exercise on DEV, in a **rolled-back transaction**, as `authenticated`: wave a join,
  count the notification rows; un-wave, count them again; wave a thread, confirm **zero** rows.
  `036`'s gate. Do not skip it because the triggers are on new tables — the fan-out is live from the
  moment `092` applies.
- [ ] 7.4 `get_advisors(security)` on DEV. **Expect NO new advisor**: both fan-out functions live in
  `private`, which PostgREST does not publish, and this change adds no `public` `security definer`
  function. A new `authenticated_security_definer_function_executable` means something was put in
  the wrong schema.
- [ ] 7.5 Promote to `main`. Confirm production is serving the new bundle, **then** apply `092` to
  PROD, then repeat 7.3 and 7.4 there. Deploying is an owner action for Edge Functions; applying a
  migration is not, but the ordering is the same either way.
- [ ] 7.6 Record the applied state with the command that checks it — `list_migrations` against both
  refs, against `ls supabase/migrations/` — never a number typed by hand.

## 8. Tests

- [ ] 8.1 `PGPASSWORD=postgres npm test` — the RLS suite, green, with §5's assertions in it.
- [ ] 8.2 A component test for the wave control asserting the **constant** accessible name across
  both states and that `aria-pressed` is the only thing that moves. This is the invariant a
  refactor silently reverses, and `LikeButton`'s own docstring records that it has been got wrong
  once already.
- [ ] 8.3 A component test asserting the control is **absent** for a non-member, on
  `RideInviteJoin`'s precedent — the defect here is a control that renders, so an assertion that
  something renders cannot see it.
- [ ] 8.4 A unit test asserting `mergeClubTimeline` is **unchanged**: the same five sources, the
  same horizon set. The regression this catches is a wave read acquiring a `horizon` and truncating
  the stream it decorates.
- [ ] 8.5 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 8.6 `npm run walk` reaches `/clubs/detail`; confirm it still renders.
- [ ] 8.7 `npm run docs:check` after §9.

## 9. Documentation

- [ ] 9.1 `docs/reference/schema.md` — two new rows, each with its audience predicate, its cascade
  behaviour and its per-column grants. The `club_join_waves` row must state the **composite** key
  and why, because it is the counter-intuitive one and that file exists for exactly those.
- [ ] 9.2 `docs/reference/product-scope.md` — the Clubs row, for what timeline engagement now
  covers and what it deliberately does not (no share on a thread, no thread-wave notification).
- [ ] 9.3 Do **not** edit `CLAUDE.md` or `docs/HANDOFF.md` from an agent; the main thread owns both.
  The gate-trigger count and the notification-type count both move, and both are that thread's to
  write.
