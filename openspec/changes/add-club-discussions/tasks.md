## 0. Pre-flight — resolve before writing SQL

- [x] 0.1 **Resolved — nothing is open.** All five questions this change opened with are answered in `design.md` under `Questions Closed` (D1 cascade, D2 hide the thread whole, D3 sort by creation, D4 no club-card badge, D5 title at 80). Do not reopen them; D1 in particular decides a foreign key and is settled before task 1.1.
- [x] 0.2 **Done.** The threads decision is on the board: `PD-307`'s body states and dates it, and `PD-299` carries a comment recording it. An earlier draft of this change claimed it was unrecorded, having read the epic and not the story split off from it.
- [x] 0.3 Re-derive the migration number: `mcp__Supabase__list_migrations` on PROD (`zwprydcyryvudhurbnye`) and DEV (`fpmrimzxadewsaiwpsel`) against `ls supabase/migrations/`. Promote everything the gap already contains, in filename order, per `docs/ENVIRONMENTS.md` §Migrations, **before** adding to it.
- [x] 0.4 Record the **before** numbers, so the after-numbers mean something: gate triggers (`select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal` — expect 11), `get_advisors(security)` (expect 13, going to **15**), and the RLS suite's **label set** via `PGPASSWORD=postgres npm test 2>&1 | grep "NOTICE:  ok"` (a count cannot tell a rename from a loss).
- [x] 0.6 Read the **live** comment on `public.enforce_participation_gate()` before writing the restamp — it says **eleven** and names the ninth, tenth and eleventh triggers. Do not grep for "nine".
- [x] 0.5 Confirm `clubs` SELECT still carries no `private.is_blocked` call and `private.is_club_member_for` still carries the owner arm — the two facts the whole audience argument rests on.

## 1. Migration `081_club_discussions.sql` — the tables

- [x] 1.1 Create `public.club_discussions` — `id uuid default uuid_generate_v4() primary key`, `club_id uuid references public.clubs(id) on delete cascade not null`, `author_id uuid references public.profiles(id) on delete cascade not null` (per 0.1), `title text not null`, `created_at timestamptz default now() not null`.
- [x] 1.2 Add the title CHECK: `title ~ '\S' and length(title) <= 80`. **Not `btrim`** — design.md §Text bounds carries the measured reason.
- [x] 1.3 Create `public.club_messages` — `id` (client-suppliable, defaulted), `discussion_id uuid references public.club_discussions(id) on delete cascade not null`, `author_id` (cascade to `profiles`), `body text not null`, `created_at timestamptz default now() not null`, CHECK `body ~ '\S' and length(body) <= 1000`.
- [x] 1.4 Create `public.club_discussion_reads` — `user_id uuid references public.profiles(id) on delete cascade not null`, `discussion_id uuid references public.club_discussions(id) on delete cascade not null`, `last_read_at timestamptz default now() not null`, `primary key (user_id, discussion_id)`. **Both foreign keys are required** — without the `profiles` one, "when this named person last read this named topic" survives their account deletion for ever, `029` working purely by cascade. **`user_id` leads the PK**: `029` asserts every FK into `profiles` has a leading-column index.
- [x] 1.5 Indexes: `club_discussions (club_id, created_at desc, id desc)`, `club_discussions (author_id)` (cascade), `club_messages (discussion_id, created_at, id)`, `club_messages (author_id, created_at desc)` (cascade), `club_discussion_reads (discussion_id)` (cascade from a thread delete).
- [x] 1.6 `alter table ... enable row level security` on all three.
- [x] 1.7 Write the table comments. They are the `data` agent's first read via `list_tables` and no edit to `CLAUDE.md` reaches them — say for each that the audience is club membership, that the parent `EXISTS` is the redundant half **here** (the inverse of `ride_messages`), and why the redundant conjunct stays.

## 2. Migration `081` — policies

