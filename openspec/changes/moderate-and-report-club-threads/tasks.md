# Tasks — moderate-and-report-club-threads (PD-348)

**This change HAS a migration**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing a policy is paired with a task adding assertions to `supabase/tests/rls_test.sql`. §0 is
pre-flight and §7 is the ordering, which is the one part that cannot be reordered for convenience.

> **`design.md` Q1 is BLOCKING and is the product owner's.** It is whether a report reaches the
> club's admins in any form. Everything else has a default and can proceed. **Do not build the
> admin-visible half on a guess** — a rider who reports under "nobody in my club sees this" cannot
> un-report under a different rule.

> **The migration is `094`.** `092` and `093` are held by concurrent changes and `095` by a fourth.
> Confirm with `ls supabase/migrations/` immediately before writing the file; if `094` is taken,
> take the next free number and say so in the PR rather than renumbering somebody else's file.

## 0. Pre-flight — re-derive, do not trust this file

- [ ] 0.1 Read **PD-348**, body **and** comments. Read 2026-08-31: status `Todo AI`, parent PD-326,
  **zero comments**, and the body covers the **admin arm only** — the reporting half is the product
  owner's 2026-08-31 decision and lives nowhere on the issue. If a comment has appeared since, it
  overtakes the body.
- [ ] 0.2 Confirm the function about to be replaced is still `082`'s. If it has moved, every
  decision in `design.md` D1–D4 is reopened:
  ```sql
  select pg_get_functiondef('public.moderate_club_thread(uuid)'::regprocedure);
  ```
- [ ] 0.3 Re-derive the two parent policies. `club_threads` SELECT is what the report INSERT
  inherits, and any change to it moves who may report:
  ```sql
  select tablename, policyname, cmd, qual, with_check from pg_policies
   where schemaname='public' and tablename in ('club_threads','postcard_reports');
  ```
  Measured on DEV 2026-08-31 — `club_threads` SELECT is `EXISTS(clubs) AND
  private.is_club_member(club_id) AND (author_id = auth.uid() OR NOT private.is_blocked(auth.uid(),
  author_id))`; `postcard_reports` has exactly two policies, SELECT `reporter_id = auth.uid()` and
  the INSERT. **The block conjunct on the first is `design.md` D6 and N14.**
- [ ] 0.4 Record the gate-trigger count **before** the migration, so the after-count means
  something. **17 on DEV, 2026-08-31**, and `092` adds two before this file lands, so the absolute
  number here will be wrong by the time it applies — the claim in §5.13 is `before + 1`:
  ```sql
  select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;
  ```
- [ ] 0.5 Pin `private.is_club_admin_for`'s body **by equality, never by `like`** (`085.28`'s rule
  — a mention of the name in a comment satisfies a pattern match). The first disjunct must still be
  `clubs.owner_id = candidate`, which is what protects the ownerless owner (`design.md` D2):
  ```sql
  select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname='is_club_admin_for';
  ```
- [ ] 0.6 Record the advisor baseline. `get_advisors(security)` is the authority; this proxy is what
  a session without that tool can run, and it answers **24** on DEV 2026-08-31, matching `CLAUDE.md`
  §Supabase Rules:
  ```sql
  select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute');
  ```
- [ ] 0.7 Read the **live** `comment on function public.enforce_participation_gate()` rather than
  the copy in `085`. It currently reads *"seventeen BEFORE INSERT triggers"* and names
  `ride_invite_links (091)` as the seventeenth. **`092` rewrites the same string and the last writer
  wins**, so compose §4.2's replacement from what the database says at apply time:
  ```sql
  select obj_description('public.enforce_participation_gate()'::regprocedure,'pg_proc');
  ```
- [ ] 0.8 Read the cascade chain off `pg_constraint` rather than remembering it — `076`'s header
  records naming one of five. `092`'s `club_thread_waves` may or may not be in it by then:
  ```sql
  select conrelid::regclass as child, conname, confdeltype from pg_constraint
   where confrelid='public.club_threads'::regclass and contype='f';
  ```
- [ ] 0.9 Read the design offline. **Do not call the Figma API.** `npm run figma -- ls "*eport*"`
  and `npm run figma -- text "Content / Context Menu"`, then `--all` for the layers Figma has
  toggled off. There is no thread-report frame; confirm that rather than assume it, because it is
  what makes Q2's one-tap default correct rather than lazy.
- [ ] 0.10 **Answer `design.md` Q1** before writing §2's policies.

## 1. `094` §1 — the admin arm

