# Tasks — retire ride chat for ride threads

**Read `design.md` before touching any of this.** Four of its findings change what gets built:

1. **D3 — there is no `ride_message` notification kind.** The issue asks you to retire one and to
   decide the `101` precedent question. Measured: `notifications_type_check` has sixteen arms and
   that is not one, `036`/`060` mention `ride_messages` only in **comments**, and the only trigger on
   the table is `enforce_participation_gate`. Do not open `notifications`. Roughly a third of the
   migration the issue describes does not exist.
2. **D1 — the swap's trap comes back at two tables.** Copying `082`'s `club_messages` policy and
   substituting `private.is_ride_crew` for `private.is_club_member`, without the `EXISTS` against
   `rides`, is `034`'s first draft and it shipped a leak. The helper is half of a conjunction.
3. **D5 — build the deletion as an RPC, not a policy.** It closes the residual silent `DELETE 0`
   that `docs/HANDOFF.md` records for `ride_messages` and that `102` could not fix.
4. **D8 — do not "align" `mergeRideTimeline` with `mergeClubTimeline`.** The ride's completeness
   derivation is the stronger and correct one; the club's is reachable-wrong through exactly the
   kind of source you are adding.

**Q1 in `proposal.md` is the product owner's and is blocking.** It has a stated default and the spec
is written to it, so **build against the default** rather than waiting. A *no* answer costs one extra
conjunct on two SELECT policies and two assertions.

**THE ORDERING IS THE STORY. Sections 3, 5 and 7 are three separate events with a deploy between
them, and collapsing any two is the failure this change exists to avoid.** Migration A applies
*before* the code deploys; migration B applies only after the new bundle is confirmed **serving** —
`READY` on the merge sha with `aliasError` null — which is **not** the same as merged. This repo
applied a destructive file 102 seconds after a merge, out from under a Preview still calling the
function it dropped.

---

## 0. Before anything — fix the numbers, do not trust them

- [ ] 0.1 **Do not hardcode a migration number from this document.** Read the chain at build start:
      `ls supabase/migrations/*.sql | tail -3` on `origin/development`, and `list_migrations`
      against **both** refs. Migration A takes the next free number, migration B the one after.
- [ ] 0.2 **`107` is taken on DEV by a file the repo does not have.** Measured 2026-09-06: DEV's last
      applied migration is `a_club_may_outlive_its_last_member` at `20260905203011`, which is
      slot-1's declared `107_a_club_may_outlive_its_last_member.sql` — and that file **does not exist
      on `development`**. Re-measure before choosing: if the file has since landed, the chain is at
      `107` and A/B are `108`/`109`; if it has not, decide with the owner rather than claiming `107`
      and colliding with an applied name.
- [ ] 0.3 Re-measure the state gap. Expected at time of writing: repo 106 files, PROD at `100`, DEV
      at `107`. `PROD is behind by 101–107 plus whatever this adds`, and this change's two files
      promote to PROD **in filename order, behind that whole gap**.
- [ ] 0.4 Re-measure the surface this change deletes rather than trusting the list:
      `grep -rln "ride-messages\|RideChatRow\|RideChatButton\|useRideMessageStream\|rideChat\|ride_messages\|ride_reads" src/ supabase/ scripts/`
      returned **51** files on 2026-09-06 — most of them migrations that only *mention* the table.
      Split the list into "reads or writes it" and "mentions it in a comment" before deleting
      anything; the second group is the comment trap and must not be edited.

## 1. Pre-flight measurements that can change the plan

- [ ] 1.1 **The junction check (D12) — expected to be a no-op, run it anyway.** `ride_threads` has
      PK `id` and is therefore not a junction; the only junction migration A adds is
      `ride_thread_reads`, over a pair no shipped bundle can already embed. Confirm rather than
      trust: run `columns.ts`'s own junction query against DEV and check `ride_threads` is absent
      from the result, then `npx vitest run src/lib/data/__tests__/embed-hints.test.ts`. **Do not
      apply the loose rule** — `columns.ts` names *"any third table holding a key to both"* as false
      and gives `postcards` as the counter-example. There is no deadlock here and no preparatory
      hint-only deploy is needed; if the query unexpectedly returns `ride_threads`, that means the
      PK was written wrong, which is the actual thing to stop on.
