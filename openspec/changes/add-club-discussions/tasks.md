## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 **BLOCKING, product owner:** answer design.md Q1 — does a thread author's account deletion cascade the thread and everyone's replies? Recommended default `ON DELETE CASCADE`. It decides a foreign key, so it cannot be deferred past task 1.1.
- [ ] 0.2 **Main thread, not this agent:** record the "threads, not one chat per club" decision as a comment on Linear PD-299, which is still `Needs decision` with zero comments. Nothing on the board says this was answered.
- [ ] 0.3 Re-derive the migration number: `mcp__Supabase__list_migrations` on PROD (`zwprydcyryvudhurbnye`) and DEV (`fpmrimzxadewsaiwpsel`) against `ls supabase/migrations/`. Promote everything the gap already contains, in filename order, per `docs/ENVIRONMENTS.md` §Migrations, **before** adding to it.
- [ ] 0.4 Record the **before** numbers, so the after-numbers mean something: gate triggers (`select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal` — expect 11), `get_advisors(security)` (expect 13), and the RLS suite's **label set** via `PGPASSWORD=postgres npm test 2>&1 | grep "NOTICE:  ok"` (a count cannot tell a rename from a loss).
- [ ] 0.5 Confirm `clubs` SELECT still carries no `private.is_blocked` call and `private.is_club_member_for` still carries the owner arm — the two facts the whole audience argument rests on.

## 1. Migration `081_club_discussions.sql` — the tables

- [ ] 1.1 Create `public.club_discussions` — `id uuid default uuid_generate_v4() primary key`, `club_id uuid references public.clubs(id) on delete cascade not null`, `author_id uuid references public.profiles(id) on delete cascade not null` (per 0.1), `title text not null`, `created_at timestamptz default now() not null`.
- [ ] 1.2 Add the title CHECK: `title ~ '\S' and length(title) <= 80`. **Not `btrim`** — design.md §Text bounds carries the measured reason.
- [ ] 1.3 Create `public.club_messages` — `id` (client-suppliable, defaulted), `discussion_id uuid references public.club_discussions(id) on delete cascade not null`, `author_id` (cascade to `profiles`), `body text not null`, `created_at timestamptz default now() not null`, CHECK `body ~ '\S' and length(body) <= 1000`.
- [ ] 1.4 Create `public.club_discussion_reads` — `user_id`, `discussion_id`, `last_read_at timestamptz default now() not null`, `primary key (user_id, discussion_id)`. **`user_id` leads**: `029` asserts every FK into `profiles` has a leading-column index.
- [ ] 1.5 Indexes: `club_discussions (club_id, created_at desc, id desc)`, `club_discussions (author_id)` (cascade), `club_messages (discussion_id, created_at, id)`, `club_messages (author_id, created_at desc)` (cascade), `club_discussion_reads (discussion_id)` (cascade from a thread delete).
- [ ] 1.6 `alter table ... enable row level security` on all three.
- [ ] 1.7 Write the table comments. They are the `data` agent's first read via `list_tables` and no edit to `CLAUDE.md` reaches them — say for each that the audience is club membership, that the parent `EXISTS` is the redundant half **here** (the inverse of `ride_messages`), and why the redundant conjunct stays.

## 2. Migration `081` — policies

