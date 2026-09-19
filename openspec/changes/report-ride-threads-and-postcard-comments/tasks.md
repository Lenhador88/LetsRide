# Tasks — report-ride-threads-and-postcard-comments (PD-454)

**This change HAS migrations**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing a policy is paired with a task adding assertions to `supabase/tests/rls_test.sql`. §0 is
pre-flight, §7 is the ordering, and §7 is the one part that cannot be reordered for convenience.

> **The numbers are `118` then `119`.** `117` is held by the concurrent PD-398 track, which shares
> this session's slot for exactly this reason. Confirm with `ls supabase/migrations/` immediately
> before writing each file; if a number is taken, take the next free one and say so in the PR
> rather than renumbering somebody else's file. **`118` before `119` is required** — not for an
> object, but for the `public.enforce_participation_gate()` comment both files restamp, where the
> last writer wins (D7).

> **No question blocks this build.** Q1 is the product owner's and its default — a report reaches
> nobody in-app — is the answer already given for club threads on 2026-08-31. Build that. **Do not
> build an admin-visible half on a guess**: a rider who reports under "nobody sees this" cannot
> un-report under a different rule.

## 0. Pre-flight — re-derive, do not trust this file

- [x] 0.1 Read **PD-454**, body **and** comments. Read 2026-09-18: `Development (AI)`, milestone
  *Store submission*, labels App/Database/Feature, and the comments are territory and stall-alarm
  traffic carrying no correction to the body. If a comment has appeared since, it overtakes the
  body.
- [x] 0.2 Re-derive both inherited audiences. These are what the report INSERTs inherit, so any
  change to them moves who may report:
  ```sql
  select tablename, policyname, cmd, qual, with_check from pg_policies
   where schemaname='public' and tablename in ('ride_threads','postcard_comments','postcards');
  ```
  Measured on DEV 2026-09-18 — both are quoted in `design.md` §Context. **The own-comment arm on
  `postcard_comments` is at TOP level**, so a rider reads their own comment even when the postcard
  has left their view (D9).
- [x] 0.3 Record the gate-trigger count **before** the first migration, so the after-count means
  something. **22 on DEV, 2026-09-18**, and `117` lands in between, so the absolute number will be
  wrong by the time these apply — §5 claims `before + 1` per file:
  ```sql
  select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;
  ```
- [x] 0.4 Record the published-definer count, for the zero-new-advisor claim. **38 on DEV,
  2026-09-18**:
  ```sql
  select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  ```
- [x] 0.5 Record the `service_role` grant census — **30 kept · 3 revoked** on 2026-09-18, the query
  being `CLAUDE.md` §Supabase Rules'. After both files: **5 revoked**.
- [x] 0.6 Read the cascade children off `pg_constraint`, never from memory (`076` recorded naming
  one of five):
  ```sql
  select conrelid::regclass, pg_get_constraintdef(oid) from pg_constraint
   where contype='f' and confrelid in ('public.ride_threads'::regclass,
                                       'public.postcard_comments'::regclass);
  ```
  2026-09-18: `ride_thread_messages`, `ride_thread_reads`; and `notifications` via `comment_id`.
  All `ON DELETE CASCADE`.
- [x] 0.7 Read `076` and `094` in full before writing either file. They are the shape, and both
  headers carry decisions this change inherits rather than re-makes.

## 1. `118` — `public.ride_thread_reports`

- [x] 1.1 Create `supabase/migrations/122_report_a_ride_thread.sql` (**`118`/`119` were both spent
  before this was built — see the note at the top of this file**) with a header stating: the
  subject, why a new table rather than a widened one (`094` §2, the third reason decides it), the
  inherited audience quoted from 0.2, the cascade list from 0.6, the ordering (`036`'s hand-exercise
  gate does **not** fire — no trigger on a shipped write path, no function replaced), and the
  zero-new-advisor claim with its mechanism.
- [x] 1.2 The table: `id`, `reporter_id → profiles(id) on delete cascade not null`,
  `thread_id → ride_threads(id) on delete cascade not null`, `reason text not null`, `note text`,
  `created_at timestamptz default now() not null`.
- [x] 1.3 CHECKs: `reason in ('spam','harassment','hate','nudity','violence','other')`, and the
  note's trimmed floor / raw ceiling at 1000, both copied from `094` verbatim.
