# Tasks — notify a club thread (`098`)

**Migration number is `098` and it is fixed.** `097` belongs to
`openspec/changes/introduce-yourself-on-joining-a-club/`, `099` to PD-368. **Do not touch that
directory, and do not touch a column of `club_threads`.** If both stories are in flight at once, use
`isolation: "worktree"` — they must never share a working tree or a migration file.

Branch off `development`, PR into `development`.

---

## 0. Before anything

- [x] **0.1** `openspec validate` — **run 2026-09-01, valid in both modes.** Re-run it after any
      edit to these artifacts: it is the **only** automated gate they have, `openspec/` being in
      `ci.yml`'s denylist.

      ```bash
      node_modules/.bin/openspec validate notify-a-club-thread --type change
      node_modules/.bin/openspec validate notify-a-club-thread --type change --strict
      ```

      **There is no `--change` flag** — it is a positional item name plus `--type change`, or
      `--changes` for all of them. `--change` fails as an unknown option, which reads like a broken
      artifact rather than a broken command.
- [x] **0.2** **Q4 answered — order A, migration-first.** Decided by the main thread 2026-09-01 on
      three measurements rather than on the recommendation alone; §7 carries them and strikes order
      B. `design.md` §D11 carries the analysis.
- [ ] **0.3** Re-derive the pre-flight, on **both** projects, and paste the results into `098`'s
      §0 header rather than into a report that does not travel with the file:

      ```sql
      select pg_get_constraintdef(oid) from pg_constraint
       where conrelid='public.notifications'::regclass
         and conname in ('notifications_type_check','notifications_subject_shape');
      select indexname, indexdef from pg_indexes
       where schemaname='public' and tablename='notifications';
      select polname, pg_get_expr(polqual,polrelid), pg_get_expr(polwithcheck,polrelid)
        from pg_policy where polrelid='public.notifications'::regclass;
      select count(*) from public.notifications;                     -- DEV 18, PROD 15 (2026-09-01)
      --   ^ a live count that moves with ordinary use; re-derive, never carry it forward
      select count(*) from public.club_threads;                      -- DEV 4,  PROD 0
      select count(*) from pg_trigger
       where tgname='enforce_participation_gate' and not tgisinternal;   -- 22, both
      select n.nspname||'.'||p.proname as fn, m[1] as clause
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral regexp_matches(p.prosrc, 'on conflict[^;]{0,80}', 'gi') m
       where p.prosrc ilike '%insert into public.notifications%'
       order by 1, 2;              -- 13 functions, every clause BARE (2026-09-01)
      ```

      **The last one is load-bearing.** If any write site names the index or its columns, the rebuild
      breaks it at runtime inside a rider's write and this change needs that function replaced too.

      **Do not narrow it to `nspname='private' and proname like 'notify%'`, and do not use
      `position()`.** That form returns twelve and misses `public.approve_club_join_request`, which
      inserts into `notifications` from `public` under a name that is not `notify%`; and `position()`
      returns the FIRST occurrence, which for that function and for
      `private.notify_club_join_request_declined` is inside a **comment** — the comment trap at a
      `position()` rather than a `grep`. Select on *"inserts into `public.notifications`"* and return
      **every** match, so a fourteenth site cannot hide from the gate.

---

## 1. `supabase/migrations/098_a_club_thread_notifies.sql`

Append-only. Never edit an applied migration.

- [ ] **1.1 Header.** State, in this order: that it is **additive in schema and NOT inert** (two
      live write paths gain new code from the instant it applies); the two write paths by name
      (`club_messages` INSERT, `club_thread_waves` INSERT and DELETE); `036`'s hand-exercise gate;
      the §0 pre-flight measurements; the rollback, **in order**; and the apply-order decision from
      Q4 with its reasoning, not just its conclusion.
- [ ] **1.2 Rollback, written in the header in this exact order** (step 3 before step 4 is not
      optional — the narrowed CHECK is validated against existing rows and a live row of a new type
      makes the `add constraint` fail):
      1. drop the three triggers;
      2. drop the three `private` functions;
      3. `delete from public.notifications where type in ('club_thread_replied','club_thread_waved');`
      4. restore both CHECK constraints to their fourteen-type form (record the exact prior text,
         measured, in §0);
      5. restore the SELECT and UPDATE policies to their prior text (likewise recorded verbatim);
      6. rebuild `notifications_event_key` over its seven columns;
      7. `drop index public.notifications_thread_id_idx;`
      8. `alter table public.notifications drop column thread_id;`
      9. restore the two `comment on function` statements.