- [ ] 2.1 `club_discussions` SELECT: `exists (clubs) and private.is_club_member(club_id) and (author_id = auth.uid() or not private.is_blocked(auth.uid(), author_id))`.
- [ ] 2.2 `club_discussions` INSERT `with check`: `author_id = auth.uid() and exists (clubs) and private.is_club_member(club_id)`. **No block arm** — design.md and the spec both state why a blocked pair may both post.
- [ ] 2.3 `club_discussions` DELETE `using`: `exists (clubs) and private.is_club_member(club_id) and author_id = auth.uid()`. Author only — the owner's arm is the RPC in task 4.2.
- [ ] 2.4 **No UPDATE policy on `club_discussions`.** Absence is the enforcement.
- [ ] 2.5 `club_messages` SELECT: the two-hop `EXISTS` against `club_discussions` written out in design.md §The grandchild, plus the block arm on `club_messages.author_id`.
- [ ] 2.6 `club_messages` INSERT `with check`: `author_id = auth.uid()` plus the same two-hop conjunction.
- [ ] 2.7 `club_messages` DELETE `using`: the two-hop conjunction, and `(author_id = auth.uid() or exists (select 1 from club_discussions d join clubs c on c.id = d.club_id where d.id = discussion_id and c.owner_id = auth.uid()))`. Comment the owner arm's blocked-author gap as **known and inherited from `034`/`011`**, with `moderate_club_message` named as the shape if a control is ever drawn.
- [ ] 2.8 **No UPDATE policy on `club_messages`.**
- [ ] 2.9 `club_discussion_reads`: SELECT `user_id = auth.uid()` alone; INSERT and UPDATE `with check` carrying `user_id = auth.uid()` plus the full audience conjunction; UPDATE `using` = `user_id = auth.uid()` **alone** (`061`'s deliberate asymmetry). Comment that `034`'s reason for the conjunction does **not** transfer — a `WITH CHECK` grants no reads — and that `015` §2's existence-oracle reason does.
- [ ] 2.10 **No DELETE policy on `club_discussion_reads`**, and comment the honest reason: "mark unread again" is drawn nowhere. Do **not** repeat `015`'s cascade claim — the FK is to `club_discussions`, so leaving the club leaves the row standing.

## 3. Migration `081` — grants and triggers

- [ ] 3.1 `revoke all on public.club_discussions, public.club_messages, public.club_discussion_reads from anon, authenticated`.
- [ ] 3.2 `grant select, delete` on the two content tables to `authenticated`; `grant select, insert, update on public.club_discussion_reads to authenticated`.
- [ ] 3.3 Per-column INSERT grants: `(id, club_id, author_id, title)` and `(id, discussion_id, author_id, body)`. **`created_at` on neither.** Comment that a `default` applies only when the column is omitted and PostgREST will name it.
- [ ] 3.4 Add `enforce_participation_gate` BEFORE INSERT triggers to **both** content tables, each `for each row when (current_user = 'authenticated')`. The `WHEN` clause is not decoration (`023` §2).
- [ ] 3.5 **No gate trigger on `club_discussion_reads`**, and say so in a comment with `023`'s reason for `feed_reads`.
- [ ] 3.6 Restamp the comment on `public.enforce_participation_gate()` from nine to **thirteen**, naming the two new tables — `028` and `033` exist for exactly this.
- [ ] 3.7 `public.stamp_club_discussion_read()` — `security invoker`, `set search_path = ''`, sets `new.last_read_at := now()`, `revoke all` from every role, hung as `before insert or update`. **Both arms**: INSERT-only works on fresh rows and drifts in use.

## 4. Migration `081` — functions and publication

- [ ] 4.1 `public.club_discussion_unread(club uuid) returns table (discussion_id uuid, has_unread boolean)` — `security invoker`, `stable`, `set search_path = ''`, the three-arm `coalesce` from design.md, `author_id <> auth.uid()`. Comment each of the four properties with the precedent it carries (`061` §4, `079`).
- [ ] 4.2 `public.moderate_club_discussion(discussion uuid)` — `security definer`, `set search_path = ''`, `#variable_conflict error`, one `select ... for update` joining to `clubs` on `owner_id = auth.uid()`, **one** raise site so "no such thread" and "not your club" are indistinguishable (`043`'s shape). Deletes one row; the FK cascades the messages.
- [ ] 4.3 Grants on both functions: `revoke all from public, anon`, `grant execute to authenticated`.
- [ ] 4.4 `alter publication supabase_realtime add table public.club_messages`. **Do not add `club_discussions`**, and say in the file why not, so a later session finds the decision in the file rather than in a channel that reports SUBSCRIBED and never fires.
- [ ] 4.5 Default replica identity on `club_messages` — no `full`. Comment the reason (no UPDATE, subscriber reads INSERT).
- [ ] 4.6 Write the verification footer: the policy/role counts, `anon` grant count 0, the **enumerated** INSERT columns, `has_table_privilege('authenticated', …)` scoped per grantee, publication membership **and** non-membership, `prosecdef` false on the reader / true on the moderator, `indnullsnotdistinct` count 0 on the reads table, gate trigger count **13**, advisors **14**.

## 5. RLS assertions — `supabase/tests/rls_test.sql`

Every task here is required: `openspec/config.yaml` and `CLAUDE.md` both say a policy change with no new assertion is not finished. Each maps to a scenario in `specs/club-discussions/spec.md`.

- [ ] 5.1 A club member of any `role` reads and writes both content tables.
- [ ] 5.2 The club owner holding **no** `club_members` row reads and writes both.
- [ ] 5.3 **A signed-in non-member of a PUBLIC club reads zero threads and zero messages, and every insert is refused.** This is the case a policy carrying only the `clubs` `EXISTS` fails — the single most important assertion in this change.
- [ ] 5.4 A signed-in non-member of a **private** club reaches nothing, including with a stale `club_discussion_reads` row present.
- [ ] 5.5 Each conjunct asserted **alone**: one case fails if the `clubs` `EXISTS` is removed, a different case fails if `private.is_club_member` is removed. A single case both hide is not coverage.
- [ ] 5.6 `clubs` SELECT still carries **no** `private.is_blocked` call — a catalog assertion, so the day one is added this change's reasoning is re-read.
- [ ] 5.7 A rider who left the club loses every thread and message including their own; the rows survive for everyone else.
- [ ] 5.8 A rider who joined after a thread was created sees the whole thread.
- [ ] 5.9 A member cannot insert with a foreign `author_id`; a non-member of a public club cannot insert at all.
- [ ] 5.10 No UPDATE grant **and** no UPDATE policy on either content table — asserted separately, per grantee (`has_table_privilege`, not a grant-row count: `postgres` and `service_role` hold everything).
- [ ] 5.11 Author deletes their own thread; a third member cannot; the messages go with it.
- [ ] 5.12 `moderate_club_discussion`: the owner deletes a member's thread; **the owner deletes a thread whose author they have blocked** (the case a policy arm fails silently); a non-owner gets `insufficient_privilege` identical to a nonexistent id.
- [ ] 5.13 Message DELETE: author yes, third member no, a rider who has left no.
- [ ] 5.14 Blocking, both directions from one row: B's thread absent from A's list, B's messages absent from a shared thread, C sees all three riders' content.
- [ ] 5.15 A blocked pair both insert successfully into the same thread and each sees only their own.
- [ ] 5.16 Deleting a club removes its threads, messages and watermarks; `delete_owned_club` on the default club is still refused.
- [ ] 5.17 Neither new FK into `clubs`/`club_discussions` is `ON DELETE SET NULL` — the property `043`'s existence rests on.
- [ ] 5.18 Account deletion: a thread author's deletion removes the thread and other riders' messages in it; a replier's deletion removes only their own messages.
- [ ] 5.19 Watermark: readable only by its owner (the club owner and thread author included); refused for a thread the writer cannot read; the trigger overrides a future `last_read_at` on **both** INSERT and UPDATE; no DELETE grant.
- [ ] 5.20 Gate: a rider with `terms_accepted_at` NULL is refused by both new triggers; `club_discussion_reads` carries **no** gate trigger (assert the absence); the total reads **13**.
- [ ] 5.21 `club_discussion_unread`: excludes the caller's own messages; falls back to `club_members.joined_at` and then to `club_discussions.created_at`; returns false for a blocked author's message; `prosecdef` is false.
- [ ] 5.22 Publication: `club_messages` is in `supabase_realtime` and `club_discussions` is **not** — both from the catalog.
- [ ] 5.23 `anon` holds zero grants on all three tables, and no policy is written for a role other than `authenticated`.

## 6. Apply and verify

- [ ] 6.1 Apply `081` to DEV via `apply_migration`. It is well under `036`'s 61 KB, so no reduction technique is needed.
- [ ] 6.2 Run the footer's verification queries against DEV. Every number must match; a mismatch is investigated before any code lands.
- [ ] 6.3 `get_advisors(security)` on DEV — expect **14**, the fourteenth being `authenticated_security_definer_function_executable` for `moderate_club_discussion`. A fifteenth means a revoke did not land or the reader was written `definer`.
- [ ] 6.4 `PGPASSWORD=postgres npm test` green, and reconcile the **label set** against 0.4's, not the count.
- [ ] 6.5 `npm run db:drift` — repo, DEV and PROD agree on the chain.

## 7. Types, validation, reads and writes

- [ ] 7.1 Add `ClubDiscussion`, `ClubDiscussionListItem` and `ClubMessage` to `src/types/index.ts`. Domain types are never inlined.
- [ ] 7.2 `clubDiscussionTitleSchema` and `clubMessageBodySchema` in `src/lib/validation/clubs.ts`, each mirroring its CHECK exactly — `.trim()` plus the same ceiling on the raw length. Zod owns the message, the database owns the guarantee.
- [ ] 7.3 `src/lib/data/club-discussions.ts` through `resolveSupabase`: `getClubDiscussions(clubId)`, `getClubDiscussion(id)`, `getClubDiscussionMessages(discussionId)`, `getClubDiscussionUnread(clubId)` (the RPC). Return `null` for a decided absence; never a bare `.from()` in a component.
- [ ] 7.4 `src/lib/actions/club-discussions.ts`: `createClubDiscussion`, `deleteClubDiscussion`, `moderateClubDiscussion` (the RPC), `sendClubMessage`, `deleteClubMessage`, `markClubDiscussionSeen`. Plain async functions, `useActionState`-compatible, each invalidating exactly what it moves.
- [ ] 7.5 `sendClubMessage` supplies a client-generated `id` and reads `23505` as success — the retry path `034` designed the suppliable id for.
- [ ] 7.6 `markClubDiscussionSeen` upserts and **sends** `last_read_at`; the trigger makes the value true. Comment that withholding the column grant would **not** work here — PostgREST builds the `do update set` list from the request body, so an omitted column needs no privilege and nothing raises (`061` §3's measured correction).

## 8. Cache keys

- [ ] 8.1 Add `clubs.discussions(clubId)`, `clubs.discussionsUnread(clubId)` (nested under the first) and `clubs.discussionMessages(discussionId)` to `src/lib/query/keys.ts`. No key written inline in a component, ever.
- [ ] 8.2 Document in the `keys.ts` header table that `clubs.discussionMessages` is **not** reachable from the `['clubs','detail',clubId]` prefix, and which call sites must therefore name it. This is the first key in the file its domain prefix does not reach.
- [ ] 8.3 Wire the invalidations: `createClubDiscussion` → `clubs.discussions(clubId)`; `deleteClubDiscussion`/`moderateClubDiscussion` → the list **and** `clubs.discussionMessages(id)`, carrying the club id in the action rather than re-reading it after the row is gone; `sendClubMessage`/`deleteClubMessage` → `clubs.discussionMessages(id)`; `markClubDiscussionSeen` → `clubs.discussionsUnread(clubId)` alone.

## 9. Generalise the chat components

- [ ] 9.1 Move `RideChatThread`, `RideChatRow`, `RideChatComposer` and `MarkRideChatSeen` to `src/components/chat/` as `ChatThread`, `ChatRow`, `ChatComposer`, `MarkChatSeen`, parameterising the ride-specific bits. Update the ride chat screen's imports.
- [ ] 9.2 Rename `formatRideMessageDay` → `formatChatMessageDay` in `src/lib/utils.ts` and its unit tests. Keep `formatRideTime(created_at, null)` as the message clock — a discussion has no timezone, so `null` is honest, and `CLAUDE.md` forbids adding a generic formatter.
- [ ] 9.3 `npm run docs:check` and `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — a rename can break a declared claim or a `file.md §Section` pointer.

## 10. Realtime

- [ ] 10.1 `src/lib/realtime/useClubDiscussionStream.ts`, modelled on `useRideMessageStream`: one channel named `club-discussion:${discussionId}:messages`, INSERT only, removed on unmount, refetch on reconnect and on foreground.
- [ ] 10.2 The **thread list does not subscribe**. State that in the list component's docstring, so a screen that quietly does not subscribe is distinguishable from one whose channel is broken.
- [ ] 10.3 Verify per-subscriber authorization **by observation** against DEV — two accounts, a block between them, one shared thread; the blocked side must receive silence. The RLS suite cannot assert this; plain Postgres has no Realtime.

## 11. Screens

- [ ] 11.1 `ClubDiscussionsSection` on `/clubs/detail`, shaped like the Members section — header, up to N rows, `See all`. For a **non-member of a public club** it renders a join prompt and discloses no title, count, author or time.
- [ ] 11.2 `/clubs/detail/discussions?id=<club id>` — the list, keyset-paged over `(created_at desc, id desc)`, with the per-thread unread dot from `clubs.discussionsUnread`.
- [ ] 11.3 `/clubs/detail/discussion?id=<discussion id>` — the thread, reusing `ChatThread`/`ChatComposer`, subscribing, and mounting `MarkChatSeen`.
- [ ] 11.4 `/clubs/detail/discussions/new?id=<club id>` — the create form, title only, hand-rolled controlled input plus `useActionState`.
- [ ] 11.5 Add the routes to `src/lib/routes.ts` using `DETAIL_ID_PARAM`, and add them to the walk's route list so a screen that throws on load is caught.
- [ ] 11.6 Every screen: gate on **data**, never `isLoading`; `null` is decided and `undefined` is "not yet"; skeleton at the content's own padding; an error state with retry that is not an empty conversation; a partial state where a failed unread call leaves the list rendering unmarked.
- [ ] 11.7 Read the composition from `design/` only — there is no v2 Discussions frame, so `Ride - Chat` (`2226:4999`) and `Inbox - Chats` (`2375:9518`) are the measured sources. Use `--all` on any `tree`. Icons from `@/components/icons/generated`; primary buttons near-black `Grey/100 #1A1A1A`, never green.

## 12. Verify and document

- [ ] 12.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 12.2 `npm run walk` against DEV, through `scripts/supabase-relay.mjs` — the only gate that renders anything. Confirm the new routes render and the ride chat still does after task 9.
- [ ] 12.3 Confirm no component calls `supabase.from()`: `grep -rn "supabase\.from(" src/app/ src/components/ | grep -vE ':[0-9]+:\s*(\*|//|/\*)'` prints only the existing comment lines.
- [ ] 12.4 Confirm the dependency count is unchanged: `node -p "Object.keys(require('./package.json').dependencies).length"`.
- [ ] 12.5 Add the three table rows to `docs/reference/schema.md`, each carrying the audience predicate, the cascade behaviour and the deletion answer.
- [ ] 12.6 Update `docs/reference/product-scope.md` §Clubs — Discussions ships, and the remaining gaps are the activity feed and invitations.
- [ ] 12.7 Update `CLAUDE.md`'s advisor table to fourteen, naming `moderate_club_discussion`, and its participation-gate paragraph to thirteen tables. **Main thread writes these, not a subagent.**
- [ ] 12.8 Run `reviewer` on the final diff, once, immediately before the PR.