- [ ] 1.2 Re-count the rows migration B destroys, on **both** projects, and put the numbers in the PR
      body. Expected: DEV 7 `ride_messages` / 14 `ride_reads`, PROD 0 / 0.
- [ ] 1.3 Re-derive the advisor baseline with `get_advisors(security)` on both refs so the +2 claim
      in `proposal.md` §Impact is checked rather than asserted.
- [ ] 1.4 Confirm `supabase_realtime` membership before you start:
      `select tablename from pg_publication_tables where pubname='supabase_realtime'` — expected
      `club_messages`, `ride_messages`.

## 2. Migration A — additive. `<N>_ride_threads.sql`

Model it on `081` + `082` read together, with `034`'s audience conjunction. Every policy gets a
comment saying why the `EXISTS` against `rides` is there.

- [ ] 2.1 `public.ride_threads` — `id uuid` (client-suppliable, default `uuid_generate_v4()`),
      `ride_id uuid not null references rides(id) on delete cascade`,
      `author_id uuid not null references profiles(id) on delete cascade`, `title text not null`,
      `created_at timestamptz not null default now()`. No `updated_at`.
      CHECK `title ~ '\S' and length(title) <= 80` — the `~ '\S'` floor, **not** `btrim`.
- [ ] 2.2 `public.ride_thread_messages` — `id`, `thread_id uuid not null references ride_threads(id)
      on delete cascade`, `author_id`, `body text not null`, `created_at`. CHECK
      `body ~ '\S' and length(body) <= 1000`.
- [ ] 2.3 `public.ride_thread_reads` — `(user_id, thread_id)` primary key, `last_read_at`.
      `081`'s `club_thread_reads` shape.
- [ ] 2.4 Indexes: `ride_threads (ride_id, created_at desc)`, `ride_threads (author_id)`,
      `ride_thread_messages (thread_id, created_at desc, id desc)` — the tiebreak must match the
      read query and the cursor — `ride_thread_messages (author_id)`,
      `ride_thread_reads (thread_id)`. The `author_id` indexes serve the `profiles` cascade, per
      `notifications`' "every cascade path SHALL be indexed" requirement.
- [ ] 2.5 **SELECT policy on `ride_threads`** —
      `exists (select 1 from public.rides r where r.id = ride_threads.ride_id)` evaluated as the
      caller, `and private.is_ride_crew(ride_threads.ride_id)`,
      `and (author_id = (select auth.uid()) or not private.is_blocked((select auth.uid()), author_id))`.
      **Own-row arm inside the block group, never hoisted above the first two** — `design.md` D6.
- [ ] 2.6 **SELECT policy on `ride_thread_messages`** — restate the **full** audience through a join
      to `ride_threads` for the `ride_id`: the `rides` EXISTS, `private.is_ride_crew`, and its **own**
      block arm on `ride_thread_messages.author_id`. Do **not** collapse it to a one-hop `EXISTS`
      against `ride_threads` — `082`'s grandchild ruling, and the spec asserts a direct-by-id read.
- [ ] 2.7 INSERT policies on both, WITH CHECK `author_id = (select auth.uid())` **and** the same
      audience conjunction, so a rider cannot post into a thread they cannot read.
- [ ] 2.8 **No DELETE policy and no DELETE grant on either table. No UPDATE policy and no UPDATE
      grant on either table.** State in the header that the absence is the enforcement.
- [ ] 2.9 `ride_thread_reads` policies — own rows only, `user_id = (select auth.uid())`, top level,
      **no** ride-visibility conjunct. SELECT + INSERT + UPDATE; no DELETE.
- [ ] 2.10 Table grants: `grant select on ride_threads, ride_thread_messages to authenticated`;
      `grant select, insert, update on ride_thread_reads to authenticated`; `revoke all` from `anon`
      on all three.