- [x] 1.4 `unique (reporter_id, thread_id)` — the anti-brigading key, leading with `reporter_id` so
  it is also the index the `profiles` cascade uses (`029`).
- [x] 1.5 `create index ride_thread_reports_thread_id_idx on … (thread_id, created_at desc)` for the
  `ride_threads` cascade and the queue's join.
- [x] 1.6 `alter table … enable row level security`.
- [x] 1.7 Table comment stating, at creation: the inherited audience, that **nobody on the crew
  reads this table**, that it is not editable or withdrawable, and the **retention** — indefinite,
  dying with its thread and its reporter through two cascades and nothing else, with no scheduled
  deletion and no `resolved_at`.

## 2. `118` — policies, grants, gate

- [x] 2.1 SELECT policy: `reporter_id = auth.uid()`, to `authenticated`, with **no** crew conjunct
  and a comment saying why its absence is deliberate.
- [x] 2.2 INSERT policy: `reporter_id = auth.uid() and exists (select 1 from public.ride_threads t
  where t.id = ride_thread_reports.thread_id)` — naming no crew, ride or block predicate, with the
  two designed consequences written out (a non-crew rider is refused; block-then-report is
  unreachable).
- [x] 2.3 No UPDATE and no DELETE — neither policy nor grant. Comment says the absence is the
  enforcement.
- [x] 2.4 `revoke all on public.ride_thread_reports from public, anon, authenticated, service_role;`
  at creation, with D6's judgement written beside it.
- [x] 2.5 `grant select` and column-scoped
  `grant insert (reporter_id, thread_id, reason, note) to authenticated` — `created_at` and `id`
  withheld (D3).