- [x] 2.1 `club_discussions` SELECT: `exists (clubs) and private.is_club_member(club_id) and (author_id = auth.uid() or not private.is_blocked(auth.uid(), author_id))`.
- [x] 2.2 `club_discussions` INSERT `with check`: `author_id = auth.uid() and exists (clubs) and private.is_club_member(club_id)`. **No block arm** — design.md and the spec both state why a blocked pair may both post.
- [x] 2.3 `club_discussions` DELETE `using`: `exists (clubs) and private.is_club_member(club_id) and author_id = auth.uid()`. Author only — the owner's arm is the RPC in task 4.2.
- [x] 2.4 **No UPDATE policy on `club_discussions`.** Absence is the enforcement.
- [x] 2.5 `club_messages` SELECT: the two-hop `EXISTS` against `club_discussions` written out in design.md §The grandchild, plus the block arm on `club_messages.author_id`.
- [x] 2.6 `club_messages` INSERT `with check`: `author_id = auth.uid()` plus the same two-hop conjunction.
- [x] 2.7 **No DELETE policy and no DELETE grant on `club_messages`.** Deletion is `delete_own_club_message` (task 4.2b) — a policy-based delete is unfixable here, because RLS applies the SELECT policy to a `DELETE` whose `WHERE` names a column (measured, Postgres 17.6), so a rider blocked by the thread's author silently cannot erase their own words. Comment the absence and the reason, following `078`'s `push_devices` precedent. Do **not** add a `private.discussion_club()` helper to relax the `USING` clause: it changes no observable outcome, because the SELECT policy hides the row before `USING` is reached.
- [x] 2.8 **No UPDATE policy on `club_messages`.**
- [x] 2.9 `club_discussion_reads`: SELECT `user_id = auth.uid()` alone; INSERT and UPDATE `with check` carrying `user_id = auth.uid()` plus the full audience conjunction; UPDATE `using` = `user_id = auth.uid()` **alone** (`061`'s deliberate asymmetry). Comment that `034`'s reason for the conjunction does **not** transfer — a `WITH CHECK` grants no reads — and that `015` §2's existence-oracle reason does.
- [x] 2.10 **No DELETE policy on `club_discussion_reads`**, and comment the honest reason: "mark unread again" is drawn nowhere. Do **not** repeat `015`'s cascade claim — the FK is to `club_discussions`, so leaving the club leaves the row standing.

## 3. Migration `081` — grants and triggers

- [x] 3.1 `revoke all on public.club_discussions, public.club_messages, public.club_discussion_reads from anon, authenticated`.
- [x] 3.2 `grant select, delete on public.club_discussions to authenticated`; **`grant select` only on `public.club_messages`** (no DELETE — task 2.7); `grant select, insert, update on public.club_discussion_reads to authenticated`.
- [x] 3.3 Per-column INSERT grants: `(id, club_id, author_id, title)` and `(id, discussion_id, author_id, body)`. **`created_at` on neither.** Comment that a `default` applies only when the column is omitted and PostgREST will name it.
- [x] 3.4 Add `enforce_participation_gate` BEFORE INSERT triggers to **both** content tables, each `for each row when (current_user = 'authenticated')`. The `WHEN` clause is not decoration (`023` §2).
- [x] 3.5 **No gate trigger on `club_discussion_reads`**, and say so in a comment with `023`'s reason for `feed_reads`.
- [x] 3.6 Restamp the comment on `public.enforce_participation_gate()` from **eleven** to **thirteen** — measured, it does not say nine — and extend its enumeration, which today names the ninth (`ride_messages`, `034`), tenth (`ride_map_render_attempts`, `051`) and eleventh (`place_search_attempts`, `069`), with the twelfth and thirteenth. `028` and `033` exist for exactly this.
- [x] 3.7 `public.stamp_club_discussion_read()` — `security invoker`, `set search_path = ''`, sets `new.last_read_at := now()`, `revoke all` from every role, hung as `before insert or update`. **Both arms**: INSERT-only works on fresh rows and drifts in use.

## 4. Migration `081` — functions and publication

- [x] 4.1 `public.club_discussion_unread(club uuid) returns table (discussion_id uuid, has_unread boolean)` — `security invoker`, `stable`, `set search_path = ''`, `author_id <> auth.uid()`, and the comparison point `coalesce(greatest(last_read_at, joined_at), d.created_at)` from design.md. **`greatest`, not a three-arm `coalesce`**: the watermark row survives leaving the club, so a plain `coalesce` prefers a stale pre-departure watermark over a fresh `joined_at` and badges a rejoiner with the whole back catalogue. Comment each property with the precedent it carries (`061` §4, `079`).
- [x] 4.2 `public.moderate_club_discussion(discussion uuid)` — `security definer`, `set search_path = ''`, `#variable_conflict error`, one `select ... for update` joining to `clubs` on `owner_id = auth.uid()`, **one** raise site so "no such thread" and "not your club" are indistinguishable (`043`'s shape). Deletes one row; the FK cascades the messages.
- [x] 4.2b `public.delete_own_club_message(message uuid)` — `security definer`, `set search_path = ''`, `#variable_conflict error`, re-checking `author_id = auth.uid()` in its own body, deleting exactly one row, **no club-membership conjunct** (your own words stay retractable after you leave — a stated divergence from `ride_messages`). One raise site, so "not yours" and "no such message" are indistinguishable.
- [x] 4.3 Grants on all three functions: `revoke all from public, anon`, `grant execute to authenticated`.
- [x] 4.4 `alter publication supabase_realtime add table public.club_messages`. **Do not add `club_discussions`**, and say in the file why not, so a later session finds the decision in the file rather than in a channel that reports SUBSCRIBED and never fires.
- [x] 4.5 Default replica identity on `club_messages` — no `full`. Comment the reason (no UPDATE, subscriber reads INSERT).
- [x] 4.6 Write the verification footer: the policy/role counts, `anon` grant count 0, the **enumerated** INSERT columns, `has_table_privilege('authenticated','public.club_messages','delete')` = **false**, publication membership **and** non-membership, `prosecdef` false on the reader / true on both definer RPCs, `indnullsnotdistinct` count 0 on the reads table, both foreign keys on `club_discussion_reads` present with `confdeltype = 'c'`, gate trigger count **13**, advisors **15**.

## 5. RLS assertions — `supabase/tests/rls_test.sql`

Every task here is required: `openspec/config.yaml` and `CLAUDE.md` both say a policy change with no new assertion is not finished. Each maps to a scenario in `specs/club-discussions/spec.md`.

- [x] 5.1 A club member of any `role` reads and writes both content tables.
- [x] 5.2 The club owner holding **no** `club_members` row reads and writes both.
- [x] 5.3 **A signed-in non-member of a PUBLIC club reads zero threads and zero messages, and every insert is refused.** This is the case a policy carrying only the `clubs` `EXISTS` fails — the single most important assertion in this change.
- [x] 5.4 A signed-in non-member of a **private** club reaches nothing, including with a stale `club_discussion_reads` row present.
- [x] 5.5 Each conjunct asserted **alone**: one case fails if the `clubs` `EXISTS` is removed, a different case fails if `private.is_club_member` is removed. A single case both hide is not coverage.
- [x] 5.6 `clubs` SELECT still carries **no** `private.is_blocked` call — a catalog assertion, so the day one is added this change's reasoning is re-read.
- [x] 5.7 A rider who left the club loses every thread and message including their own; the rows survive for everyone else.
- [x] 5.8 A rider who joined after a thread was created sees the whole thread.
- [x] 5.9 A member cannot insert with a foreign `author_id`; a non-member of a public club cannot insert at all.
- [x] 5.10 No UPDATE grant **and** no UPDATE policy on either content table — asserted separately, per grantee (`has_table_privilege`, not a grant-row count: `postgres` and `service_role` hold everything).
- [x] 5.11 Author deletes their own thread; a third member cannot; the messages go with it.
- [x] 5.12 `moderate_club_discussion`: the owner deletes a member's thread; **the owner deletes a thread whose author they have blocked** (the case a policy arm fails silently); a non-owner gets `insufficient_privilege` identical to a nonexistent id.
- [x] 5.13 Message erasure via `delete_own_club_message`: the author succeeds; **a rider blocked by the thread's author still succeeds** (the case a DELETE policy fails silently at zero rows); a rider who has left the club still succeeds; a club member, the club owner and a non-member all get `insufficient_privilege` for a message they did not author, indistinguishable from a nonexistent id.
- [x] 5.13b `authenticated` holds **no** DELETE privilege on `club_messages` **and** no DELETE policy exists on it — asserted separately, the grant half scoped via `has_table_privilege`.
- [x] 5.13c **Mutation-test 5.13's blocked case**: temporarily restore a policy-based delete, confirm the assertion goes red, then revert. An assertion for a silent-zero-rows defect that has never been seen to fail is not coverage.
- [x] 5.13d A thread's author can delete their own thread while blocking, and while blocked by, another member — the inversion does not reach `club_discussions`.
- [x] 5.14 Blocking, both directions from one row: B's thread absent from A's list, B's messages absent from a shared thread, C sees all three riders' content.
- [x] 5.15 A blocked pair both insert successfully into the same thread and each sees only their own.
- [x] 5.16 Deleting a club removes its threads, messages and watermarks; `delete_owned_club` on the default club is still refused.
- [x] 5.16b `private.transfer_owned_clubs`' **no-successor branch**: the last remaining member deleting their account deletes the club and cascades every thread, message and watermark. Assert it, and assert that the branch does **not** check `clubs.is_default` — a recorded pre-existing gap in `029`/`059`, not fixed here.
- [x] 5.17 Neither new FK into `clubs`/`club_discussions` is `ON DELETE SET NULL` — the property `043`'s existence rests on.
- [x] 5.18 Account deletion: a thread author's deletion removes the thread and other riders' messages in it; a replier's deletion removes only their own messages; **and every `club_discussion_reads` row naming the deleted rider is gone** — the `profiles` FK half, which 5.16 does not reach.
- [x] 5.19 Watermark: readable only by its owner (the club owner and thread author included); refused for a thread the writer cannot read; the trigger overrides a future `last_read_at` on **both** INSERT and UPDATE; no DELETE grant.
- [x] 5.20 Gate: a rider with `terms_accepted_at` NULL is refused by both new triggers; `club_discussion_reads` carries **no** gate trigger (assert the absence); the total reads **13**.
- [x] 5.21 `club_discussion_unread`: excludes the caller's own messages; returns false for a blocked author's message; `prosecdef` is false; falls through to `club_discussions.created_at` for an owner holding no membership row; and **a rider who read a thread, left, and rejoined is not badged with messages sent while away** — the `greatest` case, which a plain `coalesce` fails.
- [x] 5.22 Publication: `club_messages` is in `supabase_realtime` and `club_discussions` is **not** — both from the catalog.
- [x] 5.23 `anon` holds zero grants on all three tables, and no policy is written for a role other than `authenticated`.

## 6. Apply and verify

- [x] 6.1 Apply `081` to DEV via `apply_migration`. It is well under `036`'s 61 KB, so no reduction technique is needed.
- [x] 6.2 Run the footer's verification queries against DEV. Every number must match; a mismatch is investigated before any code lands.
- [x] 6.3 `get_advisors(security)` on DEV — expect **15**: two new `authenticated_security_definer_function_executable` WARNs, for `moderate_club_discussion` and `delete_own_club_message`. Two, not one — the advisor fires once per function. A sixteenth means a revoke did not land or `club_discussion_unread` was written `definer`.
- [x] 6.4 `PGPASSWORD=postgres npm test` green, and reconcile the **label set** against 0.4's, not the count.
- [ ] 6.5 `npm run db:drift` — repo, DEV and PROD agree on the chain. **NOT RUN: the script needs `PROD_DATABASE_URL`/`DEV_DATABASE_URL`, which no session holds — it printed `Set PROD_DATABASE_URL and/or DEV_DATABASE_URL. Nothing to compare.` Substituted `list_migrations` against `ls supabase/migrations/`: repo 81 files, DEV 81 applied (through `081`), PROD 79 (through `079`), so PROD is owed `080` then `081`, in filename order, at the next promotion. Both are additive, so both go BEFORE the promotion build serves.**

## 7. Types, validation, reads and writes

- [x] 7.1 Add `ClubDiscussion`, `ClubDiscussionListItem` and `ClubMessage` to `src/types/index.ts`. Domain types are never inlined.
- [x] 7.2 `clubDiscussionTitleSchema` and `clubMessageBodySchema` in `src/lib/validation/clubs.ts`, each mirroring its CHECK exactly — `.trim()` plus the same ceiling on the raw length. Zod owns the message, the database owns the guarantee.
- [x] 7.3 `src/lib/data/club-discussions.ts` through `resolveSupabase`: `getClubDiscussions(clubId)`, `getClubDiscussion(id)`, `getClubDiscussionMessages(discussionId)`, `getClubDiscussionUnread(clubId)` (the RPC). Return `null` for a decided absence; never a bare `.from()` in a component.
- [x] 7.4 `src/lib/actions/club-discussions.ts`: `createClubDiscussion`, `deleteClubDiscussion`, `moderateClubDiscussion` (RPC), `sendClubMessage`, `deleteClubMessage` (**RPC — `delete_own_club_message`, never `.from('club_messages').delete()`, which holds no grant**), `markClubDiscussionSeen`. Plain async functions, `useActionState`-compatible, each invalidating exactly what it moves.
- [x] 7.4b `deleteClubDiscussion` must not chain `.select()` onto its delete. `RETURNING` re-attaches the SELECT policy (measured), which is the mechanism that makes a delete match zero rows and still report success.
- [x] 7.5 `sendClubMessage` supplies a client-generated `id` and reads `23505` as success — the retry path `034` designed the suppliable id for.
- [x] 7.6 `markClubDiscussionSeen` upserts and **sends** `last_read_at`; the trigger makes the value true. Comment that withholding the column grant would **not** work here — PostgREST builds the `do update set` list from the request body, so an omitted column needs no privilege and nothing raises (`061` §3's measured correction).

## 8. Cache keys

- [x] 8.1 Add `clubs.discussions(clubId)`, `clubs.discussionsUnread(clubId)` (nested under the first) and `clubs.discussionMessages(discussionId)` to `src/lib/query/keys.ts`. No key written inline in a component, ever.
- [x] 8.2 Document in the `keys.ts` header table **which prefixes reach `clubs.discussionMessages` and which do not**, stated positively: `['clubs']` (i.e. `clubs.all()`) **does** reach it — `invalidate` matches structurally on prefix via `keyStartsWith` in `src/lib/query/queryClient.ts` — while `['clubs','detail',clubId]` does not, because the thread screen holds only the discussion id. Do **not** write "no prefix reaches it": that is false, and `keys.ts`'s header is treated as authoritative.
- [x] 8.3 Wire the invalidations: `createClubDiscussion` → `clubs.discussions(clubId)`; `deleteClubDiscussion`/`moderateClubDiscussion` → the list **and** `clubs.discussionMessages(id)`, carrying the club id in the action rather than re-reading it after the row is gone; `sendClubMessage`/`deleteClubMessage` → `clubs.discussionMessages(id)`; `markClubDiscussionSeen` → `clubs.discussionsUnread(clubId)` alone.

## 9. Generalise the chat components

- [x] 9.1 **Three of the four moved; `RideChatRow` deliberately did not.** `ChatThread`, `ChatComposer` and `MarkChatSeen` are in `src/components/chat/` and parameterised (an optional `onDeleteMessage`, `maxLength`/`placeholder`, and an `onMark` callback held in a ref). **`RideChatRow` is not a chat row** — it is the labelled `Ride chat` link on the ride plan (PD-254/PD-125), reading `queryKeys.rides.unread` and linking to `routes.rideChat`. Club Discussions has no single-row counterpart (its section is a header plus N `ClubDiscussionRow`s plus `See all`), so moving it would have produced a `ChatRow` with one caller, a ride-shaped key inside `components/chat/`, and no shared behaviour — the "smaller shared core with two thin wrappers" the brief allows. It stays at `src/components/rides/RideChatRow.tsx`, untouched.
- [x] 9.2 Rename `formatRideMessageDay` → `formatChatMessageDay` in `src/lib/utils.ts` and its unit tests. Keep `formatRideTime(created_at, null)` as the message clock — a discussion has no timezone, so `null` is honest, and `CLAUDE.md` forbids adding a generic formatter.
- [x] 9.3 `npm run docs:check` and `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — a rename can break a declared claim or a section pointer of the form `some-file.md` followed by a section mark.

## 10. Realtime

- [x] 10.1 `src/lib/realtime/useClubDiscussionStream.ts`, modelled on `useRideMessageStream`: one channel named `club-discussion:${discussionId}:messages`, INSERT only, removed on unmount, refetch on reconnect and on foreground.
- [x] 10.2 The **thread list does not subscribe**. State that in the list component's docstring, so a screen that quietly does not subscribe is distinguishable from one whose channel is broken.
- [ ] 10.3 **NOT DONE — owed to `test`, and nothing here should be read as covering it.** Verifying per-subscriber authorization needs two live sessions, a block between them and a browser against DEV, which this agent was scoped out of (the `test` agent owns running the app against DEV, on a still tree). What is in place for it: `club_messages` is in the publication and `club_discussions` is not (both asserted in `rls_test.sql`), the channel is `club-discussion:${discussionId}:messages`, INSERT only, filtered server-side on `discussion_id`. **The silence a blocked subscriber must receive is unmeasured.**

## 11. Screens

- [x] 11.1 `ClubDiscussionsSection` on `/clubs/detail`, shaped like the Members section — header, up to N rows, `See all`. For a **non-member of a public club** it renders a join prompt and discloses no title, count, author or time.
- [x] 11.2 `/clubs/detail/discussions?id=<club id>` — the list, keyset-paged over `(created_at desc, id desc)`, with the per-thread unread dot from `clubs.discussionsUnread`.
- [x] 11.3 `/clubs/detail/discussion?id=<discussion id>` — the thread, reusing `ChatThread`/`ChatComposer`, subscribing, and mounting `MarkChatSeen`.
- [x] 11.4 `/clubs/detail/discussions/new?id=<club id>` — the create form, title only, hand-rolled controlled input plus `useActionState`.
- [x] 11.5 Add the routes to `src/lib/routes.ts` using `DETAIL_ID_PARAM`, and add them to the walk's route list so a screen that throws on load is caught.
- [x] 11.6 Every screen: gate on **data**, never `isLoading`; `null` is decided and `undefined` is "not yet"; skeleton at the content's own padding; an error state with retry that is not an empty conversation; a partial state where a failed unread call leaves the list rendering unmarked.
- [x] 11.7 Read the composition from `design/` only — there is no v2 Discussions frame, so `Ride - Chat` (`2226:4999`) and `Inbox - Chats` (`2375:9518`) are the measured sources. Use `--all` on any `tree`. Icons from `@/components/icons/generated`; primary buttons near-black `Grey/100 #1A1A1A`, never green.

## 12. Verify and document

- [x] 12.1 `npx tsc --noEmit` clean; `npm run lint` 0 errors / 9 pre-existing `no-img-element` warnings; `npm run test:unit` **2346 passing across 74 files**, up from 2319 and no file lost; `npm run build` green, with `/clubs/detail/discussion`, `/clubs/detail/discussions` and `/clubs/detail/discussions/new` prerendered static. `npm run docs:check` 33/42 — the 9 failures are all count claims in `CLAUDE.md`/`docs/HANDOFF.md` (tasks 12.5–12.7, main thread): migrations 80→81, RLS 1841→2010, unit tests 2319→2346, static routes 34→37 and the static-pages total 35→38. `crossrefs.test.mjs` 26/26.
- [ ] 12.2 `npm run walk` against DEV, through `scripts/supabase-relay.mjs` — the only gate that renders anything. Confirm the new routes render and the ride chat still does after task 9.
- [x] 12.3 Confirm no component calls `supabase.from()`: `grep -rn "supabase\.from(" src/app/ src/components/ | grep -vE ':[0-9]+:\s*(\*|//|/\*)'` prints only the existing comment lines.
- [x] 12.4 Confirm the dependency count is unchanged: `node -p "Object.keys(require('./package.json').dependencies).length"`.
- [ ] 12.5 Add the three table rows to `docs/reference/schema.md`, each carrying the audience predicate, the cascade behaviour and the deletion answer.
- [ ] 12.6 Update the `Clubs` row of `docs/reference/product-scope.md`: Discussions ships, and the remaining gaps are the activity feed and invitations.
- [ ] 12.7 Update `CLAUDE.md`'s advisor table to **fifteen**, naming both `moderate_club_discussion` and `delete_own_club_message`, and its participation-gate paragraph to thirteen tables. **Main thread writes these, not a subagent.**
- [ ] 12.8 Run `reviewer` on the final diff, once, immediately before the PR.
