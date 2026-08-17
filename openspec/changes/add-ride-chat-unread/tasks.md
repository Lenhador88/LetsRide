## 0. Before any SQL — what was measured, what was not, and the five questions

- [x] 0.1 **Measured offline, from the committed `design/` snapshot.** None of these touched the
  network, so none can be rate limited. `--all` on every command, because the notification slot is a
  variant slot on `v2 / Component / Button / Icon` and the tree hides it wherever the design turned
  it off — reading an unfiltered tree here gets the answer wrong in *both* directions.

  | Fact | Value | Command |
  |---|---|---|
  | Dot on the ride plan's chat button | `v2 / Component / Notification` 16×16, `Warning/100` on `Grey/5`, **visible** | `npm run figma -- tree "Ride - Ride plan - Sub pages" --all` |
  | Dot on the crew page's chat button | same component, **visible** | `npm run figma -- tree "Ride - Crew (Riders)" --all` |
  | Same component on back / Options | `[hidden]` on every ride frame | either command above |
  | `Ride - Chat`'s own header | **no chat button at all**; its Options dot is `[hidden]` | `npm run figma -- tree "Ride - Chat" --all` |
  | Navigation bar `Rides` tile | **no `Notification` instance at all** | either tree, `--all` |
  | Rides list | one `Notification`, two `Counter`, **all `[hidden]`** | `npm run figma -- tree "Home - Rides - All" --all` |

  The last two rows are the scope fence's evidence: the design draws no rollup and no card badge.

- [x] 0.2 **Measured from the repo, not from a database.** The agent that wrote this proposal had
  **no Supabase tool on its allowlist** and no `ToolSearch`, so `list_tables`, `list_migrations` and
  `execute_sql` were unavailable and the deferred-schema recovery path was unreachable. Scoping, not
  a rotation. Everything below is read from `supabase/migrations/*.sql` and `src/`:

  | Fact | Value | Source |
  |---|---|---|
  | `ride_members` columns | `ride_id`, `user_id`, `status`, `joined_at`, PK `(ride_id, user_id)` | `001` |
  | `rides.created_at` | `timestamptz default now() not null` | `001` |
  | `rides` SELECT policy | organizer arm, then `not is_blocked` ∧ (public ∧ club-public, or club member) | `022` |
  | `ride_messages` index | `(ride_id, created_at, id)` — the shape the unread `exists` probes | `034` |
  | `private.is_ride_crew` | `security definer`, organizer arm **or** any `ride_members` row | `034` |
  | `feed_reads` FK | `club_id → clubs(id) on delete cascade` — **not** membership | `015` |
  | `023`'s reason for excluding `feed_reads` | *"a read watermark. Produces nothing anyone sees."* | `023` header |

- [x] 0.3 **CONFIRMED against DEV by the coordinator, 2026-08-17.** 16 FKs into `public.profiles`,
  **10** `enforce_participation_gate` triggers, and **no `ride_reads` relation**. All three match what
  these artifacts assume. `design.md` §D0 still reads "nothing was measured against a database" and
  is correct as a statement about the authoring session; do not rewrite it — this row is the record.

- [x] 0.4 **BLOCKING task 1 — re-derive the migration number.** `CLAUDE.md` says 60 files with DEV at
  `060` and PROD at `059`, and says in the same paragraph not to read the number from it. This change
  is written as `061` throughout on that basis and **that is an assumption, not a measurement**:

  ```bash
  ls supabase/migrations/ | tail -3
  ```
  ```
  mcp__Supabase__list_migrations fpmrimzxadewsaiwpsel   # DEV
  mcp__Supabase__list_migrations zwprydcyryvudhurbnye   # PROD
  ```

  If another change has landed a file since, take the next number and update every reference in this
  file. **Filename order equals apply order** — `run.sh` applies by filename — so a number chosen to
  sit between two applied files is a trap this repo has already sprung.

- [x] 0.5 **BLOCKING task 3 — record the advisor count BEFORE applying.** This change must move it by
  zero, and the only way to know is to have the before number. `CLAUDE.md` tabulates nine with
  `auth_leaked_password_protection` the only outstanding one.

  ```
  mcp__Supabase__get_advisors fpmrimzxadewsaiwpsel type=security
  ```

