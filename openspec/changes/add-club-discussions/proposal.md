# Club Discussions — titled threads inside a club

> Linear **PD-299** — *"A club is a container, not a place"*, proposal **#1 of five**. That issue
> is the epic; this file is the specification and the issue must not restate it (`CLAUDE.md`
> §The roadmap lives in Linear: *"A Linear issue that grows a specification is a bug."*).

## ⚠ Read this first — what is second-hand, and what was measured

**The threads decision IS on the board, and an earlier draft of this file said it was not.**
`PD-307` — *"Club Discussions — titled threads on a club"* — is this change's own issue, a child of
`PD-299`, created 2026-08-27 **before** this proposal, and its body states the decision and dates
it: *"PD-299 asked threads, or one chat per club? — product owner, 2026-08-27: **threads**."*
`PD-299` now carries a comment recording it too. The first draft checked only `PD-299`, found
`Needs decision` with zero comments, and reported the decision as unrecorded — **a false claim
about the board, caused by reading the epic and not the story split off from it.** Corrected here
rather than narrated further; `get_issue PD-307` is the command.

Everything else below is **measured**, against `letsride-dev` (`fpmrimzxadewsaiwpsel`) on
2026-08-27, and each claim carries the command that re-derives it. Nothing here is inferred from
`CLAUDE.md`'s numbers.

## One correction to the framing this change was briefed with

PD-299 says the club audience is *"simpler than the ride's, which is an intersection of two
predicates where a club's is one."* **That is true about the predicate count and it invites
exactly the wrong build.**

For `ride_messages`, the parent `EXISTS` is the **strict** half: `rides` SELECT carries a block
arm and a private-club arm that `private.is_ride_crew` — being `security definer` — steps past.
`034`'s header is entirely about that, and it cost a shipped leak.

For a club it is **inverted**. Measured:

```sql
select policyname, qual from pg_policies
 where schemaname = 'public' and tablename = 'clubs' and cmd = 'SELECT';
-- (is_public OR (owner_id = auth.uid()) OR private.is_club_member(id))
```

`is_public` admits **every signed-in rider** — decision #1's *"visible to any signed-in rider"* —
so on a public club the parent `EXISTS` is satisfied by the entire platform. The **helper is the
load-bearing half here**, and the strict one. A session that reads `034` as "the `EXISTS` is what
protects you" and swaps the audience by relaxing the helper ships every public club's Discussions
to every rider in the app.

**The 034 claim about `is_club_member` still holds, and it holds for a narrower reason than it
reads.** Measured — `private.is_club_member(c)` delegates to `private.is_club_member_for(auth.uid(), c)`,
whose body is `exists(club_members row) or exists(clubs where owner_id = candidate)` (`054`, split
by `060`). Both disjuncts *imply* a `clubs` SELECT disjunct, so **today the helper alone is
sufficient and the parent `EXISTS` is redundant**. That is a property of the current three-arm
`clubs` policy, not of the helper, and `054`'s own §RECURSION WARNING shows `clubs` is live
territory. This change keeps the conjunction anyway — see `design.md` §The audience, which states
the honest reason rather than borrowing `034`'s, because `061` §2 already records what a false
stated justification costs: *"a comment whose stated reason is false is how the next session
removes the conjunct."*

## Why

A club today is a container. Once a rider joins, the club does nothing: the Timeline shows
postcards tagged to it, there is no conversation, and `docs/reference/product-scope.md` logs the
activity feed and invitations as unbuilt. Clubs is one of four tabs and the least alive.

Discussions is the cheapest thing that changes that, and it borrows an implementation this repo
has already proved twice (`034` chat, `061` watermark). It also does double duty on first-run:
a "Say hello" thread in the Welcome club (`058`, PD-239) gives a brand-new rider somewhere to
land that is not an empty feed.

**It needs a proposal rather than a ticket because it adds two tables whose audience is narrower
than their parent's, in the direction opposite to the one worked example in the repo** — see the
correction above. That failure is silent, lives in a policy, and passes every green test.