- [ ] **1.3 §1 — the column.**
      `alter table public.notifications add column thread_id uuid references public.club_threads(id) on delete cascade;`
      plus a `comment on column` saying it is the subject of a thread notification and is NULL on
      every other type.
- [ ] **1.4 §2 — the partial index.**
      `create index notifications_thread_id_idx on public.notifications (thread_id) where thread_id is not null;`
      Comment: `thread_id` is the **seventh FK column** (so the seventh usable cascade index) and
      the **fifth partial subject index** — partial for the reason the other four subject indexes
      are. The two ordinals differ because `actor_id` has an index and it is not partial; state both
      rather than one, since a single number here has been wrong twice.
- [ ] **1.5 §3 — the CHECK rewrite. SIXTEEN arms.** Drop and re-add both constraints whole.
      `notifications_type_check` gains `club_thread_replied` and `club_thread_waved`.
      `notifications_subject_shape` gains two arms **and** `and thread_id is null` on each of the
      fourteen existing ones. Keep `ELSE false`. Comment at the site saying why the fourteen matter
      as much as the two.
- [ ] **1.6 §4 — the uniqueness rebuild**, in this order, inside the file's transaction:
      ```sql
      create unique index notifications_event_key_v2 on public.notifications
        (user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id, thread_id)
        nulls not distinct;
      drop index public.notifications_event_key;
      alter index public.notifications_event_key_v2 rename to notifications_event_key;
      ```
      Comment: `thread_id` **appended last** so the seven-column prefix every retraction uses is
      unchanged; it is a plain UNIQUE INDEX and not a table constraint (measured); every existing row
      has it NULL and `nulls not distinct` compares NULLs equal, so no equivalence class splits; all
      THIRTEEN write sites use a bare `on conflict do nothing` (measured — twelve `private.notify_*`
      plus `public.approve_club_join_request`), so none names it. **Not
      `concurrently`** — that cannot run in a transaction block, and the table holds 18 / 15 rows.
- [ ] **1.7 §5 — the two policies.** Drop and re-create the SELECT and the UPDATE policy with the
      conjunct
      `and (thread_id is null or exists (select 1 from public.club_threads t where t.id = notifications.thread_id))`
      added in the same place in both, `using` and `with check`. **Preserve `089`'s and `093`'s
      type-scoped disjuncts verbatim** — dropping them takes those two types' notifications down
      silently. Policy comment saying the conjunct exists and must not be simplified away.
- [ ] **1.8 §6 — `private.notify_club_thread_replied()`.** `security definer`, `set search_path = ''`,
      everything schema-qualified, one `insert … select` joining `public.club_threads` on
      `new.thread_id`, `where t.author_id <> new.author_id and not private.is_blocked(new.author_id,
      t.author_id)`, `on conflict do nothing`, `return null`. No `auth.uid()`. No `current_user`
      branch. No `private.is_club_member`.
- [ ] **1.9 §7 — `private.notify_club_thread_waved()`.** The same, with `new.user_id` as the actor.
- [ ] **1.10 §8 — `private.retract_club_thread_waved()`.** Delete scoped by **all four** of
      `user_id`, `type`, `actor_id`, `thread_id`. Comment carrying the aim-at-another-rider argument
      and the do-not-add-a-`pg_trigger_depth`-guard rule.

      **The recipient is NOT on the deleted row — join `public.club_threads` for it, and tolerate it
      being gone.** `club_thread_waves` is `(thread_id, user_id, created_at)`, so
      `club_threads.author_id` must be looked up. **`092`'s `retract_club_waved` cannot be copied
      here**: it reads all four scope columns off `OLD`, because `club_join_waves` carries
      `subject_user_id`, `user_id` **and** `club_id`.

      ```sql
      delete from public.notifications n
       using public.club_threads t
       where t.id       = old.thread_id
         and n.user_id  = t.author_id
         and n.type     = 'club_thread_waved'
         and n.actor_id = old.user_id
         and n.thread_id = old.thread_id;
      ```

      **On the cascade path this deletes ZERO rows, by design.** When a thread is deleted the FK
      cascade issues `delete from club_thread_waves where thread_id = …`, and the `club_threads` row
      is **already gone** when that statement fires its `AFTER DELETE` triggers — so the join finds
      nothing. `notifications.thread_id`'s own cascade removes the rows. Do **not** describe this as
      redundant; there is no duplicate removal.

      **`select … into strict`, `PERFORM` + `if not found then raise`, or any raise on the empty case
      is a THREAD THAT CANNOT BE DELETED.** `NO_DATA_FOUND` inside the cascade aborts the whole
      statement, taking `moderate_club_thread`, `remove_reported_thread`, club deletion and account
      deletion with it — fan-out failures are deliberately not swallowed. The `using` join above, or a
      scalar subquery compared with `=` (NULL matches nothing), are the two forms that are safe.