- [ ] 2.11 **Per-column INSERT grants** — `grant insert (id, ride_id, author_id, title) on
      ride_threads` and `grant insert (id, thread_id, author_id, body) on ride_thread_messages`.
      `created_at` is **withheld**: the default is the value, the grant is the guarantee (`034` §4b).
- [ ] 2.12 `enforce_participation_gate` trigger on `ride_threads` and `ride_thread_messages`. Not on
      `ride_thread_reads` — the gate does not sit on read-watermark tables (`feed_reads`,
      `club_thread_reads`). **This is a trigger on a NEW write path, not an already-shipped one**, so
      CLAUDE.md's hand-exercise gate does not apply; say so in the header rather than leaving the
      reader to work it out.
- [ ] 2.13 `public.stamp_ride_thread_read()` trigger function + trigger — `061` §3 / `081`'s clock
      rule. The trigger is the mechanism; withholding the column grant would break the upsert's
      UPDATE arm.
- [ ] 2.14 `public.ride_thread_unread(ride uuid)` — **`security invoker`, not definer.** Measured:
      `public.club_thread_unread` is `prosecdef = false`. This adds **no** security advisor; making
      it a definer would add one for nothing.
- [ ] 2.15 `public.delete_own_ride_thread_message(uuid)` — `security definer`,
      `set search_path = ''`, scoped `author_id = auth.uid()` inside the body. **+1 advisor.**
- [ ] 2.16 `public.moderate_ride_thread(uuid)` — `security definer`, authority arm
      `rides.organizer_id = auth.uid()` reached through the thread's `ride_id`. **Not**
      `private.is_ride_crew` — `design.md` D4. **+1 advisor.**
- [ ] 2.17 `revoke all ... from public, anon` and `grant execute ... to authenticated` on 2.14–2.16;
      `revoke all ... from public, anon, authenticated` on the trigger function in 2.13.
- [ ] 2.18 `alter publication supabase_realtime add table public.ride_thread_messages;`
- [ ] 2.19 Table and column comments on all three tables, in `082`'s style — the audience, the
      grandchild restatement, why there is no DELETE policy, and why `created_at` is withheld.
- [ ] 2.20 A `§Verification` block of SQL to run against the project after applying, and a
      `§Rollback` block. `094` and `098` are the shape.
- [ ] 2.21 **Assertions in `supabase/tests/rls_test.sql`** — one per negative scenario in
      `specs/ride-threads/spec.md`. Non-negotiable: `openspec/config.yaml` and CLAUDE.md §Testing
      both require it, and a policy change with no new assertion is not finished. Minimum set:
      organizer with no crew row; `going`; `maybe`; visible-ride non-crew (read **and** write, and
      the conjunct asserted in isolation); **pending invitee**; **accepted invitee to a private
      club's ride**; **club owner and club admin with no `ride_members` row on their own club's
      ride**; ex-club-member with a surviving `ride_members` row; blocked pair **in both
      directions** (which pins the block's symmetry — **not** the own-row disjunct, which is a
      provable no-op inside the block conjunct and which no assertion can detect); **ex-crew member
      reads nothing including their own rows, which is the assertion that pins the own-row arm's
      ceiling and is the one that can actually fail**; direct-by-id message read refused; `anon`
      (scoped to the grantee, or `has_table_privilege`);
      no UPDATE grant; no DELETE grant; `has_function_privilege` for each new RPC and for `anon`.
- [ ] 2.22 `PGPASSWORD=postgres npm test`. Record the new assertion total and **compare label sets,
      not counts**, against the previous run — a count cannot tell a rename from a loss.

## 3. Apply migration A to DEV — BEFORE the client merges

- [ ] 3.1 Apply it. Then run its own `§Verification` block.
- [ ] 3.2 Confirm the publication: `ride_messages` **and** `ride_thread_messages` are both members.
      Both being present is the expected state for the length of the gap, not drift.