- [ ] 0.6 **Q1 — product owner, non-blocking, default taken.** Do the rider's own messages count as
  unread? **Default: no, excluded**, and the spec is written that way — the alternative makes the dot
  depend on a race between the watermark write and a navigation. Note in the answer that `015` does
  **not** exclude the reader's own postcards, so this is a deliberate divergence rather than an
  inconsistency.

- [ ] 0.7 **Q2 — product owner only, non-blocking. Default: the icon only, per the design.** Should
  the `Chat` row in `RidePageMenu`'s sheet carry a dot too? Worth their attention rather than a build
  decision: PD-101 recorded that the product owner — organizer and `going` on every ride in the
  database — **could not find the chat icon at all** and opened the sheet looking for it. A dot on an
  icon nobody finds is a signal in a place nobody looks. Build the default; this is a one-line change
  later either way.

- [ ] 0.8 **Q3 — product owner, non-blocking. Default: per-ride only.** Is a Rides-tab rollup wanted
  next? The scope fence answers it for *this* change; the answer decides whether the reader stays
  singular. Going plural later is a new function, not a signature change — `design.md` §D2.

- [ ] 0.9 **Q4 — product owner, non-blocking, and it is a live defect on a shipped path. Default:
  leave it, file it.** `feed_reads.last_seen_at` is written by `markClubSeen` and `markFeedSeen` as
  `new Date().toISOString()` and compared inside `club_unread_counts()` against `postcards.created_at`
  and `rides.created_at` — a comparison spanning a phone's clock and the database's. Same class as
  §The clock. **Not fixed here**: different table, shipped path, and mixing it into this migration
  would put an unrelated correction behind this change's review.

- [ ] 0.10 **Q5 — product owner only, non-blocking. Default: indefinite, dying with the ride and the
  rider.** Retention for `ride_reads`. It is behavioural personal data — when a named rider last
  looked at a named conversation — and it is more disclosive than anything `015` stores even though
  only its owner can read it. `ride-chat` already carries the same open question for messages
  themselves; answer them together or not at all.

## 1. `061_ride_reads.sql` — the table, the policies, the trigger, the reader

Purely additive. Nothing is dropped, no existing policy is altered, no grant is revoked, no existing
row is touched — which is what makes §3's apply-then-deploy ordering safe.

- [x] 1.1 **The table.** `user_id uuid references public.profiles(id) on delete cascade not null`,
  `ride_id uuid references public.rides(id) on delete cascade not null`,
  `last_read_at timestamptz default now() not null`, and **`primary key (user_id, ride_id)`**.

  **Write the comment that says why there is no `unique nulls not distinct` here**, because its
  absence beside `015`'s presence reads as an omission: `015` needs it because
  `feed_reads.club_id IS NULL` *means* the app-wide feed, so a plain UNIQUE would insert a second
  app-wide row on every visit. There is no "app-wide ride", so no NULL can occur and the clause has
  nothing to do. The primary key is also what the upsert's `on conflict` names.

- [x] 1.2 **`alter table … enable row level security`**, and a table comment stating the audience in
  one sentence — a database comment is the `data` agent's first read via `list_tables` and is the one
  piece of documentation no edit to `CLAUDE.md` can reach (`028` and `033` exist for exactly this).

- [x] 1.3 **SELECT policy** — `to authenticated`, `using (user_id = auth.uid())` and nothing wider.
  Comment it as the **read-receipt refusal**, not as an ownership formality: this is the policy that
  makes "has the organizer seen my message" unanswerable, and a future widening would look like a
  harmless convenience.

- [x] 1.4 **INSERT policy** — `to authenticated`, `with check (user_id = auth.uid() and exists (select
  1 from public.rides r where r.id = ride_id) and private.is_ride_crew(ride_id))`.

  **The comment must state `015` §2's reason and must NOT state `034`'s**, and this is the single most
  important line of prose in the migration. `034`'s leak argument is about *reading* and does not
  reach a `WITH CHECK`, which grants no reads; the reason a predicate is needed at all is that the FK
  turns an INSERT into an existence oracle (`23503` for a nonexistent ride, success for an
  existing-but-invisible one). The reason it is the **full intersection** rather than the crew helper
  alone is `design.md` §D1's three: audience equality, never letting `private.is_ride_crew` appear as
  a sole conjunct anywhere, and a measured cost of zero. A comment asserting a guarantee the mechanism
  does not give is how the next session deletes the conjunct.