- [ ] **1.11 §9 — revokes.**
      `revoke all on function … from public, anon, authenticated, service_role;` for all three.
      Revoking from `public` is what does the work; EXECUTE is granted to PUBLIC by default.
- [ ] **1.12 §10 — the three triggers.** `after insert on public.club_messages`,
      `after insert on public.club_thread_waves`, `after delete on public.club_thread_waves`. **No
      `WHEN` clause on any of them**, with the reason at the site — the participation gate on the
      same two tables carries one and is correct to.
- [ ] **1.13 §11 — the two comment corrections.**
      Re-issue `comment on function private.notify_club_waved()` with the sentence *"A THREAD wave
      notifies nobody at all; there is deliberately no notify_club_thread_waved"* replaced.
      Re-issue `comment on function private.remove_reported_thread(uuid)` recording that
      `notifications.thread_id` **is** now in that function's cascade chain. **Do not `create or
      replace` either function** — see `design.md` §D13.
- [ ] **1.14 §12 — the verification block**, in the header, listing what to run against the hosted
      project after apply: the index set, the policy text, the advisor count, the gate count, and the
      two hand exercises.

---

## 2. `supabase/tests/rls_test.sql`

**Every migration in this change owes assertions here, per `openspec/config.yaml`.** Number them
`098.1` … `098.N`, following `096.10`'s convention. Add them at the end of the file.

### The fan-outs

- [ ] **2.1 `098.1`** — a reply by another member writes exactly one row, addressed to
      `club_threads.author_id`, carrying `thread_id` and nothing else.
- [ ] **2.2 `098.2`** — the thread's author replying in their own thread writes **zero** rows.
- [ ] **2.3 `098.3`** — **with a prior replier present**, only the author is notified: not the club's
      owner, not an admin, not another member, not the prior replier. A single-participant thread
      cannot distinguish author-only from participants, so the extra rider is what makes this
      assertion able to fail.
- [ ] **2.4 `098.4`** — a wave by another member writes exactly one row; the author waving their own
      thread writes zero.
- [ ] **2.5 `098.5`** — **two replies in two different threads of the same club, same actor, same
      recipient → TWO rows.** This is the exact case the seven-column key swallowed and the one no
      error would ever report.
- [ ] **2.6 `098.6`** — ten replies by one rider in one thread → **one** row, and its `created_at` is
      the first reply's.
- [ ] **2.7 `098.7`** — five different repliers → five rows, all to the author.
- [ ] **2.8 `098.8`** — a reply inserted **as the table owner** (so the gate's `WHEN` clause is false)
      still fans out. This is what a copied `WHEN` clause would break, and every other assertion in
      this block depends on it.

### Blocking, both directions, both fan-outs

- [ ] **2.9 `098.9`** — a block existing **before** the action produces no row, for both types, with
      the parent inserted as the owner so the policy cannot be what refused it. Assert in **both**
      block directions.
- [ ] **2.10 `098.10`** — a block created **after** the row hides it from the recipient, and the
      unread count falls by the same number. Assert with the riders exchanged.
- [ ] **2.11 `098.11`** — unblocking returns the row with its original `created_at` and read state.
- [ ] **2.12 `098.12`** — a rider blocked with the **thread's author** (rather than the actor) also
      stops reading the row, by the `club_threads` conjunct. Asserted separately from `098.10`,
      because one assertion cannot say which mechanism fired.

### Readability — a row nobody can read is a defect

- [ ] **2.13 `098.13`** — the recipient can **read the row back** under their own session, for both
      types. Not "a row was written".
- [ ] **2.14 `098.14`** — **the author who LEAVES the club reads zero**, and the row still exists in
      the table. Then rejoining returns it, unread state and `created_at` intact. Assert the
      non-obvious half explicitly: authoring the thread is **not** sufficient, because
      `club_threads` SELECT's own-row arm sits inside its block conjunct and `private.is_club_member`
      dominates it.
- [ ] **2.15 `098.15`** — a non-member cannot read the row, the thread, the title or the club, on a
      private club.
- [ ] **2.16 `098.16`** — no rider other than the recipient reads the row by any filter, including a
      known row id. Assert for the actor specifically.
- [ ] **2.17 `098.17`** — an ownerless owner receives nothing (trivially true today; asserted because
      it is the invariant a widening would break).

### The retraction

- [ ] **2.18 `098.18`** — un-waving removes the matching row.
- [ ] **2.19 `098.19`** — **two actors**: A and B both wave, A un-waves, A's row goes and B's
      survives. A single-actor assertion cannot fail.
- [ ] **2.20 `098.20`** — a rider who has waved two threads by the same author un-waves one; only
      that thread's row goes. This is what `thread_id` in the scope buys.
- [ ] **2.21 `098.21`** — wave → un-wave → wave leaves exactly one row, and it is a **new** one with a
      new `created_at`. Assert the cost rather than hiding it.
- [ ] **2.22 `098.22`** — deleting a **reply** retracts nothing; and deleting one of three replies by
      the same rider still leaves exactly one row.

### Cascades

- [ ] **2.23 `098.23`** — deleting the thread removes both types' rows.
- [ ] **2.23a `098.23a`** — **the four cascade routes each SUCCEED with the retraction trigger
      installed**, asserted **separately** because they enter the cascade differently: the author's
      own `delete from club_threads`, `public.moderate_club_thread`, `private.remove_reported_thread`,
      and a club deletion. Set up a thread that **has a wave** in every case, or the trigger never
      fires and the assertion passes vacuously.
      **Assert that the statement succeeded, not that the notification is absent** — it is absent
      under a raising implementation too, because the transaction rolled back. This is the assertion
      that catches `select … into strict`, and nothing else in this file can.
- [ ] **2.23b `098.23b`** — on that same cascade, the retraction itself deletes **zero** rows and the
      notifications go by `notifications.thread_id`'s cascade. Assert it by dropping the
      `thread_id` FK's cascade in a rolled-back transaction, or by counting inside a statement-level
      probe — whichever the suite can express — so that "the row is gone" cannot be satisfied by the
      wrong mechanism.
- [ ] **2.24 `098.24`** — `public.moderate_club_thread` removes them; `private.remove_reported_thread`
      removes them.
- [ ] **2.25 `098.25`** — deleting the **club** removes them, through the thread, with
      `notifications.club_id` NULL on both types.
- [ ] **2.26 `098.26`** — account deletion removes them in **both** directions (recipient and actor),
      and deleting a thread's author takes the thread and its notifications with it.

### The constraints and the index

- [ ] **2.27 `098.27`** — a `postcard_liked` row with a non-NULL `thread_id` is refused; **and** a
      `ride_joined` one. Two of the fourteen, because one cannot show the arms were rewritten rather
      than one arm patched.
- [ ] **2.28 `098.28`** — a new-type row with any of `postcard_id`, `comment_id`, `ride_id`, `club_id`
      set is refused; and one with `thread_id` NULL is refused.
- [ ] **2.29 `098.29`** — an unknown type is still refused by `ELSE false`.
- [ ] **2.30 `098.30`** — **every pre-existing collapse is unchanged after the rebuild**: like →
      unlike → like leaves one row; leave-and-rejoin a ride leaves one; two riders liking the same
      postcard leaves two; two comments by one rider leave two.
- [ ] **2.31 `098.31`** — `notifications_event_key` has exactly eight columns in the stated order and
      is still `nulls not distinct`; derived from `pg_index`, not from the file.
- [ ] **2.32 `098.32`** — **seven FK columns, seven usable indexes**, derived by querying `pg_index`
      for FK columns lacking a leading-column index.

### Grants, reach and counts that must NOT move

- [ ] **2.33 `098.33`** — `authenticated` still holds no INSERT and no DELETE grant on
      `notifications`, and there is still no policy for either. Scope every grant assertion to its
      grantee or use `has_table_privilege`; a table-wide count reads 2 against a correct database.
- [ ] **2.34 `098.34`** — the UPDATE policy's predicate is still **identical** to the SELECT policy's,
      including the new conjunct, in both `using` and `with check`.
- [ ] **2.35 `098.35`** — `has_function_privilege` is false for `authenticated`, `anon` and
      `service_role` on all three new functions. Name the role; never attempt the call (`031`).
- [ ] **2.36 `098.36`** — the participation-gate trigger count is **unchanged**, and both parent
      tables still carry theirs. `096.10`'s precedent for asserting a count that stays still.
- [ ] **2.37 `098.37`** — an unconsented rider (`terms_accepted_at` NULL) is still refused a club
      message and a thread wave with `23514`, and zero notification rows exist afterwards.
- [ ] **2.38 `098.38`** — `089`'s and `093`'s type-scoped disjuncts still work after the policy
      rewrite: a declined requester still reads their `club_join_request_declined` row and an invitee
      still reads their `club_invited` row, on a **private** club. This is the assertion that catches
      a re-created policy that quietly dropped them.

- [ ] **2.39** Run the suite and **compare label sets, not counts**, against the pre-change run — a
      count cannot tell a rename from a loss:
      `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`

---

## 3. Types and the read

- [ ] **3.1** `src/types/index.ts` — add `'club_thread_replied'` and `'club_thread_waved'` to
      `NotificationType`. Add `thread: { id: string; title: string } | null` to `NotificationRow`.
      Domain types live here; do not inline them.
- [ ] **3.2** `src/lib/data/notifications.ts` — add **`thread:club_threads!thread_id(id, title)`** to
      `NOTIFICATION_SELECT`. **The FK hint is mandatory** (PD-363): a hinted embed cannot go
      ambiguous whatever a later migration adds, and **no gate in this repo can see an ambiguous one**
      — `tsc` checks a template string, ESLint reads no SQL, Vitest mocks the client, `next build`
      issues no query, and the RLS suite runs where PostgREST's relationship cache does not exist.
      Note that `!inner` is a join modifier, **not** a hint.
- [ ] **3.3** Do **not** add `thread_id` as a raw column on the select. `089`'s three types need
      their raw `club_id` because their embed cannot resolve; here the embed resolves exactly when
      the row is returned, because the policy conjunct and the embed run the same predicate under the
      same reader.
- [ ] **3.4** If any thread read in this change grows a `profiles` embed, it must be
      **`profiles!author_id`** off `club_threads` and off `club_messages`. `profiles!user_id` is
      correct off `club_members` and nowhere else here. `club_thread_waves` is a genuine junction —
      `primary key (thread_id, user_id)` over exactly its two FKs — so an unhinted `profiles` embed
      off `club_threads` is ambiguous **today**.
- [ ] **3.5** `npx vitest run src/lib/data/__tests__/embed-hints.test.ts`

---

## 4. The two exhaustive switches

Both are in `src/components/notifications/`. **There is no `src/lib/notifications/`.**

- [ ] **4.1** `copy.ts` — two cases:
      `club_thread_replied` → `` `replied to ${row.thread?.title ?? 'your post'}.` ``
      `club_thread_waved` → `` `waved at ${row.thread?.title ?? 'your post'}.` ``
      Resolve the title from the live embed, never from a stamped column — a reader who loses the
      thread loses the string with it. Keep the `const exhaustive: never` assignment **and** the
      trailing runtime `return`; the fallback alone silently deletes the compile-time guard.
- [ ] **4.2** `NotificationsListItem.tsx` — two cases in `describe`:
      `return { href: row.thread ? routes.clubThread(row.thread.id) : null }`, **no trailing
      thumbnail**. Comment saying why: a thread has no image, and the club's avatar in that slot
      reads as a club notification. Keep both guards here too.
- [ ] **4.3** Neither type takes an actions element. There is nothing to accept or decline.
- [ ] **4.4** No change to `routes.ts` — `routes.clubThread(threadId)` already exists and takes a
      **thread** id (`clubThreads` takes a club's; the segment names which).

---

## 5. What must NOT change

- [ ] **5.1** No new cache key, and **no notifications invalidation** in `postClubMessage` or the
      thread-wave action. Leave a comment at each site saying the absence is deliberate — it is
      otherwise indistinguishable from a forgotten invalidation. `design.md` §D15.
- [ ] **5.2** No change to `club_threads`, `club_messages` or `club_thread_waves` — not a column, not
      a policy, not a grant. The three triggers are the only additions to them.
- [ ] **5.3** No push. Adding a type does not enrol it for delivery.
- [ ] **5.4** Nothing in `openspec/changes/introduce-yourself-on-joining-a-club/`, and no
      `introduces_user_id` or `introduction`.
- [ ] **5.5** No feature flag. Nothing concrete is wrong right now that a flag would make safe, and
      a flag defaulting off would make the fan-out untestable.

---

## 6. Gates

- [ ] **6.1** `npx tsc --noEmit`
- [ ] **6.2** `npm run lint`
- [ ] **6.3** `npm run test:unit`
- [ ] **6.4** `npm run build`
- [ ] **6.5** `PGPASSWORD=postgres npm test` — the RLS suite. **Do not run it concurrently with
      another agent**: `run.sh` defaults `TEST_DB=letsride_test` and opens with
      `drop database if exists`, and each step is its own `psql`, so a drop landing between two steps
      takes the other run down mid-chain. Override `TEST_DB=` if a second build is live.
- [ ] **6.6** `npm run docs:check`
- [ ] **6.7** `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — this change adds
      path-and-`§` section pointers, and a third of the repo's live in `openspec/`. It runs inside
      `test:unit` rather than `docs:check`.