- [ ] 1.1 `create or replace function public.moderate_club_thread(thread uuid)` — **replace, never
  drop-and-recreate** (`design.md` D3). Signature unchanged, so `create or replace` is available and
  the ACL survives.
- [ ] 1.2 Body: `082`'s, with the `clubs` join removed and the whole access-control decision
  delegated to `private.is_club_admin_for(v_uid, d.club_id)`. Keep `#variable_conflict error`, keep
  `set search_path = ''`, keep `for update of d`, keep `security definer`.
- [ ] 1.3 **Exactly ONE raise site**, and no session guard ahead of it (`design.md` D4):
  `is_club_admin_for(null, …)` is false, so a session-less caller leaves by the same door. Reword
  the message only as far as the widening requires; nothing reads it — `grep -rn "no thread with
  that id" src/`.
- [ ] 1.4 **Do not** re-issue `revoke`/`grant` on the function. `create or replace` keeps the ACL,
  and re-issuing them here would make a future reader think the ACL had been reset.
- [ ] 1.5 `comment on function public.moderate_club_thread(uuid)` — restate the widened authority,
  name `is_club_admin_for` as the single predicate, say that the owner arm is the helper's **first
  disjunct** and therefore survives for an owner holding no roster row, and say that the author's
  own delete is `081`'s policy and not this function.

## 2. `094` §2 — `public.club_thread_reports`

- [ ] 2.1 The table, on `011` §4's shape: `id uuid default uuid_generate_v4() primary key`,
  `reporter_id uuid references public.profiles(id) on delete cascade not null`, `thread_id uuid
  references public.club_threads(id) on delete cascade not null`, `reason text not null`, `note
  text`, `created_at timestamptz default now() not null`.