- [ ] 3.3 `get_advisors(security)` on DEV. Expect **+2** (41). An unexpected advisor is one not in
      `docs/reference/migrations.md` §Security advisors.
- [ ] 3.4 Confirm the old chat still works on DEV — `ride_messages` reads, writes and its Realtime
      stream. Migration A must be invisible to the shipped bundle; if it is not, stop.

## 4. The client — one branch off `development`

### 4a. Add the new surface

- [ ] 4.1 `src/lib/data/ride-threads.ts` — `getRideThreads(rideId)`, `getRideThread(threadId)`,
      `getRideThreadMessages(threadId, cursor)`, `getRideThreadUnread(rideId)`. Every `profiles`
      embed **hinted**: `author:profiles!author_id(...)`. Keyset cursor on `(created_at, id)`, never
      `offset`.
- [ ] 4.2 `src/lib/actions/ride-threads.ts` — `createRideThread`, `sendRideThreadMessage`,
      `deleteOwnRideThreadMessage`, `moderateRideThread`, `markRideThreadSeen`. Each names its cache
      claim; `src/lib/actions/__tests__/writers-invalidate.test.ts` reads every action module.
- [ ] 4.3 `src/lib/query/keys.ts` — `rides.threads(rideId)`, `rides.threadsUnread(rideId)`,
      `rides.threadReplies(rideId)`, `rides.threadMessages(threadId)`. Mirror the club's nesting
      **and its documented asymmetry**: `threadMessages` hangs off the thread id and is therefore
      **not** reached by invalidating the ride's thread list, so a write that moves one thread's
      messages names that key itself.
- [ ] 4.4 `src/lib/validation/rides.ts` — `rideThreadTitleSchema`, `rideThreadMessageBodySchema`.
      Same bounds and same raw-length-first shape as `clubThreadTitleSchema` /
      `clubMessageBodySchema`. Zod owns the message, the database owns the guarantee.
- [ ] 4.5 Types in `src/types/index.ts` — `RideThread`, `RideThreadMessage`, `RideCreateOption`.
- [ ] 4.6 `src/lib/realtime/useRideThreadStream.ts` — `useClubThreadStream`'s shape, channel scoped to
      the **thread**, not the ride (`specs/realtime-subscriptions`). No DELETE events.
- [ ] 4.7 Routes: `/rides/detail/threads`, `/rides/detail/thread`, `/rides/detail/threads/new`, and
      the matching `detailPaths` / `routes` entries. Copy the club's three pages.
      **Import `ChatThread`, `ChatComposer`, `MarkChatSeen` and `lib/data/chat.ts` — do not fork
      them.**
- [ ] 4.8 Components: `RideThreadRow`, `RideTimelineThreadRow`, `CreateRideThreadForm`,
      `RideThreadOptions`. The club's equivalents are the model.
- [ ] 4.9 `src/lib/data/ride-timeline.ts` — add the `thread` and `reply` arms to
      `RideTimelineEvent`, a `getRideThreadReplies` collapsing to **one row per thread**, and their
      entries in `RideTimelineSources` / `mergeRideTimeline` / `groupRideTimeline`. **Leave
      `mergeRideTimeline`'s completeness derivation alone** (D8).
- [ ] 4.10 `src/lib/rides/bottom-slot.ts` — `RideDetailActions` gains
      `createOptions: RideCreateOption[]`; `bottomSlot: 'create'` and the timeline `(+)` both open
      the sheet. Grow the exhaustive test; pin that empty options cannot coexist with
      `bottomSlot: 'create'`. Carry D9's sentence about the day the predicates diverge.
- [ ] 4.11 A redirect for `/rides/detail/chat` in `next.config.ts`, onto the ride's thread list or
      the ride detail — a bookmarked URL must not dead-end. `next.config.ts` already redirects legacy
      shapes and has a test asserting both directions.

### 4b. Delete the old surface — only what actually reads or writes it