- [x] 1.5 **UPDATE policy** — `using (user_id = auth.uid())`, `with check` identical to 1.4. Comment
  the asymmetry: `USING` scopes which rows may be reached and `WITH CHECK` what they may become, and
  putting the audience conjuncts in `USING` too would stop a rider who left a private club from
  reaching their own stale row, which changes nothing they can do and makes the policy harder to read.

- [x] 1.6 **No DELETE policy and no DELETE grant**, with the **honest** reason.
  **Do not copy `015` §2's sentence** — it says *"Leaving a club cascades the row away via the FK"*
  and that is wrong: the FK is to `clubs(id)`, so it fires when the club is deleted, not when
  membership ends. The real reason is that deleting a watermark means "mark this unread again", which
  no screen draws; the row is inert until its ride or its rider is deleted.

- [x] 1.7 **The `last_read_at` trigger** — `before insert or update`, setting `new.last_read_at :=
  now()`. Function takes no argument, `set search_path = ''`, EXECUTE revoked from `public`, `anon`,
  `authenticated`, so it adds no advisor finding.

  **Both arms, and the comment must say why**: a `BEFORE INSERT` trigger alone imposes the value on a
  rider's first visit to a ride and keeps the client's value on every visit after — which works in
  testing, where rows are fresh, and drifts in use. **A trigger rather than a withheld column grant**
  because the upsert's UPDATE arm must name `last_read_at` to advance it, so revoking the grant fails
  the whole statement `42501` on the second visit to any ride. `034` §4b could use the grant only
  because `created_at` has no update path at all.

  The comment must also state the *reason for server ownership*, which is not tamper-resistance: the
  value is compared against `ride_messages.created_at`, so the two operands must share a clock.

- [x] 1.8 **NO participation-gate trigger**, and say so in the file. `023`'s own header excludes
  `feed_reads` as *"a read watermark. Produces nothing anyone sees."* — the same reason applies. A
  rider who has not consented cannot be crew anyway, so 1.4's `WITH CHECK` already refuses them.
  Absence here is a decision, and an undeclared absence is what gets "fixed" by the next session.

- [x] 1.9 **`public.ride_has_unread(ride uuid) returns boolean`** — `language sql`, `stable`,
  **`security invoker`**, `set search_path = ''`. `exists` over `public.ride_messages` where
  `ride_id = ride`, `author_id <> auth.uid()`, and `created_at > coalesce(<watermark>, <joined_at>,
  <rides.created_at>)`.

  Three comments the function must carry:
  - **INVOKER is why it can live in `public`** — it runs as the caller, so `034`'s crew, visibility
    and block conjuncts apply inside it and it can return nothing the caller could not compute by
    reading `ride_messages` directly. A ride they cannot see answers `false`, identically to a ride
    that does not exist and identically to a quiet chat.
  - **The third coalesce arm is load-bearing** — `034` §1: the organizer may hold **no**
    `ride_members` row, so a two-arm coalesce returns NULL, every comparison is NULL, and the host is
    the one member of the crew whose dot never lights. Keep the arm after
    `enforce-creator-membership` lands, for the reason `ride-chat` gives for the organizer arm of
    `is_ride_crew`.
  - **Boolean, not a count** — `exists` short-circuits, so unlike `015` §4 there is no `limit` cap to
    write and nothing to cap.