## What Changes

**One migration, `081`** (80 files today; DEV at `080`, PROD at `079` — re-derive with
`list_migrations` against `ls supabase/migrations/`, per `CLAUDE.md`'s own instruction not to read
the number off prose). Nothing in it is destructive, so it does not need `069`/`070`'s
additive-before / destructive-after split, and it hangs **no trigger on an already-shipped write
path** — both participation-gate triggers land on brand-new tables — so `036`'s hand-exercise gate
does not fire either. Both checked rather than assumed.

- **`public.club_discussions`** — the thread: `id`, `club_id`, `author_id`, `title`, `created_at`.
  RLS on, `to authenticated` only, INSERT granted **per column** so `created_at` is server-owned.
  No UPDATE policy and no UPDATE grant.
- **`public.club_messages`** — the message: `id` (client-suppliable), `discussion_id`,
  `author_id`, `body`, `created_at`. Same shape as `ride_messages` (`034`), including the
  `~ '\S'` whitespace floor rather than `btrim`, the per-column INSERT grant, and membership of
  `supabase_realtime`.
- **`public.club_discussion_reads`** — a **per-thread** unread watermark, `061`'s model
  transferred: `(user_id, discussion_id, last_read_at)`, `last_read_at` imposed by a trigger.
- **`public.club_discussion_unread(club uuid)`** — `security invoker`, returns
  `(discussion_id, has_unread boolean)` for the caller. Plural where `061` was singular, because
  the caller is a *list*. Excludes the caller's own messages (`079`'s fix, applied at birth).
- **`public.moderate_club_discussion(discussion uuid)`** — `security definer`, the club owner's
  one moderation right, re-checking `clubs.owner_id = auth.uid()` in its own body. `011` §1b's
  shape.
- **`public.delete_own_club_message(message uuid)`** — `security definer`, re-checking
  `author_id = auth.uid()` in its own body, and **the only** delete path for a message:
  `club_messages` carries no DELETE policy and no DELETE grant, following `078`'s `push_devices`
  precedent. It exists because a rider blocked by a thread's author otherwise loses the ability to
  erase their own words — measured, see `design.md` §Deleting a message.
- **Together these add TWO security advisors** and the expected total becomes **15**, not 14 —
  re-derive with `get_advisors(security)`. `CLAUDE.md` records thirteen today and warns in as many
  words that this advisor *"fires once per such function, so a migration adding two adds two"*,
  which is exactly what `078`'s own task list got wrong. `club_discussion_unread` is
  `security invoker` and adds none.
- **Two new participation-gate triggers.** Measured: **11** today
  (`select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal`
  → `11` on DEV, 2026-08-27). Both new content tables take one, exactly as `ride_messages` did in
  `034` §5, so the expected count after `081` is **13, not 12**. `club_discussion_reads` takes
  **none**, following `023`'s stated reason for `feed_reads` and `061`'s for `ride_reads`. The
  comment on `enforce_participation_gate()` reads **eleven** today, not nine — measured — and
  enumerates the ninth, tenth and eleventh by name, so the restamp is "eleven → thirteen" plus
  **two new entries in that enumeration**.
- **Routes**: a Discussions section on `/clubs/detail`, a list at `/clubs/detail/discussions`, a
  thread at `/clubs/detail/discussion?id=<discussion id>`, and a create screen.
- **The app's second Realtime subscription** — `club:discussion:<id>:messages`, INSERT only.
- **Chat components generalised, not copied.** `RideChatThread`, `RideChatRow`,
  `RideChatComposer` and `MarkRideChatSeen` move to `src/components/chat/` with the ride screens
  importing from there. Two chat renderers that drift is the outcome copying buys.

**Explicitly NOT in this change**, each named rather than silently omitted:

- **Invitations (PD-299 #2 and #3), the activity feed (#4) and the admin role (#5).** Out of
  scope; see PD-299. In particular this change touches **no** `club_members.role` predicate:
  `admin` has existed since `001` and nothing has ever written it, so a policy arm naming it would
  be dead code that reads as live.
- **Pinning a thread.** Deferred — see `design.md` §Pinning and the Welcome club. Recommended
  deferral, with the reason and what would un-defer it.
- **Notifications for a new thread or message.** Deferred; it needs its own proposal against
  `event-fanout-integrity`. See `design.md` §Notifications for the two traps waiting there.
- **A club-level rollup on the `/clubs` list.** `club_unread_counts()` is unchanged, so a new
  discussion does not badge the club card. Decided, not deferred — `design.md`, `Questions Closed`, D4.
- **Editing a thread title or a message.** No UPDATE grant, no UPDATE policy, no `updated_at`
  column — `034` §4 and `011`'s ruling, and `database-enforced-integrity`'s standing requirement.

## Capabilities

### New Capabilities

- `club-discussions`: who may open, read, write, delete and moderate a club's titled threads and
  their messages; what a block does inside one; what happens when a rider leaves, is deleted, or
  the club is deleted; and every state each screen can be in.

### Modified Capabilities

- `database-enforced-integrity`: the standing requirement *"A child table whose audience is
  NARROWER than its parent's SHALL enforce that by composition, never by a privileged helper
  alone"* is written entirely from `ride_messages`, where the parent was the strict half. The club
  case inverts it and needs its own scenarios, or the requirement teaches the wrong lesson to the
  next child table. Text bounds and the server-owned-column requirement each gain the two new
  tables.
- `realtime-subscriptions`: the repo goes from one live stream to two, which turns three
  requirements written as descriptions of a single subscription into rules that must hold across
  a set — channel naming, publication membership, and per-subscriber authorization.
- `client-cache-invalidation`: the thread key cannot sit under the `['clubs','detail',<clubId>]`
  prefix, because the thread screen knows only the discussion id. That is the first key in
  `keys.ts` that a domain-wide invalidation does **not** reach, and the requirement that every
  mutation declares what it invalidates needs the exception stated rather than discovered.

## Impact

**Database** — `supabase/migrations/081_club_discussions.sql`; assertions in
`supabase/tests/rls_test.sql` (suite is **1841** today — re-derive with
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`, and reconcile by **label set**, not
by count). The comment on `enforce_participation_gate()` must be restamped from **eleven** to
thirteen, with two names added to its enumeration — it is the `data` agent's first read via
`list_tables` and no edit to `CLAUDE.md` reaches it (`028`, `033`).

**Reads** — new `src/lib/data/club-discussions.ts`, through `resolveSupabase`. **Writes** — new
`src/lib/actions/club-discussions.ts`, plain async functions. No component calls
`supabase.from()`.

**Cache** — three new keys in `src/lib/query/keys.ts`, with the reconciliation note that file's
header exists for.

**Validation** — `clubDiscussionTitleSchema` and `clubMessageBodySchema` in
`src/lib/validation/clubs.ts`, each mirroring a CHECK in `081`. Per `CLAUDE.md`, Zod owns the
message and never the guarantee.

**Design** — **no v2 frame exists for a club Discussions screen.** `npm run figma -- ls` returns
`Private club - Timeline / Rides / Members / About / Sub Pages` and the public-club set, and
nothing matching `discuss|thread|topic`. The composition in `design.md` is **ours**, assembled
from measured components (`Ride - Chat` `2226:4999`, `Inbox - Chats` `2375:9518`) rather than
invented and called measured.

**Dependencies** — none added. Nine runtime dependencies before and after
(`node -p "Object.keys(require('./package.json').dependencies).length"`).

**Docs** — `CLAUDE.md`'s advisor table goes to fifteen and its participation-gate list to
thirteen tables; `docs/reference/schema.md` gains three table rows;
and the `Clubs` row of `docs/reference/product-scope.md` loses the activity feed and invitations
as its *only* two logged gaps.