- [x] 2.6 `enforce_participation_gate` trigger, `before insert … for each row when (current_user =
  'authenticated')`, with the note that it is keyed on the caller's own stamp and therefore cannot
  become a membership oracle (`093`'s lesson).
- [x] 2.7 Restamp `public.enforce_participation_gate()`'s comment to **twenty-three**, composed from
  the LIVE comment read off the database, never from a copy in an earlier file.

## 3. `118` — the reader, in the same file

- [x] 3.1 `create or replace view private.ride_thread_report_queue with (security_invoker = false)`:
  report id, reported_at, reason, note, `reporter_id` (uuid only), thread id/title/created_at,
  message count, ride id/title/start, organiser id and username, author id and username, and the two
  open-report counts (per thread, per author), ordered by `reported_at desc`.
- [x] 3.2 View comment: the counts are **open** not lifetime; readable only by the owner; it runs as
  its owner by design and is a **pre-joined** view of what the owner could already read, **never a
  second way to read a ride's private conversation**; the reporter appears as a uuid only.
- [x] 3.3 `create or replace function private.remove_reported_ride_thread(target uuid) returns jsonb`
  — **not** `security definer`, `set search_path = ''`, every name qualified. Reads the evidence
  **before** the delete, returns the thread, ride, author, reports, and up to 200 messages with a
  `messages_total` beside them so truncation is visible. A missing id returns
  `{removed:false, reason:'no such thread'}` rather than raising.
  **Name check:** `private.remove_reported_thread(uuid)` is `094`'s club function — do not collide.
- [x] 3.4 `revoke all` on both objects from `public, anon, authenticated, service_role`.
- [x] 3.5 Restamp `public.ride_threads`' table comment to say it is reportable into
  `public.ride_thread_reports` and that nobody on the crew reads those.
- [x] 3.6 `§Operating it` and `§Verification` footers, `076`/`094` shape, including the four-queue
  `union all` one-liner and the grant/privilege probes scoped to their grantee.
- [x] 3.7 `§Rollback` footer: drop the function, drop the view, drop the table, restamp the gate
  comment back to twenty-two.

## 4. `119` — `public.postcard_comment_reports`, the same file structure

- [x] 4.1 Create `supabase/migrations/123_report_a_postcard_comment.sql`. Header states why the
  subject is the **comment** and not the postcard (`094` §2's reasoning applied: different author,
  different subject, a live queue whose join is unconditional), and that
  `public.moderate_comment` (`011` §1b) is untouched.
- [x] 4.2 Table, CHECKs, unique key and index as §1, with `comment_id → postcard_comments(id) on
  delete cascade not null` and
  `create index postcard_comment_reports_comment_id_idx on … (comment_id, created_at desc)`.
- [x] 4.3 Policies as §2: SELECT `reporter_id = auth.uid()`; INSERT with the bare `EXISTS` against
  `postcard_comments`, whose own SELECT carries the top-level own-comment arm, the `postcards`
  EXISTS (club, **hide**, block) and the block arm on the commenter. Write those three inherited
  refusals out.
- [x] 4.4 `revoke all … from public, anon, authenticated, service_role` at creation; `grant select`
  plus `grant insert (reporter_id, comment_id, reason, note)`.
- [x] 4.5 Gate trigger, and restamp the gate comment to **twenty-four**, composed from the comment
  `118` left.
- [x] 4.6 `private.postcard_comment_report_queue` — report fields, `reporter_id` as a uuid, the
  comment's id/body/created_at, its author id and username, the postcard's id, caption and author,
  and the two open counts. **No `image_path`** (D12), and the view comment says why.
- [x] 4.7 `private.remove_reported_comment(uuid)` — evidence before the delete, one `delete from
  public.postcard_comments where id = target`, clean answer for a missing id. Note in the comment
  that `notifications.comment_id` cascades with it and that **no Storage object is involved**, so
  unlike `076` there is no second step.
- [x] 4.8 `revoke all` on both; restamp `public.postcard_comments`' table comment to name the report
  table and say nobody but the reporter reads it.
- [x] 4.9 `§Operating it`, `§Verification`, `§Rollback` footers as §3.

## 5. RLS assertions — paired with §§1–4, per `openspec/config.yaml`

Every numbered negative case in `proposal.md` §The negative cases gets at least one assertion in
`supabase/tests/rls_test.sql`, labelled `118.x` / `119.x`. **Coordinate with the PD-398 track before
editing that file** — it is in the same slot's territory.

- [x] 5.1 A crew member who can read a thread files a report; exactly one row lands (N1 positive).
- [x] 5.2 A signed-in non-crew rider who **can see the ride** is refused (N1).
- [x] 5.3 A pending invitee is refused (N2); a rider who left the crew is refused (N3).
- [x] 5.4 A rider outside the postcard's private club, one who has **hidden** it, and one blocked by
  its author are each refused a comment report (N4) — three separate assertions, one per inherited
  conjunct. **Each names a comment the rider did NOT write.** `postcard_comments` SELECT carries
  `author_id = auth.uid()` at top level, so the same assertion written against the rider's own
  comment **passes the insert** and fails the test: a rider who hid a postcard still reads, and may
  still self-report, a comment they wrote on it. Add that as its own positive assertion beside the
  three, so the exception is pinned rather than discovered.
- [x] 5.5 Reporting as somebody else is refused (N5).
- [x] 5.6 A second report by the same rider on the same subject raises `23505` (N6), for both
  tables.
- [x] 5.7 UPDATE and DELETE refused in **both** directions — no policy **and** no grant (N7), for
  both tables.
- [x] 5.8 Naming `created_at` in the insert is refused `42501`, read as a **column** privilege
  scoped to `authenticated` (N8).
- [x] 5.9 The participation gate refuses an un-onboarded rider for a readable and an unreadable
  subject with the **identical** message, asserted by string equality (N9).
- [x] 5.10 A self-report succeeds and is inert (N10) — the policy's behaviour, asserted so the
  client-side absence is known to be a display decision.
- [x] 5.11 Block-then-report is refused in **both** directions, for both subjects (N11). Then N12,
  and **write it as the two halves it actually has**, because a single assertion here would be true
  and misleading: (a) `public.moderate_comment` called by the postcard's author **succeeds** against
  a blocked commenter's comment — the privilege survives, keyed on `p.author_id = auth.uid()`; and
  (b) that same author, reading `postcard_comments` as `authenticated`, sees **zero rows** for it.
  **Half (a) passes at the SQL level while no screen can reach it**, the suite handing the function
  an id the app can never obtain, so the assertion must carry a comment saying so — otherwise a
  green suite reads as "the photo's owner has a remedy", which is exactly the claim N12 now
  withdraws.
- [x] 5.12 A report filed before a block survives the block and stays readable to its reporter
  (N13).
- [x] 5.13 Zero rows for: the thread's author, the ride's organiser, the commenter, the postcard's
  author, a club owner and a club admin (N16–N20) — six assertions, not one.
- [x] 5.14 `has_table_privilege('service_role', …, 'select')` is false on both tables (N21), and
  deleting a reporter's profile still cascades their reports away with that privilege absent
  throughout — the `076` §3b measurement, repeated (D6).
- [x] 5.15 `anon` holds nothing on either table and appears in no policy (N22); policy sets asserted
  as a sorted **command list**, not a count.
- [x] 5.16 `has_schema_privilege` false for `anon`/`authenticated` on `private`;
  `has_table_privilege('service_role', 'private.<queue>', 'select')` false;
  `has_function_privilege` false for all three roles on both take-downs; `prosecdef` false on both
  (N23, N24).
- [x] 5.17 Each queue's column list asserted to contain no reporter-identifying column beyond
  `reporter_id`, no `auth.users` column, and — for the comment queue — no `image_path` (N26, N27).
- [x] 5.18 Deleting a thread, a ride, a comment, a postcard and a reporter's profile each removes
  the attached reports and leaves everything else standing, counted by survivors (N29–N31).
- [x] 5.19 Each take-down returns its evidence and then the reports are gone; a missing id returns
  `removed:false` without raising (N32, and the take-down requirement's scenarios).
- [x] 5.20 Gate-trigger count asserted **by table name** and **as a delta** (`before + 1` per file),
  because a count alone cannot tell a new gate from a moved one.
- [x] 5.21 Each new CHECK's accepted set read from `pg_constraint`, so the Zod enum's drift is
  visible to the half a SQL test can see.

## 6. The client

- [x] 6.1 `src/lib/validation/rides.ts` gains `reportRideThreadSchema`, and
  `src/lib/validation/comments.ts` gains `reportPostcardCommentSchema` — both reusing
  `REPORT_REASONS` and `reportNoteSchema` rather than copying them. Zod owns the **message**, never
  the guarantee.
- [x] 6.2 `src/lib/actions/ride-threads.ts` gains `reportRideThread(threadId)`, `reportClubThread`'s
  shape exactly: parse, resolve, `getUser`, `upsert` with
  `{ onConflict: 'reporter_id,thread_id', ignoreDuplicates: true }`, no `invalidate`. Its doc
  comment states that reporting reaches nobody and claims no key (D8).
- [x] 6.3 `src/lib/actions/moderation.ts` gains `reportPostcardComment(commentId)`, beside
  `reportPostcard`, same shape with `onConflict: 'reporter_id,comment_id'`.
  **Both actions go into existing modules deliberately** — a new module would be a table writer with
  no cache claim and would need an exemption in
  `src/lib/actions/__tests__/writers-invalidate.test.ts`, which is the rule going quiet (D8).
- [x] 6.4 `src/components/rides/RideThreadOptions.tsx`: add the `Report thread` row for every viewer
  who is **not** the author, using `ReportIcon` from `@/components/icons/generated`. One tap, a
  banner, no navigation, no confirm — `PostcardMenu.onReport`'s shape. Update the header: the
  deferral it records is closed, and say what replaced it.
- [x] 6.5 **Thread the delete predicate into the rows BEFORE the mount gate goes — these are one
  task and doing the second alone ships a control that always fails.** `RideThreadOptionsRows`
  takes `{ pending, onDeleteClick }` today and renders `Delete thread` **unconditionally**; the only
  thing keeping it off a plain crew member's screen is the caller's mount gate. So:
  (a) `RideThreadOptionsRows` gains a `canRemove` boolean (or `isAuthor`/`isOrganizer`, composed
  through the existing `canRemoveRideThread`) and renders the delete row only when it is true, with
  the report row rendered for every non-author;
  (b) `RideThreadOptions` passes it down from the props it already holds;
  (c) **only then** `src/app/(app)/rides/detail/thread/page.tsx` drops `canRemoveRideThread` from
  the **mount** gate, keeping the data gate, and its comment is replaced by one saying why the gate
  is gone (D11).
  Reversed, a crew member who is neither author nor organiser opens a thread, sees `Delete thread`,
  taps it, and `moderate_ride_thread` refuses — not a leak, the RPC re-checks both arms, but exactly
  the "control that always fails" that component's own header names as the thing to avoid. §8.2's
  row-set cases are what stop it shipping.
- [x] 6.6 `src/components/postcards/CommentItem.tsx`: add the inline `Report` control for comments
  the viewer did not write, on the same 44px floor and negative-margin pattern as `Delete` (D10).
  `src/components/postcards/CommentList.tsx` passes a `canReport` computed the same defensive way
  `canDelete` is — `viewerId !== undefined && comment.author_id !== viewerId`.
- [x] 6.7 No new query key, no `src/lib/data/` read, no `src/types/index.ts` entry. State it in the
  PR rather than leaving it to be noticed.

## 7. Ordering — the one part that cannot be reordered

- [x] 7.1 `118` applies before `119` (D7 — the gate comment, not an object).
- [x] 7.2 **Both migrations apply before the client bundle ships.** The client writes tables that do
  not exist yet; the reverse ordering answers `PGRST205` behind "Could not send that report."
- [x] 7.3 Neither file adds a second PostgREST relationship to an embed any shipped bundle uses, so
  there is no deploy-first side to weigh. **Confirm against the repo's measured criterion, not
  against "no bundle embeds these tables"** — that looser reading is recorded as **false** in
  `src/lib/data/columns.ts` §Embed hints, PD-363 being the worked example. A table becomes a
  junction, and adds a relationship between the two tables it points at, when it carries two foreign
  keys **and a primary key that is exactly the union of their columns**. §1.2 and §4.2 give both
  tables a single-column `id` primary key with `unique (reporter_id, <subject>_id)` as a separate
  constraint — identical to `club_thread_reports`, which added no relationship — so neither
  qualifies. **A future report table given a composite primary key instead would silently become a
  junction and break every unhinted `profiles` embed on the tables it points at.** Run the
  junction query in `columns.ts` §Embed hints against DEV after applying, and:
  ```bash
  npx vitest run src/lib/data/__tests__/embed-hints.test.ts
  ```
- [x] 7.4 `036`'s hand-exercise gate does **not** fire — record why in the PR (no trigger on a
  shipped write path, no function replaced). Do not skip it silently.

## 8. Tests

- [x] 8.1 `npm test` (RLS suite) green, and reconcile by comparing **label sets**, never counts.
- [x] 8.2 Component tests: `src/components/rides/__tests__/RideThreadOptions.test.tsx` gains the
  row-set cases including **"the menu is never empty"**, which is the property that permits 6.5.
  A new `src/components/postcards/__tests__/CommentItem.test.tsx` (or an addition to the existing
  postcard component tests) pins that the report control is absent on the viewer's own comment and
  present otherwise — verified **both ways**.
- [x] 8.3 `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [x] 8.4 After applying to DEV: `get_advisors(security)` — **no new finding**; the published-definer
  count equals 0.4's reading; the grant census reads **5 revoked**.
- [ ] 8.5 `npm run walk` against DEV once the client half is in, to prove neither screen regressed.
  **NOT RUN, and the only box left open.** The walk needs the DEV relay and a browser session the
  2026-09-19 firing did not spend; both changed screens carry component tests instead, and the walk
  is not a required check (PD-370). Whoever next runs it walks a ride thread and a postcard's
  comments as `walk-fixture-2`, who is a member rather than an owner.

## 9. Documentation

- [x] 9.1 `docs/reference/schema.md` — the two new tables, their audiences, their retention and the
  four queue objects.
- [x] 9.2 `docs/FIGMA-FIDELITY-TODO.md` — the comment control and the thread row as registered
  guesses, beside the two identical entries already there (0 of 451 frames, three patterns).
- [x] 9.3 `docs/reference/migrations.md` §Applied state — both files, in filename order, per project.
- [x] 9.4 **Not** `CLAUDE.md` and **not** `docs/HANDOFF.md`: the main thread owns both, and it has
  two numbers to move — the gate-trigger count and the `service_role` grant census.
- [x] 9.5 `/opsx:archive` this change before the PR, or say in the PR body why it stays open.
  **It stays open, by the second arm, and the reason is a missing BASE rather than unfinished work.**
  This change's `ride-threads` delta is ADDED-only against a capability that **does not exist in
  `openspec/specs/`** — `ls openspec/specs/ride-threads` is a miss; it is created by the still-open
  `retire-ride-chat-for-ride-threads`. Archiving this one first writes a `ride-threads` spec holding
  only the two requirements this change adds, so the sibling's own archive then has to reconcile a
  base it did not write. That is the mirror image of the dropped-scenarios failure
  `docs/HANDOFF.md` §Next action describes, and the safe order is the sibling FIRST.
  `content-moderation` exists and its delta would archive cleanly today; splitting the archive
  across two sessions is worse than waiting, so both wait.
