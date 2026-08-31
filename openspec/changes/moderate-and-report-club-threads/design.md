# Design — moderate-and-report-club-threads (PD-348)

Two halves, one migration. The admin arm is three lines of SQL and one line of TSX; the reporting
half is a table, two policies, a queue, a take-down and a menu row. Everything below that is a
decision is numbered `D`; everything that is a question the build cannot answer is in
`proposal.md` §Open questions. **§Questions Closed** at the foot records the ones that were
questions and are not any more, with what closed them.

**Read before this file:** `supabase/migrations/082_club_discussions_become_threads.sql` §6c (the
function being widened), `085_club_join_requests.sql` §2 (`is_club_admin_for`),
`088_manage_club_riders.sql` (the disjunction already in use), `011` §4 (`postcard_reports`) and
`076_reports_have_a_reader.sql` (the reader, entire).

---

## D1 — The widened function delegates to `private.is_club_admin_for`, and writes no second spelling of "owner or admin"

`085` §2 defines it, verbatim:

```sql
create or replace function private.is_club_admin_for(candidate uuid, target_club uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clubs c
                  where c.id = target_club and c.owner_id = candidate)
      or exists (select 1 from public.club_members m
                  where m.club_id = target_club and m.user_id = candidate
                    and m.role in ('owner', 'admin'));
$$;
```

So the widened body is:

```sql
  select d.id
    into v_id
    from public.club_threads d
   where d.id = thread
     and private.is_club_admin_for(v_uid, d.club_id)
     for update of d;
```

**The join to `clubs` disappears and that is not a loss.** `082` joined `clubs` only to reach
`owner_id`; the helper's first disjunct reads the same column, and `club_members.club_id` carries a
foreign key into `clubs`, so the second disjunct cannot be true for a club that does not exist.
`for update of d` is still legal — it names the only table left.

**Two shapes that look equivalent and are wrong:**

- **`m.role in ('owner','admin')` alone**, dropping the `clubs.owner_id` disjunct. This is the
  regression D2 is about. It reads as the tidier predicate and it silently removes an owner who
  holds no roster row.
- **`c.owner_id = v_uid or private.is_club_admin_for(v_uid, d.club_id)`**, keeping the old conjunct
  and adding the helper beside it. Redundant — the helper's first disjunct *is* that predicate —
  and two spellings of one rule is how they drift. `088` writes `not
  private.is_club_admin_for(v_uid, target_club)` and nothing else; copy that.

**`moderate_club_thread` may call a `private` function no client can execute**, because it is
itself `security definer` and therefore runs as the owner. `085` revokes `is_club_admin_for` from
`public, anon, authenticated` and grants it to nobody; `085`'s own `approve_club_join_request` calls
it anyway, for exactly this reason. **Do not add a grant to make it "work"** — if it appears not to,
the caller is wrong, not the ACL.

## D2 — `clubs.owner_id` versus `club_members.role`, and why the widening cannot regress the owner

`043` gates `delete_owned_club` on the **column**. `082` gates `moderate_club_thread` on the
**column**. `019` pins the only legitimate `role = 'owner'` roster row to that same column, and
`054` gives the owner membership-shaped reach without requiring a roster row. **An owner holding no
`club_members` row is a reachable state today** — PD-128, and `enforce-creator-membership` is a
separate open change that has not landed.

`is_club_admin_for`'s **first** disjunct is `clubs.owner_id = candidate`. So the widening preserves
the owner arm *by construction* rather than by remembering to re-add it, and the ownerless owner
keeps a reach they hold today. That is the single reason this change delegates to that helper
instead of writing its own disjunction, and `tasks.md` §0.5 pins the helper's body **by equality**
before trusting it — `085.28`'s rule, because a mention of the name in a comment satisfies a `like`.

**The client gate has the identical trap and it is one character shorter to get wrong.**
`ClubDetail` carries both `viewer_is_owner` (a boolean off `clubs.owner_id`) and `viewer_role` (the
roster row, nullable). The menu gate is:

```tsx
canModerate={club.data.viewer_is_owner || club.data.viewer_role === 'admin'}
```

**Not** `viewer_role === 'owner' || viewer_role === 'admin'`, which drops the ownerless owner —
`src/types/index.ts:1008` already records that the difference is load-bearing (PD-280), and the
thread page's existing comment says the same thing about the row it draws today.

## D3 — `create or replace`, never drop-and-recreate

The signature is unchanged (`thread uuid`), so `create or replace` is available, and it **preserves
the ACL and the OID**. A drop-and-recreate is born `EXECUTE` to `PUBLIC` — which includes `anon` —
and `082` §7 is the worked example of having to re-issue `revoke all … from public, anon` plus
`grant execute … to authenticated` afterwards to undo it. `082` had no choice (its name and its
parameter both changed); this change does.

The assertion is cheap and belongs in the suite either way: `has_function_privilege('anon',
'public.moderate_club_thread(uuid)', 'execute')` is false, and `('authenticated', …)` is true,
**after** the migration.

## D4 — One raise site, and the null session falls into it

`082` has exactly one `raise`. `088`'s three RPCs have two — a `requires a session` raise ahead of
the main one — and this change does **not** copy that, deliberately:
`is_club_admin_for(null, club)` is false on both disjuncts, so a session-less caller reaches the
same refusal as a stranger, and a second exit buys nothing a caller does not already know about
their own session. Keeping one raise is also what makes the assertion in §The negative cases N5
writable as a **string equality** between two refusals.

The message follows `082`'s wording rather than inventing one. Nothing reads it — `grep -rn "no
thread with that id" src/` is the check — so it is vocabulary, not contract, and the client already
maps any RPC failure to *"That thread could not be deleted."*

## D5 — A new table, not a widened `postcard_reports`

**Decision: `public.club_thread_reports`.** Four independent reasons, of which the third alone
would settle it:

1. **The subject column cannot be shared without going nullable.** `postcard_reports.postcard_id`
   is `NOT NULL` with an FK to `postcards` and a `unique (reporter_id, postcard_id)`. Widening
   means dropping the NOT NULL, adding a nullable `thread_id`, adding a CHECK that exactly one is
   set, and replacing the unique constraint with two **partial** unique indexes. Every one of those
   is a change to a live table that a rider writes to today, for a feature that touches none of its
   rows.
2. **The audience predicates are different and cannot share a policy.** `011`'s INSERT policy
   inherits the block, club and hide predicates *by an `EXISTS` against `postcards`* — its stated
   virtue is that it names none of them. A thread report must `EXISTS` against `club_threads`,
   which inherits membership and a differently-shaped block arm. One table means a branching
   `with check` that names both, and the property `011` was written for is gone.
3. **There is a live reader and its join is unconditional.** `private.postcard_report_queue` joins
   `public.postcards` and `public.profiles` with plain inner joins. A thread report inserted into
   `postcard_reports` would either break that view or — with a `left join` "fix" — quietly vanish
   from the queue the operator reads. **A report that lands in a table nobody's query returns is
   worse than no table**, and it is the exact failure `011` spent sixty-five migrations in.
4. **The repo's own shape is one table per subject.** `postcard_likes`, `postcard_comments`,
   `postcard_hides`, `postcard_reports` — four tables, one subject each, and `club_thread_reads`
   and `club_thread_waves` follow it on the thread side.

**The cost, stated rather than hidden:** two report tables mean two queues (Q6) and two places to
keep the reason list in step with `REPORT_REASONS`. The second is a real risk — `011` already
records that the Zod enum and its CHECK are kept in step by hand with no automated check — so
`tasks.md` §5.19 asserts the CHECK's accepted set from SQL, which is the half a test *can* see.

## D6 — Who may report is decided by the policy, not by intuition, and the two candidate sets are the same set minus one rider

The candidate readings were "any member of the club" and "anyone who can read the thread". Read off
`pg_policies` on DEV, 2026-08-31, `club_threads` SELECT is:

```
EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_threads.club_id)
AND private.is_club_member(club_id)
AND (author_id = auth.uid() OR NOT private.is_blocked(auth.uid(), author_id))
```

So the two sets are identical **except for the block arm**: a member who is blocked with the
author reads zero rows and is therefore not in the second set. Everything else lines up —
`is_club_member` includes the owner through `054`'s arm, and a non-member of a **public** club is
excluded by the membership conjunct even though they can read the club row.

**The specification is the second set**, written as `011`'s single `EXISTS`:

```sql
with check (
  reporter_id = auth.uid()
  and exists (select 1 from public.club_threads d where d.id = club_thread_reports.thread_id)
)
```

The `EXISTS` is evaluated under the **caller's** RLS, which is the whole mechanism — the policy
names no membership predicate, no club predicate and no block predicate, and inherits all three.
Writing `private.is_club_member(...)` here instead would be a second copy of `081`'s audience that a
future change to `081` cannot reach.

## D7 — The reader is the platform operator, and the club's own leadership reads nothing

This is the `076` question and it is the one with a victim if it is wrong.

**Rejected: the club owner and admins read reports for their club.** It is the intuitive design —
they are the people who can act, and half one of this very change gives them the delete. Three
reasons it is refused:

1. **The reported party is frequently the reader.** A thread's author can be the club's owner or an
   admin. A policy keyed on `is_club_admin_for` hands the reported rider the report about
   themselves — the exact thing `rls_test.sql` already asserts is impossible for a postcard.
2. **A small club leaks the reporter without a `reporter_id`.** Even an unattributed flag narrows
   the reporter to "one of the four other members". Retaliation in a club is not hypothetical: the
   admin can now remove the rider (`088`) and delete their thread (this change).
3. **It is a moderation product, not a policy.** A queue somebody works needs a resolution state,
   which needs an UPDATE grant, which `011` and `076` both deliberately refuse — *"that is a
   moderation product's column … adding one would make the queue a workflow with two writers."*

**So: `private.club_thread_report_queue` and `private.remove_reported_thread(uuid)`, owner-at-the-
dashboard, `076` line for line.** The two-layer barrier is `076`'s and both layers are stated
because neither is sufficient alone: `anon` and `authenticated` hold no USAGE on `private` (`005`),
and `service_role` **does** (`031`), so the revoke names it explicitly.

**Q1 asks the owner to confirm this**, because a report filed under "nobody in my club sees this"
cannot be re-filed under a different rule later.

## D8 — A report notifies nobody, and that is three separate refusals

- **Not the author.** Telling a rider they were reported is telling them there is a reporter, and
  N15 exists to stop exactly that inference.
- **Not the club's admins.** That is Q1 wearing a different hat; a notification is a stronger
  disclosure than a flag, not a weaker one.
- **Not the reporter.** A confirmation banner is the client's job and needs no row. `036`'s
  `notifications` table gains no type, no subject column and no CHECK arm — which also means this
  change cannot break `notificationCopy` or `NotificationsListItem`'s exhaustive `describe`, and
  therefore carries **none** of `089`'s client-ordering constraint.

## D9 — Block-then-report is unreachable, by construction, and is inherited rather than introduced

A rider who blocks the author first can no longer read the thread, so the INSERT policy's `EXISTS`
resolves to zero and the report is refused. The identical property already holds for a postcard
under `011`. It is stated as a negative case (N14) rather than fixed, because every fix is worse:

- A `security definer` reporting RPC would step past the block to check the thread exists — and
  would then have to decide what to tell a caller about a thread they cannot see.
- A block arm exemption in the INSERT policy would let a rider probe for the existence of threads
  by blocked authors.

**The client-side remedy is ordering**, and on this screen it costs nothing: the thread menu has no
Block row (Q3), so the reachable order is already report-then-block.

## D10 — The surface: viewer x row, with the empty cells named