- [ ] 2.2 Three constraints, `011`'s verbatim with the subject renamed: `reason in ('spam',
  'harassment', 'hate', 'nudity', 'violence', 'other')`; `note is null or (length(btrim(note)) >= 1
  and length(note) <= 1000)`; **`unique (reporter_id, thread_id)`**, which is the anti-brigading key
  and also the index that serves the `profiles` cascade (it leads with `reporter_id`).
- [ ] 2.3 `create index … on public.club_thread_reports (thread_id)` — for the `club_threads`
  cascade and the queue's join. `029`'s standing rule, and neither the PK nor the unique index
  serves it.
- [ ] 2.4 `alter table … enable row level security`.
- [ ] 2.5 `comment on table` stating: the audience predicate it inherits and from where; that
  **nobody in the club reads it** and the reader is `private.club_thread_report_queue`; that a
  report is not editable or withdrawable; and **retention explicitly** — indefinite, dying with the
  thread and with the reporter through two cascades and nothing else, with no scheduled deletion.
  `076` §4 is the model for a table comment that stops the database asserting a gap.
- [ ] 2.6 `comment on column … created_at` — server-owned, withheld from the INSERT column grant,
  because the triage queue orders by it and a client-stamped value pins a report to the top of the
  operator's queue for ever. `081` §3's wording, `034` §4b's reason.

## 3. `094` §3 — policies and grants

- [ ] 3.1 SELECT: `using (reporter_id = auth.uid())`. **No membership conjunct** — N28, and write
  the comment that says why, or the next reader adds one for consistency.
- [ ] 3.2 INSERT: `with check (reporter_id = auth.uid() and exists (select 1 from
  public.club_threads d where d.id = club_thread_reports.thread_id))`. **Name no membership, club or
  block predicate**; the `EXISTS` runs under the caller's RLS and inherits all three (`design.md`
  D6). Comment that a self-report is permitted and inert (D11).
- [ ] 3.3 **No UPDATE and no DELETE policy.** Absence is the enforcement; assert it in both
  directions in §5, because a well-meaning `grant all` restores only one of them.
- [ ] 3.4 `revoke all on public.club_thread_reports from public, anon, authenticated,
  service_role;` — **`service_role` named at creation**, which is `076` §3b's lesson applied at
  birth instead of sixty-five migrations later. Comment that a referential cascade does not consult
  privileges, so account deletion is unaffected (076 measured it; §7.3 re-checks it in a rolled-back
  transaction because getting it wrong takes account deletion down and nothing in CI would notice).
- [ ] 3.5 `grant select on public.club_thread_reports to authenticated;` and `grant insert
  (reporter_id, thread_id, reason, note) on public.club_thread_reports to authenticated;` —
  **column-scoped, omitting `created_at` and `id`**. This is a deliberate departure from `011`,
  which granted INSERT at table level; say so in the comment. Nothing to `anon` — decision #1.

## 4. `094` §4 — the participation gate

- [ ] 4.1 `drop trigger if exists enforce_participation_gate on public.club_thread_reports;` then
  `create trigger enforce_participation_gate before insert on public.club_thread_reports for each
  row when (current_user = 'authenticated') execute function public.enforce_participation_gate();`
  **The `when` clause is not decoration** — `023` §2, and it is what stops the gate firing for the
  table owner the RLS suite runs as.
- [ ] 4.2 Update `comment on function public.enforce_participation_gate()` — composed from the
  **live** comment read in §0.7, not from `085`'s copy, and naming this table as the next in the
  list. If `092` has already renumbered it, extend that text rather than reverting it.

## 5. RLS assertions — paired with §§1–4, per `openspec/config.yaml`

Each is a statement about a **role** and a **resource**. Verify every one **both ways** per
`CLAUDE.md` §Working Principles: confirm it fails against the mistake it names.

**The admin arm:**

- [ ] 5.1 A club **admin** (a `club_members` row with `role='admin'`) calls `moderate_club_thread`
  on another member's thread in their club: **succeeds**, and the thread and its messages are gone.
  Fails against `082`'s unwidened body — this is the assertion PD-348 is about.
- [ ] 5.2 The club **owner** still succeeds. Fails against a body that gates on `club_members.role`
  alone in the one case §5.3 names, and must be asserted anyway as the no-regression baseline.
- [ ] 5.3 **An owner holding NO `club_members` row still succeeds.** The `054`/PD-128 state, built
  by deleting the owner's roster row in the fixture. **This is the assertion that fails against the
  tidier-looking predicate**, and it is the one most likely to be dropped as redundant.
- [ ] 5.4 A **plain member** is refused — both the RPC and a direct `delete from club_threads`.
- [ ] 5.5 A **non-member** is refused, for a public club and for a private one.
- [ ] 5.6 An **admin of a different club** is refused on this club's thread. Proves the club
  argument is not ignored.
- [ ] 5.7 The **author who is a plain member** is refused *by the RPC* while their own policy delete
  still succeeds. Two assertions, not one.
- [ ] 5.8 **The refusal is indistinguishable from "no such thread"**: call the RPC with a random
  uuid and with a real thread in a stranger's club, and assert the two `SQLERRM` strings are
  **equal** and the `SQLSTATE` is `insufficient_privilege` for both. This is the one-raise-site
  property and it cannot be asserted by reading the body.
- [ ] 5.9 **A block does not take the right away, in either direction**: an admin who has blocked the
  author moderates successfully, and an admin blocked *by* the author does too. Fails against a
  DELETE-policy arm, which would report success having deleted nothing — assert `rows affected`,
  not the absence of an error.
- [ ] 5.10 `has_function_privilege('anon','public.moderate_club_thread(uuid)','execute')` is
  **false** and `('authenticated', …)` is **true**, after the migration. The drop-and-recreate
  tripwire (`design.md` D3).

**Reporting:**

- [ ] 5.11 A club **member** reports a thread: succeeds, one row, `reporter_id` = them.
- [ ] 5.12 A **non-member** is refused — **public** club and private club, both. The public case is
  the one the `EXISTS` is carrying alone.
- [ ] 5.13 A rider **blocked with the author** (each direction) is refused. N14; assert it as a
  *designed* consequence with a comment, so a later session does not "fix" it.
- [ ] 5.14 A rider cannot report **as somebody else** — `reporter_id` set to another uuid is refused
  `42501`.
- [ ] 5.15 A **second report of the same thread by the same rider** is refused by
  `club_thread_reports_one_per_rider` (`23505`), and the same rider reporting a **different** thread
  succeeds.
- [ ] 5.16 The **author of the thread reads zero** reports about it. The load-bearing one (N15);
  `rls_test.sql`'s postcard twin is the model.
- [ ] 5.17 The **club owner reads zero** and the **club admin reads zero**. Two assertions, and
  neither is implied by §5.16.
- [ ] 5.18 The **reporter reads their own row**, still reads it **after leaving the club**, and
  still reads it **after blocking the author**. Three assertions, N28 and N29.
- [ ] 5.19 The `reason` CHECK accepts exactly the six values and refuses a seventh — read the
  accepted set from `pg_constraint` and compare it to a literal list in the test, which is the half
  of `REPORT_REASONS`-drift a SQL suite can see.
- [ ] 5.20 `created_at` is **not** in the INSERT column grant: a client naming it is refused
  `42501`. Assert the grant from `information_schema.column_privileges` too, scoped to
  `authenticated` — a table-wide count reads high because `postgres` and `service_role` hold
  everything by Supabase default (`015`'s trap).
- [ ] 5.21 **No UPDATE and no DELETE**, policy *and* grant, for `authenticated`. Read the sorted
  `cmd` list from `pg_policies` rather than a count — a count of 2 also passes for a set that swapped
  SELECT for UPDATE (`088` §3's trap).
- [ ] 5.22 `anon` holds **no** privilege on the table and **no policy targets a role other than
  `authenticated`**.
- [ ] 5.23 `has_table_privilege('service_role','public.club_thread_reports','select')` is **false**
  — and, in a rolled-back transaction, deleting a reporter's `profiles` row **as `service_role`**
  still removes their reports. `076` §3b's measurement, repeated because the failure mode is account
  deletion breaking with nothing in CI to notice.
- [ ] 5.24 **Cascades**: deleting the thread removes its reports; deleting the club removes them
  through the thread; deleting the reporter's profile removes them.
- [ ] 5.25 Every FK into `profiles` on the new table leads an index — the `pg_constraint`/`pg_index`
  form `029` uses, never a timing.
- [ ] 5.26 `enforce_participation_gate` is present **by table name** on `club_thread_reports`, and
  the flat count equals §0.4's number **+ 1**. Both, because a count alone cannot tell a new gate
  from a moved one. Then assert the gate bites: a rider with `terms_accepted_at` NULL is refused
  `23514`.
- [ ] 5.27 `private` reachability, all four false: `has_schema_privilege('authenticated','private',
  'usage')`, `has_schema_privilege('anon','private','usage')`,
  `has_table_privilege('service_role','private.club_thread_report_queue','select')`,
  `has_function_privilege('service_role','private.remove_reported_thread(uuid)','execute')` — and
  `has_function_privilege('authenticated', …)` on the last one too.
- [ ] 5.28 Re-run the whole suite and **compare label sets, not counts** — a count cannot tell a
  rename from a loss, which is what `038` did to one of `036`'s assertions.

## 6. `094` §5 — the reader, and the client

- [ ] 6.1 `private.club_thread_report_queue`, `with (security_invoker = false)` **written out** —
  it is the default and it is the entire reason the view can answer, so leaving it implicit would be
  a load-bearing default nobody can see (`076` §1). Columns: report id, reported_at, reason, note,
  reporter uuid **only**; thread id, title, created_at, message count; club id, name, is_public;
  author id and username; `reports_on_this_thread` and `reports_on_this_author`, both commented as
  **OPEN** counts that the take-down zeroes.
- [ ] 6.2 `private.remove_reported_thread(target uuid) returns jsonb` — **not** `security definer`,
  granted to nobody, `set search_path = ''`, reading the evidence **before** the delete. Returns the
  thread, the club, the author, the reports, and the messages capped at 200 with a `messages_total`
  beside them (`design.md` D12). A missing thread returns `{"removed": false}` rather than raising —
  `076`'s shape, for its reason.
- [ ] 6.3 `revoke all on private.club_thread_report_queue from public, anon, authenticated,
  service_role;` and the same on the function. **The grant IS the access control here**, RLS being
  irrelevant to a view running as its owner.
- [ ] 6.4 A `§Operating it` footer in the migration, `076`'s: what to run, in what order, and the
  one-line union against `private.postcard_report_queue` for an operator who wants both queues in
  one pane (Q6). Say plainly that **there is no `resolved_at`** and why.
- [ ] 6.5 `src/lib/validation/clubs.ts` — `reportClubThreadSchema` (`threadId` uuid, `reason`,
  `note`). **Import `REPORT_REASONS` and `REPORT_REASON_WHEN_UNDRAWN` from
  `@/lib/validation/comments`; do not copy the list.** One list, two subjects, and its docstring
  must repeat that the CHECK is the guarantee and Zod is the message.
- [ ] 6.6 `src/lib/actions/club-threads.ts` — `reportClubThread(threadId)`, a plain async function.
  Upsert with `onConflict: 'reporter_id,thread_id', ignoreDuplicates: true`, matching
  `reportPostcard`: there is no UPDATE grant, so the default `on conflict do update` would fail
  `42501`, and a duplicate report should be a no-op rather than an error the rider reads.
  **`invalidate` nothing** — nothing readable changed — and say so in the docstring, because "every
  action invalidates something" is the reflex.
- [ ] 6.7 `ThreadOptions` in `src/app/(app)/clubs/detail/thread/page.tsx`:
  `canModerate={club.data.viewer_is_owner || club.data.viewer_role === 'admin'}`. **Not**
  `viewer_role === 'owner' || …`, which drops the ownerless owner — the client half of `design.md`
  D2. Update the existing comment there, which currently explains why the row is gated on
  `viewer_is_owner`.
- [ ] 6.8 A `Report thread` row, `ReportIcon`, drawn for every viewer who is **not** the author, and
  for nobody else. One tap, banner *"Thread reported"*, **no navigation** — the thread is still
  readable, so a route change would be a lie about what happened. `PostcardMenu.onReport` is the
  model, including sending `REPORT_REASON_WHEN_UNDRAWN`.
- [ ] 6.9 The sheet-with-no-rows rule still holds: `ThreadOptions` returns `null` only when the
  viewer has **no** row at all. With Report now available to every non-author member, the empty case
  is narrower than it was — re-derive the condition rather than editing the existing `if`.
- [ ] 6.10 A confirm sheet behind the moderation delete, naming the collateral — every message in
  the thread, and the reports about it. `docs/reference/design-system.md` §The ⋯ options menu;
  `DeleteRideControl` and `DeleteClubControl` are the models, and **close the first sheet before
  opening the second**. Q4 decides whether the author's own delete adopts the same sheet; the
  default is yes, one implementation.
- [ ] 6.11 Types in `src/types/index.ts` if anything new crosses a boundary. Nothing here should —
  the report action returns `ActionState` — so an addition is a signal to re-check §6.6.

## 7. Ordering — the one part that cannot be reordered

- [ ] 7.1 Merge to `development`.
- [ ] 7.2 **Apply `094` to DEV BEFORE the Preview serves the new bundle.** Additive in both halves,
  and both fail safe in this direction only (`design.md` D13): the reverse gives an admin a Delete
  row that returns `42501` and a rider a Report row that returns `PGRST205`.
- [ ] 7.3 **Hand-exercise on DEV, in a rolled-back transaction, as `authenticated`** — `036`'s gate,
  which fires here because a **live function is replaced** rather than because a trigger is hung:
  an owner moderates (succeeds), an admin moderates (succeeds), a plain member (refused), a
  stranger (refused, same message). Then the `service_role` cascade check from §5.23.
- [ ] 7.4 `get_advisors(security)` on DEV. **Expect NO new advisor** — widening an existing
  `security definer` function adds none, and both new objects are in `private`. A new
  `authenticated_security_definer_function_executable` means something was created in `public` by
  mistake. Compare against §0.6's baseline.
- [ ] 7.5 Re-run `list_migrations` against DEV against `ls supabase/migrations/`, and record the
  applied state with the command rather than a number typed by hand.
- [ ] 7.6 Promote to `main`, confirm production is serving, then apply `094` to PROD **in filename
  order with everything else the gap contains** — `092`, `093` and this file may all be waiting, and
  the promotion is the one job that reads that gap. Repeat 7.3 and 7.4 there.

## 8. Tests

- [ ] 8.1 `PGPASSWORD=postgres npm test` — the RLS suite, green, with §5 in it.
- [ ] 8.2 A component test for `ThreadOptions` asserting **which rows each viewer gets**, from
  `design.md` D10's table: the author sees Delete and **no Report**; a plain member sees Report and
  **no Delete**; an admin sees both; an ownerless owner sees both. **The absence assertions are the
  point** — `RideInviteJoin`'s test is the precedent for asserting that something is not there, and
  a test that only checks rows render cannot see the defect this change can introduce.
- [ ] 8.3 Assert the moderation row is behind a confirm — that a single tap on it deletes nothing.
  The invariant a refactor silently reverses.
- [ ] 8.4 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 8.5 `npm run walk` reaches the thread route; confirm it still renders. `WALK_FIXTURES=1` if
  the club fixture is needed.
- [ ] 8.6 `npm run docs:check` after §9.

## 9. Documentation

- [ ] 9.1 `docs/reference/schema.md` — a new `club_thread_reports` row carrying its audience
  predicate, its per-column grants, its cascade behaviour and its **retention**; and an edit to the
  `club_threads` row for the widened moderation authority.
- [ ] 9.2 `docs/reference/product-scope.md` — the Clubs row and the Trust & safety row, for what
  thread moderation and reporting now cover and what they deliberately do not (no in-app queue, no
  admin-visible report, no notification).
- [ ] 9.3 `docs/FIGMA-FIDELITY-TODO.md` — a thread-report entry beside the postcard one, recording
  that no reason step is drawn and that `reason` therefore carries no signal (Q2).
- [ ] 9.4 Do **not** edit `CLAUDE.md` or `docs/HANDOFF.md` from an agent; the main thread owns both.
  The gate-trigger count moves and the `moderate_club_thread` description in §Supabase Rules'
  advisor table becomes stale — both are that thread's to write.