---

## 7. Apply and promote — **Q4 ANSWERED: order A, migration-first**

> **Decided 2026-09-01 by the main thread, on three measurements taken in this session rather than
> on the recommendation alone.** PD-367's body and `docs/HANDOFF.md` both said *deploy-first*, on
> `089`'s rule; that reading is **superseded**, and the reason is that `089`'s premise expired one
> day after `089` shipped:
>
> 1. **The exhaustive-switch hazard is gone.** PD-335 (#343, 2026-08-28) gave both switches a
>    runtime fallback, so an unknown type renders a generic unlinked row and self-heals — it no
>    longer takes the screen down:
>    `grep -c "did something on LetsRide" src/components/notifications/copy.ts` → 1, and
>    `grep -c "return { href: null }" src/components/notifications/NotificationsListItem.tsx` → 1.
> 2. **`098` adds a column the shipped bundle READS, which `089` did not.**
>    `NOTIFICATION_SELECT` (`src/lib/data/notifications.ts:59`) is an explicit column list, so a new
>    bundle against a pre-`098` database answers `PGRST200`/400 and `unwrapList` throws — every rider's
>    notifications list, not one degraded row. That is `096`'s rule read on the read side.
> 3. **On PROD the migration-first window costs nothing measurable**: `club_threads` and
>    `club_messages` are both **0 rows** there (measured 2026-09-01), so no notification of either
>    new type can exist during it.
>
> So the two sides are not symmetric and the additive-first rule resolves the same way `097` does.
> **Order B below is kept, struck, because "a new notification type deploys last" is the rule this
> repo carries and the next reader will reach for it.**

### Order A — migration BEFORE the bundle serves. **CHOSEN.**

The bundle reads a column that does not exist until `098` applies, so a serving new bundle against a
pre-`098` database answers **`PGRST200` / 400** on `NOTIFICATION_SELECT` and takes **every rider's
notifications list** down for the window. Migration-first costs only rows of the two new types
rendering `Rider · did something on LetsRide.` unlinked, in an older bundle, self-healing the moment
the new one lands — and on PROD it costs nothing at all, `club_threads` being empty there. This is
`096`'s rule read on the read side.

- [ ] **7.A1** Apply `098` to **DEV** *before* merging, or immediately on merge and before the
      Preview build reaches `READY`.
- [ ] **7.A2** Hand-exercise both write paths on DEV, as `authenticated`, in a **rolled-back**
      transaction, with rows **counted** rather than assumed: post a club message; wave a thread;
      un-wave it. `036`'s gate.
- [ ] **7.A3** Merge to `development`. Confirm the Preview reaches `READY` on the merge sha.
- [ ] **7.A4** Repeat 7.A1–7.A3 against **PROD** at promotion time, in the same order.

### ~~Order B — migration AFTER the bundle is confirmed serving.~~ NOT TAKEN — see the three measurements above.

- [x] ~~**7.B1** Merge and confirm the deployment `READY` on the merge sha with `aliasError` null.
      *"Merged" is not "deployed"* — `070`'s DEV apply landed 102 seconds after its merge commit, out
      from under a Preview still calling what it had just dropped.
- [x] ~~**7.B2** Then apply `098`, then hand-exercise as in 7.A2.
- [x] ~~**7.B3** **Accept and record** that between 7.B1 and 7.B2 the notifications list answers
      `PGRST200` for every rider, and say how long that window was.

### Either way

- [ ] **7.C1** After apply, on each project: read `get_advisors(security)` and confirm the **count
      and the name set are unchanged**. A new
      `authenticated_security_definer_function_executable` means a function landed in `public` or a
      revoke did not — a failed apply, not a new normal.
- [ ] **7.C2** Confirm seven FK columns and seven usable indexes, derived from `pg_index`.
- [ ] **7.C3** Confirm the participation-gate trigger count is unchanged.
- [ ] **7.C4** Confirm `notifications_event_key` is eight columns, `nulls not distinct`, and that
      `notifications_event_key_v2` no longer exists.
- [ ] **7.C5** `npm run db:drift`.
- [ ] **7.C6** Read `npm run logs:errors` after the apply. **There is no backfill and the window is
      24 hours** — the Discussions→Threads rename left 64 404s there for ~50 minutes and nothing said
      so. A `PGRST201` / HTTP 300 from an ambiguous embed is a **status nothing alerts on** and this
      is the only place it appears.

---

## 8. Documentation

- [ ] **8.1** `docs/reference/schema.md` — update the `notifications` row: the seventh subject
      column — the **fifth** subject column, **fifth** partial index and **seventh** FK column — the
      eight-column key, sixteen types, and the two new
      conjuncts. Also note on the `club_threads` row that its deletion now reaches `notifications`.
- [ ] **8.2** `CLAUDE.md` — **main thread only, agents do not write it.** Two claims move: the
      security-advisor table's reasoning about which functions add advisors (unchanged in count, and
      this change is a worked example of `private` adding none), and any count that names the
      notification types. **One claim is already stale and is not this change's**: §Technology
      Decisions says the participation gate is on *"twenty-two tables on DEV and seventeen on PROD"*
      — PROD measures **22** today, the `092`–`095` promotion having landed. Report it; do not fold
      an unrelated correction into this change silently.