- [ ] 4.12 Delete `src/app/(app)/rides/detail/chat/`, `RideChatRow.tsx`, `RideChatButton.tsx`,
      `src/lib/realtime/useRideMessageStream.ts`, `src/lib/data/ride-messages.ts`,
      `src/lib/actions/ride-messages.ts`, `src/lib/data/__tests__/ride-messages.test.ts`,
      `rideMessageBodySchema`, `routes.rideChat` / `detailPaths.rideChat`, the `RideMessage` /
      `RideChatMessage` types, and the ride-chat entries in `Navbar.tsx` and `RideHeader.tsx`.
- [ ] 4.13 **Do NOT delete** `src/components/chat/ChatThread.tsx`, `ChatComposer.tsx`,
      `MarkChatSeen.tsx` or `src/lib/data/chat.ts`. All four are imported by
      `src/app/(app)/clubs/detail/thread/page.tsx` and by the new ride thread screen.
- [ ] 4.14 `scripts/walk.mjs` — remove `/rides/detail/chat` from the bare route list; add
      `/rides/detail/threads` and `/rides/detail/threads/new` (both take a RIDE id) and
      `/rides/detail/thread` discovered from the ride's own thread list, the way the club's thread id
      already is; retarget the relay comment at ~line 246 that names the ride chat's WebSocket.
      A shrunken `N/N` is a skip, not a pass.
- [ ] 4.15 `WALK_FIXTURES` — if it seeds a ride chat message, seed a ride thread instead.
- [ ] 4.16 `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`.
- [ ] 4.17 `npm run docs:check` — the full sweep locally, not just CI's `--cheap` subset.
- [ ] 4.18 Run the walk against DEV. Read `scripts/supabase-relay.mjs`'s header first; Chromium in
      this container cannot reach Supabase without it.

## 5. Merge, deploy, and CONFIRM SERVING — this is its own event

- [ ] 5.1 `reviewer` on the final diff, then open the PR against **`development`** (never `main`).
- [ ] 5.2 Merge (squash) once green.
- [ ] 5.3 **Confirm the bundle is SERVING on DEV.** Read the Vercel deployment for the **merge sha**
      in the `development` environment and require `READY` with `aliasError` null. Record the sha and
      the state in the PR or the Linear comment. **"It merged" and "CI is green" do not satisfy
      this.**
- [ ] 5.4 Reload a browser tab against DEV and exercise a ride thread end to end — create, post,
      receive over Realtime, mark read, delete own message, organizer-remove a thread. A subscription
      reporting `SUBSCRIBED` proves nothing; observe an insert **arriving**.

## 6. Migration B — destructive. `<N+1>_retire_ride_chat.sql`

Write the file in section 2's PR if that is convenient, but **do not apply it** until section 5 is
signed off.

- [ ] 6.1 `drop table public.ride_reads;` — takes its policies, grants, index and the
      `stamp_ride_read` trigger with it.
- [ ] 6.2 `drop function public.stamp_ride_read();` and `drop function
      public.ride_has_unread(uuid);`
- [ ] 6.3 `drop table public.ride_messages;` — takes its three policies, its grants, its indexes, its
      `enforce_participation_gate` trigger **and its `supabase_realtime` membership**. A preceding
      `alter publication ... drop table` is redundant; say so rather than adding it silently.
- [ ] 6.4 **Touch `notifications` not at all** — no CHECK edit, no row delete, no trigger. `design.md`
      D3: there is no `ride_message` arm, no fan-out and no rows. If you find yourself writing
      `alter table public.notifications`, re-read D3.
- [ ] 6.5 Header states the data disposition explicitly with the counted rows, names the owner's
      2026-09-05 decision, and records that **nothing is archived** and why (D10).
- [ ] 6.6 Header states the ordering rule it depends on and names section 5.3 as the gate it must not
      be applied before.
- [ ] 6.7 Delete every `ride_messages` / `ride_reads` assertion from `supabase/tests/rls_test.sql`.
      **Compare label sets before and after**, so a deletion beyond the intended set is visible.
- [ ] 6.8 `PGPASSWORD=postgres npm test`.