Both rows live on the thread detail screen's existing ⋯ menu
(`src/app/(app)/clubs/detail/thread/page.tsx`, `ThreadOptions`). **The threads list draws no
per-row menu today** — `grep -n "OptionsIcon" 'src/app/(app)/clubs/detail/threads/page.tsx'` returns
nothing — and this change adds none.

| Viewer | `Report thread` | `Delete thread` (author, policy) | `Delete thread` (moderate, RPC) |
|---|---|---|---|
| Author, plain member | **no** — their remedy is Delete, and a self-report is noise in a human's queue | **yes** | **no** — a definer function is the wider hammer; the policy suffices |
| Author, club admin | **no**, same reason | **yes** — narrower right wins | **no** |
| Author, club owner | **no**, same reason | **yes** — narrower right wins | **no** |
| Club owner, not the author | **yes** — see below | **no** — not their thread | **yes** (unchanged today) |
| Club admin, not the author | **yes** | **no** | **yes** — **this change** |
| Plain member, not the author | **yes** — **this change** | **no** | **no** |
| Member blocked with the author | screen unreachable: the thread reads zero rows, `getClubThread` answers `null`, the page 404s | — | — |
| Non-member (public or private club) | screen unreachable, identically — the 404 is deliberate, so a private club's conversation is not confirmed to exist | — | — |
| Signed-out visitor | never reaches the route; the guard redirects to `/auth/login`. `anon` holds zero grants, so a forged request reads nothing either | — | — |

**Two cells worth defending:**

- **The owner and the admin see `Report thread` as well as their delete**, because the two rows have
  different **readers**: deleting is the club acting on itself, reporting escalates to the platform
  operator. Hiding Report from the two riders most likely to spot something illegal would remove the
  only escalation path from exactly them.
- **The author sees no `Report thread` row.** The policy permits a self-report (D11) and the menu
  does not draw one; the row is a display hint, never an authorization.

**The destructive rows confirm; the Report row does not.** Per `docs/reference/design-system.md`
§The ⋯ options menu, a row whose confirmation must *name the collateral* opens a second
`ContextMenu` — and a thread deletion takes every message, every read watermark and every report
with it. `DeleteRideControl` and `DeleteClubControl` are the models, and the rule about closing the
first sheet before opening the second applies. **Today's `Delete thread` deletes on a single tap
with no confirmation of any kind**, which is a pre-existing deviation this change is well placed to
fix (Q4). Reporting is not destructive and follows `PostcardMenu`: one tap, a banner, and **no
navigation** — the thread stays exactly where it was, because reporting changes nothing the reporter
can see.

## D11 — A rider may report their own thread, and the menu will not offer it

`011` permits a self-report on a postcard (nothing in its `with check` excludes the author) and this
follows it. The alternative conjunct — `not exists (select 1 from club_threads d where d.id =
thread_id and d.author_id = auth.uid())` — is a second subquery that re-reads the author identity
in a policy whose whole virtue is naming nothing, to prevent a row that is inert, unreachable from
the UI, and visible only to an operator who can ignore it.

## D12 — What the take-down hands back, and the cap that makes truncation loud