- [ ] **8.3** `docs/HANDOFF.md` — **main thread only.**
- [ ] **8.4** **File the in-body comment correction in `private.remove_reported_thread` as its own
      issue.** Its body states that `notifications` *"has no `thread_id` column and is not in the
      chain"*, which `098` makes false. Correcting it needs `create or replace`, which changes
      `prosrc` — the value every cross-project comparison in this repo is keyed on — so it does not
      belong in a notifications migration. `098`'s external `comment on function` carries the
      correction in the meantime (task 1.13).
- [ ] **8.5** PR body: the change id, the Q4 decision and who made it, the negative cases, the
      recipient set and its bound, the `openspec validate` result, and the two open questions the
      owner still owes an answer on (**Q2**, the wave retraction, and **Q8**, the leave eviction).

---

## 9. Review

- [ ] **9.1** `reviewer` on this **proposal**, before any code — it is the only artifact in the
      pipeline with no automated gate behind it, `openspec/` being in CI's denylist.
- [ ] **9.2** `reviewer` on the **final diff**, once, immediately before the PR.
- [ ] **9.3** Point 9.2 at three things specifically: that the CHECK rewrite covers **all sixteen**
      arms; that the re-created policies still carry `089`'s and `093`'s disjuncts **verbatim**; and
      that no fan-out function names `notifications_event_key` or its columns.