## 7. Apply migration B to DEV — only after 5.3

- [ ] 7.1 Apply it.
- [ ] 7.2 Verify: both tables gone, both functions gone, `supabase_realtime` contains
      `club_messages` and `ride_thread_messages` and **not** `ride_messages`.
- [ ] 7.3 `get_advisors(security)` — unchanged from 3.3. Migration B removes no advisor:
      `public.ride_has_unread` is `prosecdef = false` and `public.stamp_ride_read` holds no
      `authenticated` EXECUTE. Measured, not assumed.
- [ ] 7.4 Walk DEV again.

## 8. Documentation — the build owes these, and this firing must not write them

Both files are **slot-1's declared territory** as of 2026-09-05 20:35Z, which is why the proposal
firing did not touch them. Check the territory is clear before writing.

- [ ] 8.1 `docs/reference/schema.md` — remove the `ride_messages` and `ride_reads` contracts; add
      `ride_threads`, `ride_thread_messages`, `ride_thread_reads` with their audience predicates,
      cascade behaviour and per-column grants. Update §The participation gate: **+2 gated tables**
      from the new tables, **−1** from `ride_messages` going, and re-run its count query rather than
      arithmetic on this line.
- [ ] 8.2 `docs/reference/migrations.md` §Applied state — one entry per file, each recording its
      ordering: A migration-first, B after-serving-confirmed, and the sha 5.3 recorded.
      §Security advisors — the +2 accounting, per function.
- [ ] 8.3 `docs/reference/product-scope.md` — Rides no longer has a chat; it has threads.
- [ ] 8.4 `CLAUDE.md` — the applied-state line and the migration count. **Main thread only**; agents
      do not write `CLAUDE.md` or `docs/HANDOFF.md`.
- [ ] 8.5 `docs/HANDOFF.md` — record that the `ride_messages` residual silent `DELETE 0` (§Your own
      row survives the parent going out of view) is **closed by deletion of the table**, and that the
      replacement uses the RPC shape so it cannot recur. **Main thread only.**

## 9. PROD promotion — a later session's, and it is not free

- [ ] 9.1 The two files promote **in filename order, behind the whole existing `101`–`107` gap**, per
      `docs/ENVIRONMENTS.md` §Migrations.
- [ ] 9.2 **The same ordering rule applies on PROD and must not be collapsed**: migration A, then the
      promotion build confirmed serving on `main`, then migration B. **What the serving gate bounds
      is the deployment, never the client population** — an already-loaded tab keeps its pre-merge
      JS until it is reloaded, so a tab sitting on `/rides/detail/chat` when migration B applies
      gets `PGRST205` whatever the gate says. **No soak is specified here, and the reason is the
      row count rather than the rule**: PROD holds 0 ride messages and has no riders, so the
      population is empty. Do not copy this into a destructive change with live users — `103` is
      the worked example that did owe a transitional soak, and `CLAUDE.md` §Supabase Rules carries
      why.
- [ ] 9.3 Re-run `get_advisors(security)` on PROD and reconcile against DEV. A one-advisor difference
      between the projects is almost always a pending promotion.

## 10. Close the loop

- [ ] 10.1 `/opsx:apply`, then `/opsx:archive`. **Before archiving, read `design.md` D11**: two
      unarchived changes carry `MODIFIED` deltas against requirements this one removes, and if either
      archives second its edit is discarded silently. Archive them first, then confirm
      `openspec/specs/ride-chat/` is gone rather than left as an empty shell.
- [ ] 10.2 Linear PD-402 → `Deployed to DEV` once migration B has applied and the walk is green. The
      story closes when the thing it names exists, not when the part you built does.
- [ ] 10.3 PD-395 (*the ride chat says on the timeline that it is alive*) is **superseded** by this —
      the issue says so. Cancel it, do not build it.
- [ ] 10.4 PD-403 (*scout the ride domain after the timeline rewrites*) is `blocks`-related and
      unblocked by this landing. Leave it queued.