`private.remove_reported_thread(target uuid)` follows `076`'s function exactly: not `security
definer` (its only caller is already the owner, and marking it definer would add an advisor for a
function no `authenticated` session can execute), granted to nobody, `set search_path = ''`, and it
**reads the evidence before the delete** because the delete destroys it.

It returns the thread's title, its club, its author (id and username), the reports with their
reasons, notes and reporter uuids — and, unlike `076`, **the messages**, because the reportable
content of a thread is mostly its replies rather than its title. Capped at 200 in
`created_at` order with a `messages_total` beside it: the cap keeps a result pane readable and the
count is what makes a truncation visible rather than silent.

**The cascade list is read off `pg_constraint` at write time, never remembered.** `076`'s header
records naming one of five. Today `club_messages`, `club_thread_reads` and (after this change)
`club_thread_reports` hang off `club_threads`; `092` adds `club_thread_waves` if it lands first, and
`036`'s `notifications` has no `thread_id` column so it is **not** in the chain.

## D13 — Ordering: additive, and the migration goes first

Every object here is additive — one new table, two new policies on it, one new trigger on it, two
new `private` objects, and one function replaced with a strictly wider one. Nobody loses a right and
no existing row changes shape, so `069`'s rule applies in its ordinary direction: **apply `094`
before the bundle that calls it serves.**

Both halves fail safe in that order and neither does in the reverse:

- Migration first, client second: an admin simply does not see the moderation row yet, and no rider
  sees a Report row. Nothing is broken; a capability is merely not yet drawn.
- Client first, migration second: an admin taps Delete and gets `42501` behind *"That thread could
  not be deleted."*, and a rider taps Report and gets `PGRST205` (no such table) behind *"Could not
  send that report."* Two rider-visible failures for the length of a deploy.

**`036`'s hand-exercise gate fires, and not for the reason it usually does.** This file hangs no
trigger on an already-shipped write path — the gate trigger is on the new table. But it **replaces
a function that owners call today**, so from the moment it applies every existing moderation runs
new code inside a rider's own transaction. Exercise it by hand on DEV first, in a rolled-back
transaction, as `authenticated`: an owner still succeeds, an admin now succeeds, a plain member is
refused (`tasks.md` §7.3).

---

## Questions Closed

Recorded because each was open long enough to be worth a sentence, and because the next reader will
otherwise re-derive the wrong answer from the same evidence.

- **"Does widening `moderate_club_thread` add a security advisor?" — No.**
  `authenticated_security_definer_function_executable` fires **once per PUBLIC `security definer`
  function executable by `authenticated`**, and this function already is one. The count moves by the
  number of new PUBLIC functions, and this change adds none — the queue and the take-down are in
  `private`. Closed by `088`'s own note (three published functions, 21 → 24) and by the proxy query
  in `tasks.md` §0.6, which answers **24** on DEV today. `085`'s eight `private` helpers adding zero
  advisors between them is the same rule from the other side.
- **"Should the admin arm be a second DELETE policy arm instead of an RPC?" — No.** `081` measured
  it: RLS filters a DELETE by what the caller may READ, so an admin who has blocked the thread's
  author matches zero rows and PostgREST reports success. The RPC exists for that reason and the
  admin arm inherits it. Closed by `081` §4 and asserted here (N8).
- **"Does an owner with no roster row lose the moderation right?" — No, by construction.** Closed by
  reading `is_club_admin_for`'s first disjunct (D2), not by testing two fixtures that happen to
  agree.
- **"Can `moderate_club_thread` reach `private.is_club_admin_for` when no client role holds EXECUTE
  on it?" — Yes.** It is `security definer`, so it runs as the owner. Closed by `085`'s
  `approve_club_join_request`, which does the same thing today.
- **"Widen `postcard_reports` or add a table?" — Add a table.** Closed by D5, and decisively by the
  live `private.postcard_report_queue`'s unconditional join to `postcards`.
- **"Are 'any member' and 'anyone who can read the thread' the same set?" — Yes, minus a rider
  blocked with the author.** Closed by reading `pg_policies` on DEV (D6), which is the only way this
  question has a defensible answer.
- **"Does `service_role` get privileges on a new `public` table by default?" — Yes.** `011` revoked
  from `anon, authenticated` only, and `076` §3b found `service_role` holding SELECT, INSERT,
  UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on `postcard_reports` sixty-five migrations
  later. Closed by naming `service_role` in the revoke at creation, and by `076`'s measurement that
  a referential cascade does not consult privileges — so account deletion is unaffected.
- **"Is the gate-trigger count 17?" — It is 17 today and it will not be when this applies.** `092`
  adds two before this file. Closed by expressing the claim as a delta (+1) and re-measuring in
  §0.4. The `comment on function public.enforce_participation_gate()` currently reads *"seventeen
  BEFORE INSERT triggers"* and names `ride_invite_links (091)` as the seventeenth — re-read the
  **live** comment before editing it, because `092` rewrites the same string and the last writer
  wins.