- [x] 1.10 **Grants.** `revoke all on public.ride_reads from anon, authenticated;` then
  `grant select, insert, update on public.ride_reads to authenticated;` — note what is not granted:
  DELETE (1.6) and anything at all to `anon` (decision #1).
  `revoke all on function public.ride_has_unread(uuid) from public, anon;` then
  `grant execute … to authenticated;`

- [x] 1.11 **A §Verification footer**, in `015`'s shape, each line predicting a number. **Every grant
  assertion scoped to its grantee** — the unscoped form of the DELETE check returns 2 against a
  correct database because `postgres` and `service_role` hold everything by Supabase default, which is
  the mistake `015`'s own footer made on its first pass:

  ```sql
  -- 3 — select, insert, update; no delete
  select count(*) from pg_policies where tablename = 'ride_reads';
  -- 0 — every policy is `to authenticated`
  select count(*) from pg_policies
   where tablename = 'ride_reads' and roles::text[] <> array['authenticated'];
  -- 0 — anon holds nothing
  select count(*) from information_schema.role_table_grants
   where table_name = 'ride_reads' and grantee = 'anon';
  -- f — authenticated cannot delete a watermark
  select has_table_privilege('authenticated', 'public.ride_reads', 'delete');
  -- f — the reader is INVOKER, not DEFINER
  select prosecdef from pg_proc where proname = 'ride_has_unread';
  -- f — anon cannot execute the reader
  select has_function_privilege('anon', 'public.ride_has_unread(uuid)', 'execute');
  -- t — authenticated can
  select has_function_privilege('authenticated', 'public.ride_has_unread(uuid)', 'execute');
  -- 10 — UNCHANGED. ride_reads does NOT join the participation gate (1.8)
  select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal;
  -- 0 — the timestamp trigger's function is unreachable by any client role
  select count(*) from (values ('public'),('anon'),('authenticated')) r(role)
   where has_function_privilege(r.role, 'public.<trigger fn>()', 'execute');
  ```

## 2. Assertions in `supabase/tests/rls_test.sql` — before the migration is applied anywhere

`openspec/config.yaml`: *"Any task adding or changing a migration must be paired with a task adding
assertions."* A policy change with no new assertion is not finished. **Compare label sets rather than
counts** when reconciling against the previous run — a count cannot tell a rename from a loss, which
is what `038` did to one of `036`'s assertions.

- [x] 2.1 **The write predicate, one assertion per conjunct**, so that removing either fails a
  *different* case. `database-enforced-integrity`'s NARROWER-child requirement asks for exactly this
  and says why: a single case both conjuncts happen to hide cannot say which one did the work.
  - crew member, visible ride → INSERT succeeds
  - crew member, visible ride, second visit → UPDATE arm of the upsert succeeds
  - **not crew**, ride visible → refused *by the crew conjunct*
  - crew, **blocked the organizer** → refused *by the visibility conjunct*, asserted with the block
    written in each direction, because the row is directional and the effect symmetric
  - crew, **left the ride's private club** → refused *by the visibility conjunct*, asserted separately
    from the block case
  - **left the crew** → refused; **and the row they already held still exists**
  - **organizer holding no `ride_members` row** → INSERT succeeds

- [x] 2.2 **The existence oracle is closed.** A rider not on the crew writing a watermark for (a) a
  private club's ride they cannot see and (b) a UUID no ride carries must be refused **identically** —
  row security before the FK, so `42501` in both cases and never `23503` in one of them.

- [x] 2.3 **`user_id` cannot be forged**, on INSERT and on the UPDATE arm's `USING` — a rider must not
  be able to move a row out of their own ownership.

- [x] 2.4 **Nobody reads another rider's watermark.** Assert it for a crew member **and name the
  organizer specifically**, because the organizer is the role a "who has seen this" affordance would
  be built for.

- [x] 2.5 **`ride_has_unread` under RLS**, as each role in `specs/ride-chat-unread/spec.md`'s per-role
  table:
  - own message only in the thread → `false`
  - another rider's newer message → `true`
  - message from a **blocked** author → `false`, with no block filter anywhere in the function
  - **no watermark row**, message after `joined_at` → `true`; message before it → `false`
  - **organizer with no `ride_members` row and no watermark** → `true` on any other rider's message
    (the third coalesce arm; assert this one directly, it is reachable today)
  - non-crew caller, and a caller naming a ride that does not exist → `false`, not an error, and
    indistinguishable
  - **club admin / club owner who is not crew** → `false`, and no watermark write — `club_members.role`
    has had `admin` since `001` and neither role appears in `private.is_ride_crew`

- [x] 2.6 **The grants, scoped to the grantee.** `has_table_privilege('authenticated',
  'public.ride_reads', 'delete')` is false; `has_function_privilege('anon', …)` is false;
  `has_function_privilege('authenticated', …)` is true. **Never a table-wide grant count** — 1.11.
  The role-naming shape is `031`'s lesson: the suite runs as the table owner, for whom no barrier
  exists, so an assertion that *calls* the function proves nothing about who may call it.

- [x] 2.7 **The trigger imposes the timestamp on both arms.** Insert naming a far-future
  `last_read_at`, then update naming one, and assert the stored value is server time in both cases —
  not that it "is not the value sent", which passes for a NULL.

- [x] 2.8 **Cascades.** Deleting the ride removes the watermark; deleting the rider removes it;
  deleting the **organizer** removes rides and therefore every crew member's watermarks for them
  (two cascade levels, invisible in any single foreign key).

- [x] 2.9 **`anon` reaches nothing** — zero grants on the table, no EXECUTE on the reader.

- [x] 2.10 Run the suite, and reconcile by label set:
  ```bash
  PGPASSWORD=postgres npm test
  PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"    # against the previous run
  ```
  **If another session is running the suite concurrently, set `TEST_DB=`** — `run.sh` opens with
  `drop database if exists` and every step is its own `psql`, so a drop landing between two steps
  takes the other run down mid-chain.

## 3. Apply to DEV, and verify against the hosted project

Additive, so the order is **apply, then deploy** — `docs/ENVIRONMENTS.md` §Migrations. There is no
destructive step in this change and therefore no additive/destructive split to sequence.

- [x] 3.1 **Apply `061` to DEV** (`fpmrimzxadewsaiwpsel`) with `apply_migration`. The file is small
  enough to pass as a string, so none of the reduction technique for large migrations applies.
- [x] 3.2 **Run every line of the §Verification footer against DEV.** The suite runs on plain
  Postgres and cannot see role grants, exposed RPC endpoints or Supabase defaults — the gap `031`
  exists because of.
- [x] 3.3 **Advisors: expect the same number as 0.5, unchanged.** A new WARN means either the reader
  was written `security definer` or the trigger function's `revoke` did not land.
- [ ] 3.4 **NOT RUN — no database URLs in this container**, and `npm run db:drift` takes two.
      Replaced by something stronger for this one file rather than skipped: the applied objects on
      DEV were diffed against a scratch database with `061` applied verbatim by `run.sh` —
      `md5(string_agg(...))` over `pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`,
      `information_schema.columns`, `pg_indexes` and the grants — and they are identical
      (`71c0b43b2e3f5d15b048558b4420d4c4`) once Supabase's default `service_role` grants are
      excluded. That proves this migration; it does not prove the whole chain, which is what
      `db:drift` would have done. Original task: **Drift check.** `npm run db:drift` compares *names*, never versions or ordering. DEV ahead
  of PROD is the ordinary state between merge and promotion, not drift.
- [x] 3.5 **PROD is a separate, later step** and rides the promotion to `main`. Do not apply to PROD
  from a feature branch.

## 4. The data layer and the action — `src/lib/data/`, `src/lib/actions/`

- [x] 4.1 **`getRideChatUnread(rideId)`** in `src/lib/data/ride-messages.ts` — one `supabase.rpc`
  call, returning `boolean`. Guard the id with `rideIdSchema` first, the same reason `getRideMessages`
  does: a non-UUID segment reaches PostgREST as `22P02` and lands the rider on an error boundary
  offering "Try again" on an address that can never succeed.

  **No crew check, no block filter, no visibility predicate.** `034`'s SELECT policy and 1.9's
  `security invoker` own all three; restating any of it is the drift trap `getRideMessages` and
  `getRideCrew` both call out.

- [x] 4.2 **`markRideChatSeen(rideId)`** in `src/lib/actions/ride-messages.ts` — resolve the client,
  `getUser()`, return silently if absent, then upsert
  `{ user_id, ride_id }` with `{ onConflict: 'user_id,ride_id' }`. **Returns `void` and is silent on
  failure**, matching `markClubSeen`. The comment must state the accepted failure direction: a failed
  mark leaves the dot on, which over-reports unread rather than hiding a message.

  **Do not send `last_read_at`.** The trigger imposes it (1.7), and sending a client timestamp would
  be the exact defect this change exists not to inherit — write that in the comment, because sending
  it is what `markClubSeen` does two files away and copying it is one keystroke.

- [x] 4.3 **`invalidate(queryKeys.rides.unread(rideId))` and nothing else** at the foot of
  `markRideChatSeen`. Not the thread, not `rides.detail`, not `rides.all()`. Comment it as `015`'s
  narrowness rule with the reason a live thread adds: refetching the thread on every arriving message
  turns one delivered message into two round trips plus a re-render, on the screen the rider is
  actively reading.

- [x] 4.4 **Index choice measured on DEV, with the bound stated rather than glossed.** `explain
      (costs off)` over the reader's inner query returns `Index Scan using ride_messages_ride_id_idx`
      with **both** `ride_id` and `created_at` in the `Index Cond` and `author_id` as the only
      `Filter` — so `034`'s `(ride_id, created_at, id)` is the right shape and no index is owed.
      **It needed `set local enable_seqscan = off` to show that, and that is the honest caveat**:
      DEV holds one message in one thread, so the planner correctly prefers a sequential scan of a
      single-page table whatever the index says. What is measured is that the index is *usable and
      correctly shaped*, not that it *would be chosen* on a real thread — though at that size the
      alternative loses by construction, and `exists` stops at the first row either way.

- [x] 4.5 **`sendRideMessage` does NOT change.** If a diff touches it, the key nesting in §5 is wrong.

## 5. The cache key — `src/lib/query/keys.ts`

- [x] 5.1 **One key, nested under the thread's:**
  `unread: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'messages', 'unread']`.

- [x] 5.2 **Update the `rides.messages` docstring**, which currently predicts this change by name:
  *"The unread badge (Linear PD-120) will be the first thing that widens it, and it should widen it
  here rather than at the call site."* It did, and it widened **structurally** — `invalidate` matches
  on prefix, so `rides.messages(id)` now reaches `unread` with no second key spelled anywhere. Replace
  the prediction with the outcome; do not leave both.

- [x] 5.3 **Document the asymmetry beside the new key**, because the file already records a nesting
  argument that was wrong and a reader will reach for it:

  | | Direction | Wanted |
  |---|---|---|
  | `invalidate(rides.messages(id))` reaches `unread` | content → badge | **Yes** |
  | `invalidate(rides.unread(id))` does not reach `messages` | badge → content | **Yes** |

  The notifications block's mistake was widening in the *second* direction; the longer prefix here
  forecloses exactly that. Note too that the widening is **free where it lands**: `invalidate`
  refetches only entries with listeners, and the unread query is not mounted on the chat screen
  because that screen draws no chat button.

- [x] 5.4 `npx vitest run src/lib/query/__tests__/keys.test.ts` — that file asserts every
  `invalidate()` argument comes from `keys.ts` rather than being spelled inline.

## 6. The components — last, and both of them small

- [x] 6.1 **`src/components/rides/MarkRideChatSeen.tsx`** — `'use client'`, renders `null`, calls
  `markRideChatSeen`. Props: `rideId` and the **newest rendered message's id**. Effect keyed on
  `[rideId, newestMessageId]`.

  The docstring must carry the two rules that are easy to get wrong:
  - **Keyed on the newest *rendered* message, never on the subscription callback.** The callback fires
    when a row reaches the database; keying on it marks read a message the rider has not been shown.
    The mark may lag the rider's eyes and must never lead them.
  - **Without the second trigger the dot lights on a message the rider watched arrive** — PD-119
    shipped live delivery, so that is the common path, not an edge case.

- [x] 6.2 **Mount it in `src/app/(app)/rides/detail/chat/page.tsx`, conditionally on `isCrew`.**
  `MarkClubSeen`'s shape: the conditional mount *is* the rule, rather than a condition inside an
  effect that runs regardless. The newest id comes from the same `shown` list the thread renders, so
  optimistic rows are included — which is correct, since your own message never lights your own dot.

- [x] 6.3 **SHIPPED AS `src/components/rides/RideChatButton.tsx`**, which owns the whole button —
      link, accessible name and dot — rather than the dot alone. Splitting them would have left the
      `aria-label` in `RideHeader` and the value that determines it in the child; `NotificationDot`
      is `aria-hidden`, so that label is the only thing a screen reader gets. Task 6.4 changed with
      it: `RideHeader` mounts the button rather than wrapping one. Originally planned as
      `RideChatUnreadDot.tsx` — — `'use client'`, one
  `useQuery(queryKeys.rides.unread(rideId), () => getRideChatUnread(rideId))`, drawing
  `NotificationDot` when the answer is a fresh `true`. `NotificationsHeaderControl`'s shape exactly,
  including its rule that `undefined` reads the same as `false`: **no dot while the answer has not
  arrived, and no dot on failure, ever a stale one.**

- [x] 6.4 **Mount it inside `RideHeader`'s existing `action` slot**, under the condition that slot
  already carries (`!onChat && isCrew`), wrapping the `Link` in `relative` and positioning the dot as
  `NotificationsHeaderControl` does. **No prop is threaded through the three sub-page screens** —
  `RideHeader`'s own docstring records `isCrew` shipping optional for one commit with neither caller
  passing it, the chat button rendering nowhere, and `tsc` green throughout. A dot cannot even use
  that fix, because a screen that forgets to read it still renders a header that looks right.

- [x] 6.5 **Update `RideHeader`'s docstring.** It currently says the dot is *"Not drawn — there is no
  unread model yet (Linear PD-120 extends `015`'s watermark) and a badge that is always absent is
  indistinguishable from one that is broken."* That reasoning is now spent; replace it, and keep the
  **Options** omission exactly as it stands.

- [x] 6.6 **Nothing under `src/components/ui/` or `src/components/icons/` is touched.**
  `NotificationDot` is reused unchanged. Verify with the diff, not by intention.

- [x] 6.7 **No dot on `RidePageMenu`'s `Chat` row** — Q2's default. If Q2 comes back the other way it
  is a one-line change; do not pre-build it.

## 7. Gates — all of them, in this order

- [x] 7.1 `npx tsc --noEmit`
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm run test:unit`
- [x] 7.4 `npm run build` — needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. It
  also runs the prerender pass, which is what catches a read issued during render:
  `resolve.browser.ts` throws a named error and fails the build rather than shipping a silently empty
  screen. Both new components read in an effect, so this should pass — the build is the assertion.
- [x] 7.5 `PGPASSWORD=postgres npm test` — the RLS suite, green, with §2's labels present.
- [x] 7.6 `npm run docs:check` — the full sweep locally, not the `--cheap` subset CI runs. Any numeric
  claim this change moved (the participation-gate count is *unchanged*, and that is itself a claim)
  must still match.
- [ ] 7.7 **NOT RUN, deliberately, on this task's own reasoning.** The walk is optional here and says little.** It asks one question per route — did this
  render — and the dot's absence renders identically to its presence for a rider with nothing unread.
  If it is run, `WALK_FIXTURES=1` and a second rider posting into a shared ride is the only way it
  sees anything; that is a `test` agent task, not a gate for this change.

## 8. Documentation this change found wrong

Fix these in the same PR, and say so in the PR body — each is a claim someone will otherwise trust.

- [x] 8.1 **`015` §2's cascade sentence.** *"Leaving a club cascades the row away via the FK"* — the
  FK is to `clubs(id)`, so it fires on club deletion, not on leaving. **Migrations are append-only**,
  so do not edit `015`. Record the correction in `061`'s own comment (1.6) where it is load-bearing,
  and in `docs/reference/schema.md`'s `feed_reads` row if that file repeats it.
- [x] 8.2 **`feed_reads.last_seen_at` is written from the device clock** (Q4). Not fixed here; it
  belongs in `docs/HANDOFF.md` §Known issues with the one-line reason, so it is findable.
- [x] 8.3 **`club_unread_counts()` does not exclude the reader's own postcards**, and a postcard is
  authored from `/postcards/new` rather than from inside a club, so it can badge a club for the
  reader's own post. Candidate defect, recorded in `specs/ride-chat-unread/spec.md`; file it, do not
  fix it here.
- [x] 8.4 **`CLAUDE.md`'s participation-gate list stays at ten.** This change adds a table
  `authenticated` can INSERT into and deliberately does **not** gate it (1.8), which is the first
  addition of that shape since the list was written. If the sentence reads as "every new insertable
  table joins the gate", add `ride_reads` to the *uncovered* side with `023`'s reason.

## 9. Coordination before archiving

- [x] 9.1 **`ride-chat` / `The surfaces this change does not build`** is MODIFIED by this change and
  **by no other active change** — checked across `openspec/changes/*/specs/` on 2026-08-17. Re-check
  immediately before archiving rather than trusting that line; OpenSpec will not warn you, and
  archiving replaces a requirement **wholesale**, so whichever change goes second silently discards
  the first one's edit.
- [x] 9.2 **This change modifies nothing in `client-cache-invalidation` or
  `database-enforced-integrity`** — both deltas are purely ADDED, deliberately, because
  `add-account-deletion`, `add-ride-club-edit-delete`, `add-ride-map-tiles` and
  `tag-postcards-to-rides` are already contesting requirements in both files. An ADDED section
  appends and cannot collide. Do not "tidy" a delta into a MODIFIED one.
- [x] 9.3 **`enforce-creator-membership`** makes 1.9's third coalesce arm redundant and never wrong.
  Confirm that direction still holds when it lands, and **do not remove the arm** — the same ruling
  `ride-chat` makes for the organizer arm of `is_ride_crew`.
- [x] 9.4 **`grant-club-owner-member-reach` and `align-fanout-recipients-with-readability`** both
  touch what a rider may see of a ride. This change needs **no** coordination with either, and the
  reason is structural rather than lucky: 1.4's `EXISTS` names no arm of the `rides` SELECT policy, so
  it composes with whatever that policy becomes. Confirm that is still true if either lands first.
- [x] 9.5 **`tag-postcards-to-rides` / `A rider-supplied reference SHALL have its referent's
  visibility checked by policy`** — this change is a textbook instance and does not depend on it. If
  that change archives first, note the instance; if this one does, nothing needs saying.

## 10. Linear

- [x] 10.1 Move **PD-120** to `Development (AI)` on pickup, not at the end — it is the concurrency
  lock and the only signal saying which story is being worked right now. Pass the project **id**,
  never the name.
- [x] 10.2 The issue body points at this proposal and does **not** restate it. Its five-rating block
  stays; a Linear issue that grows a specification is a bug.
- [x] 10.3 **Q2, Q3 and Q5 are the product owner's alone.** All three have defaults, so none blocks
  the build — put them in the PR body as questions rather than moving the issue to `Needs help`,
  which stops every dispatch.
- [x] 10.4 File Q4 (the `feed_reads` clock) and 8.3 (the own-postcard counter) as their own issues
  with short titles, so neither is inherited as covered by this one.
- [x] 10.5 Never type a status name from memory — `list_issue_statuses team=Pedro & Dave`. A
  `save_issue` naming a status that no longer exists comes back looking successful with the field
  silently dropped; read the field back off the response.

## 11. Review and merge

- [x] 11.1 **Run `reviewer` on this proposal, before any code** — the first of its two passes and the
  cheaper one. `openspec/` is in the CI denylist, so a proposal-only PR runs `crossrefs.test.mjs` and
  nothing else, and this is the only real gate a proposal gets. **Point it at `design.md` §D1**: the
  claim that `034`'s argument does *not* apply here, while the full intersection is still required, is
  the reasoning most worth a second pair of eyes — the wrong version of it passes every positive test
  and only fails as a leak nobody looks for.
- [x] 11.2 **Run `reviewer` again on the final diff**, once, immediately before the PR. It touches
  `src/` and `supabase/`, so the RLS and data-exposure passes both fire.
- [x] 11.3 Branch off `development`; open the PR against `development`, never `main`.
- [ ] 11.4 **Drive it to merged.** Committed and pushed is not shipped, and a wrap-up PR left open is
  that failure with extra steps — every other signal already looks finished.
- [ ] 11.5 Notify when it lands: `Done ; ) ride chat unread watermark`.
