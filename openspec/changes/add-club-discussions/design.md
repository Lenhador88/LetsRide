## Context

See `proposal.md` §Why for motivation and §⚠ for what is second-hand. This file covers **how**, and
the requirements are in `specs/club-discussions/spec.md` — where a section here would only restate
one, it points instead.

Three pieces of existing state shape everything below, all measured against `letsride-dev`
(`fpmrimzxadewsaiwpsel`) on 2026-08-27:

```
clubs SELECT  = is_public OR owner_id = auth.uid() OR private.is_club_member(id)
private.is_club_member(c)     -> private.is_club_member_for(auth.uid(), c)
private.is_club_member_for(u, c) -> exists(club_members row) or exists(clubs.owner_id = u)
enforce_participation_gate triggers = 11
```

And two shipped precedents this change is a transfer of rather than an invention: `034`
(`ride_messages`, the app's only Realtime subscription) and `061` (`ride_reads`, the watermark and
the `security invoker` reader).

## Goals / Non-Goals

**Goals**

- Get the audience right in RLS, in the direction this repo has no worked example for.
- Reuse `034` and `061` structurally — same trigger, same grant shape, same watermark model — so
  the reviewer's question is "does it match the precedent" rather than "is this correct from
  scratch".
- Leave one Realtime subscription's worth of habits generalised into two, rather than copied.

**Non-Goals (design-level, beyond the proposal's scope list)**

- No transaction across two writes. PostgREST offers none and the client owns the mutation path, so
  any "thread plus first message atomically" design is either an RPC or a lie. See §Thread creation.
- No denormalised `last_message_at`, `message_count` or `participant_count` on a thread. Every one
  is a copy of a visibility decision — see §Ordering.
- No admin role, no `club_members.role` predicate anywhere in `081`.

## Decisions

### The audience — which predicate does which job

**Both tables' SELECT policy is a three-part conjunction**, and each part answers a different
question:

| Conjunct | Question | Runs as | Strict here? |
|---|---|---|---|
| `exists (select 1 from public.clubs c where c.id = …)` | may I see this club | the **caller** | no — `is_public` admits everyone |
| `private.is_club_member(club_id)` | am I in it | the **definer** | **yes** |
| `author_id = auth.uid() or not private.is_blocked(auth.uid(), author_id)` | may I see this rider's words | the definer, per author | yes |

**This is `034`'s conjunction with the strictness inverted**, and that inversion is the single
thing a builder must not carry over wrong. `034`'s header says the parent `EXISTS` closes two leaks
the crew helper walks past. Here it closes nothing — `private.is_club_member` *implies* every
`clubs` SELECT disjunct — and the helper is the whole audience.

**Alternative considered: drop the redundant `EXISTS`.** Rejected, for the reasons in
the `Discussion visibility` requirement in `specs/club-discussions/spec.md`. The short version: the implication is a
property of `clubs`' current three arms, and `054`'s own recursion warning shows `clubs` is
actively edited; and using a `private` membership helper as a *sole* conjunct anywhere teaches the
next table that the shape is safe, which is precisely how `034`'s first draft shipped a leak.

**Alternative considered: a new `private.is_club_discussion_member(discussion uuid)` helper for
`club_messages`, so the message policy is one call.** Rejected. It would hide the two-hop chain
inside a definer function whose body nobody reads at review time, and a definer function reading
`club_discussions` sees neither the block arm nor the club conjunct. The messages policy joins to
`club_discussions` explicitly instead — see §The grandchild.

### The grandchild — `club_messages` restates the whole chain

`club_messages` SELECT is:

```
exists (
  select 1 from public.club_discussions d
   where d.id = club_messages.discussion_id
     and exists (select 1 from public.clubs c where c.id = d.club_id)
     and private.is_club_member(d.club_id)
)
and (author_id = auth.uid() or not private.is_blocked(auth.uid(), author_id))
```

The inner `EXISTS` against `club_discussions` runs under the caller's own row security, so the
thread's policy already applies and the two inner conjuncts are, strictly, redundant a second time.
They are written anyway, and the honest reason is the same one as above plus one more: without
them, the message table's audience is undiscoverable from its own policy text, and a later change
to the thread policy silently retargets it.

Note the block arm is on `club_messages.author_id`, **not** inherited from the thread. A thread by
an unblocked author can hold messages by a blocked one.

### Two tables, and why not one

**Alternative considered: one `club_messages` table with a nullable `title` on the first row.**
Rejected — the "root message" pattern makes every list query a self-join, makes a thread's
deletion a manual cascade, and makes the title editable exactly as often as a message body is,
which the spec refuses. Two tables gives the cascade for free.

### Thread creation takes a title and no first message

A thread is one INSERT. It is created empty and the thread screen renders an empty-thread state
with a working composer.

**Alternative considered: a two-field form writing thread + first message.** That is two round
trips with no transaction — the `createRide`/`createClub` shape that `034` §1 and `054` both name
as *reachable on demand rather than only on error*. The empty thread is therefore reachable no
matter how the form is drawn, so requiring a first message buys an invariant nothing enforces and
an error state nothing can recover from (the thread exists, the message failed).

**Alternative considered: a `security definer` RPC writing both in one transaction.** It works,
and it is declined: it costs a second advisor, it puts a rider's content write behind a function
where the participation-gate trigger cannot fire (`023` §2 — `current_user` is the owner inside a
definer body, so the gate's `WHEN` clause is false; this is the `push_devices` problem from `078`
arriving on a content table), and an empty thread is a legitimate state anyway — "Who's riding
Sunday?" is a complete question.

That last point is the load-bearing one and it generalises: **no content write in this change goes
through a `security definer` function**, because the participation gate cannot reach one.

### Ordering: `created_at DESC, id DESC`, and no `last_message_at`

Threads sort newest-created first. `id` is in the sort key and in the index because `created_at` is
not a total order — two rows inserted in one transaction share `now()` exactly.

**Alternative considered, and it is what a chat list normally does: sort by most recent message.**
Rejected for this pass, for a reason that is a standing requirement rather than a preference. A
denormalised `last_message_at` on `club_discussions` is **a copy of a visibility decision**
(`database-enforced-integrity`): a message from an author the viewer has blocked must not bump the
thread for that viewer, and a stored column cannot know who is asking. Computing it live is a
per-viewer aggregate over `club_messages` for every row of the list — the shape `015` had to cap at
`limit 100`.

The follow-up, if the ordering is wanted: a `security invoker` function returning
`(discussion_id, last_message_at)` under the caller's RLS, sorted client-side, capped. It is the
same shape as the unread reader and can reuse its index. Named, not built — the `Questions Closed` section, D3.

**Consequence worth stating plainly, and it is a loss rather than a wash:** `created_at DESC` puts
"Say hello" first only while it is the *newest* thread. The Welcome club is the club least likely to
keep that true — every onboarded rider is auto-joined (`058`), and any member may open a thread — so
the one thread PD-239 wants a brand-new rider to land on is the one most reliably pushed down. PD-299
asked for a **pinned** thread and this change does not deliver one.

**There is no cheap pin that is not a column, and inventing one would be worse than the gap.** The
near-misses were considered and all fail: sorting the club's oldest thread first inverts the list for
every other club; sorting the owner's threads first pins every thread they ever open; hard-coding the
default club's first thread puts a data-dependent id in a sort. The honest options are a column with
an owner-only write path or nothing, and this change takes nothing — see §Pinning and the Welcome
club for what un-defers it. **The product owner has to accept this loss**, and it is called out in
the `Questions Closed` section rather than left to be discovered when the Welcome club's greeting is third.

### Pinning and the Welcome club

**Deferred, and deliberately rather than by omission.** A `pinned_at` or `is_pinned` column needs a
writer, and there is none: the admin role is PD-299 #5 (out of scope), and no pin affordance is
drawn anywhere in `design/`. A column nothing writes is a dead column that reads as live —
`034` §1 refused an `updated_at` on exactly that ground.

What un-defers it: an owner-facing pin control in the design, or the admin role landing. When it
does, it is one nullable `timestamptz`, one `order by pinned_at desc nulls last, created_at desc`,
and an owner-only UPDATE grant on that column alone (`025`'s per-column precedent), because a
member-writable pin is a member pinning themselves to the top of a club for ever.

### Unread: per thread, `061` transferred, with `068` and `079` already applied

`club_discussion_reads (user_id, discussion_id, last_read_at)`, PK `(user_id, discussion_id)`,
with **both key columns carrying a foreign key**: `user_id references public.profiles(id) on delete
cascade` and `discussion_id references public.club_discussions(id) on delete cascade`. An earlier
draft of this file named the columns and the PK and no `references` at all — alone among the three
tables — which builds a table whose rows say *when this named person last read this named topic*
and which **survives that person's account deletion for ever**, `029` working purely by cascade. It
is the one omission here that would have been a privacy defect rather than a correctness one.

- **`user_id` leads the key** — `029` asserts that no foreign key into `profiles` lacks a
  leading-column index, derived from `pg_constraint`, so `(discussion_id, user_id)` fails the suite.
- **A second index on `discussion_id`** for the cascade when a thread is deleted, mirroring
  `ride_reads_ride_id_idx`.
- **No `unique nulls not distinct`.** Both key columns are NOT NULL, so a real PK is available.
  `015` needs that clause because `feed_reads.club_id IS NULL` *means* the app-wide feed; there is
  no app-wide discussion, and a clause expressing a rule this table does not have teaches the next
  reader that the audience is nullable.
- **`last_read_at` imposed by `public.stamp_club_discussion_read()`**, BEFORE INSERT **OR UPDATE**.
  Both arms: INSERT-only would impose it on a rider's first visit and keep the client's on every
  visit after, which is the worst of the three behaviours because it works on fresh rows and drifts
  in use. This is `068`'s fix applied at birth rather than inherited-then-repaired.
- **UPDATE `USING` is `user_id = auth.uid()` alone**; the audience conjuncts live in the two
  `WITH CHECK`s. `061`'s asymmetry, for `061`'s reason.
- **No DELETE policy, no DELETE grant.** "Mark unread again" is drawn nowhere. And note the reason
  is *not* `015`'s stated one — leaving a club does not cascade this row away; the FK is to
  `club_discussions`, so the row stands until the thread or the rider goes, and rejoining reuses it.
- **No participation-gate trigger.** `023`'s reason for `feed_reads`, and `061`'s for `ride_reads`.
  The suite must assert the **absence**, or the count reads complete while gating nothing — `078`'s
  lesson, inverted.

**The reader**, `public.club_discussion_unread(club uuid) returns table (discussion_id uuid, has_unread boolean)`,
`security invoker`, in `public` so PostgREST reaches it:

```
exists (
  select 1 from public.club_messages m
   where m.discussion_id = d.id
     and m.author_id <> auth.uid()
     and m.created_at > coalesce(
       greatest(
         (select w.last_read_at from public.club_discussion_reads w
           where w.user_id = auth.uid() and w.discussion_id = d.id),
         (select k.joined_at from public.club_members k
           where k.club_id = d.club_id and k.user_id = auth.uid())
       ),
       d.created_at
     )
)
```

Four things, each carrying its precedent:

1. **`security invoker`** — so `club_messages`' SELECT policy decides what counts, blocks included.
   No block filter appears here, in `lib/data/` or in the component. If it ever flips to `definer`
   it starts answering `true` for threads the caller cannot read; the suite asserts `prosecdef` is
   false.
2. **`author_id <> auth.uid()`** — `079`'s fix, applied at birth. Your own message never lights
   your own dot, and the answer is then correct independently of a race with the navigation.
3. **`greatest(last_read_at, joined_at)`, not `coalesce` between them — and `061` would be wrong
   here.** A watermark row **survives leaving the club**: the FK is to `club_discussions`, so
   nothing cascades it away, and rejoining reuses it. With `last_read_at` merely first in a
   `coalesce`, a rider who read a thread in March, left, and rejoined in September is compared
   against their March watermark and is badged with every message sent while they were away — which
   directly contradicts the requirement that a rejoiner is not shown the back catalogue. `greatest`
   takes whichever is later, so the rejoin advances the comparison point without a write.
   Measured on this Postgres: `greatest` **ignores NULL** (`greatest(ts, null)` returns `ts`) and is
   NULL only when every argument is, so the outer `coalesce` still falls through to the third arm
   exactly as before. `061` does not need this because `ride_reads`' equivalent is a crew a rider
   rejoins far more rarely, but the same latent defect is there and is not fixed here.
4. **The third arm is load-bearing today**, for `061`'s exact reason arriving through a different
   door: a club **owner may hold no `club_members` row** — `054` exists because that state is
   reachable through `createClub`'s two un-transacted inserts *or* through the owner simply leaving,
   `club_members` DELETE being `auth.uid() = user_id` with no owner carve-out. With that arm absent
   their comparison point is NULL, every `created_at > NULL` is NULL, and the owner is the one
   member whose dot never lights, silently and for ever.
5. **All three arms are on the database's clock.** `048` made `club_members.joined_at`
   server-owned; the per-column INSERT grant makes `club_discussions.created_at` so. A comparison
   spanning two clocks through the *fallback* is the same defect wearing a fallback's clothes.

**Plural, where `061` was singular**, and `061`'s own reasoning says why that is not a
contradiction: N was 1 there because the dot sat on one ride's header. N is the list here. Boolean
rather than a count for `061`'s reason — `exists` short-circuits, so it is O(1) in thread length
through the `(discussion_id, created_at, id)` index, with no `limit 100` to justify and no number
for someone to render later.

### Deleting a message: RPC only, because a block otherwise makes your own words unerasable

**The defect, and it is real.** A authors thread T. B posts in it. A blocks B. B can no longer
delete their own message, `club_messages` DELETE matching zero rows and PostgREST reporting
success — while B's words stay visible to every unblocked member. The spec's own stated remedy for
a message you regret is deletion, so a block silently removes it. The same conjunction stops the
club owner deleting **any** message in a thread whose author they blocked, which is wider than the
gap `034` recorded.

**Two mechanisms cause it and only one is obvious.** The obvious one is the two-hop `EXISTS` in the
DELETE `USING`, which runs under the caller's RLS and therefore carries the *thread's* block arm.
The non-obvious one is that **the SELECT policy attaches to the DELETE as well**, and the message's
own SELECT policy carries the same two-hop `EXISTS`. Measured on this project (Postgres 17.6), with
a row the caller cannot select but does own and a DELETE policy that permits it:

| statement | outcome |
|---|---|
| `delete from t where id = 1` | row **survives** — SELECT policy applied |
| `delete from t where id = 1 returning 1` | row **survives** |
| `delete from t` | row deleted — SELECT policy not applied |

That confirms `034`'s recorded measurement rather than contradicting it, and it is worth saying how
nearly this went the other way: two earlier probes reported the opposite because a trailing bare
`delete from t` in the same transaction wiped the rows that had survived the statements under test.
A probe whose cleanup destroys its own evidence returns a clean, plausible, wrong answer — the
comment trap wearing a test harness.

**So relaxing the DELETE `USING` cannot fix this**, and a `private.discussion_club(discussion)`
helper feeding that clause — the fix the review proposed — changes no observable outcome, because
`supabase-js` issues `delete().eq('id', …)` and the SELECT policy hides the row before the `USING`
clause is ever reached. Adding it would be adding a conjunct whose stated benefit does not exist,
which this change's own spec forbids in as many words. **It is therefore not adopted**, and the
reason is a measurement rather than a preference.

**The fix is `public.delete_own_club_message(message uuid)`** — `security definer`, re-checking
`author_id = auth.uid()` in its own body — and `club_messages` carries **no DELETE policy and no
DELETE grant at all**. That is `078`'s `push_devices` shape (no client grant, an RPC that takes no
subject and acts only for its caller) and `011` §1b's reasoning, which named exactly this class of
problem: *"RLS filters a DELETE by what the caller may READ"*, solved with a definer function that
re-checks the authorship itself.

Authorship is the **whole** test — no club-membership conjunct. Your own words are always
retractable, including after you leave. That diverges from `ride_messages`, where a leaver cannot
delete, and the divergence is deliberate: a ride's chat disappears with the ride, while a club
thread is a permanent titled surface that other members keep reading. Stated rather than inherited.

**Threads keep their DELETE policy**, and the same inversion does *not* reach them: the
`club_discussions` DELETE `USING` contains no self-`EXISTS`, its only subquery is against `clubs`,
and `clubs` carries no block predicate — measured. The attaching SELECT policy exempts the author
via its `author_id = auth.uid()` arm, so an author can always see, and therefore delete, their own
thread. Verified by reading the policy rather than assumed from symmetry.

**The INSERT and watermark policies keep the two-hop `EXISTS` and need no change.** The inversion
reaches them, and there it is the *correct* answer: a rider who cannot see a thread should not be
able to post into it or mark it read. The only case it touches is a rider blocked by a thread's
author, who cannot reach the thread's screen at all.

### Moderating a thread: a definer RPC, because the block is not the remedy here

`public.moderate_club_discussion(discussion uuid)` is the club owner's one moderation right, and it
is an RPC rather than a second arm on the DELETE policy for the reason above plus one more. `034`
declined the equivalent gap because *"the block itself already removes the messages from the
blocker's view, which is the remedy a rider actually reaches for."* That holds for a chat message
and **fails for a thread**, which is a persistent titled object every *other* member keeps reading
after the owner has blocked its author.

It follows `043`'s shape exactly: one `select ... for update` joining `club_discussions` to `clubs`
on `owner_id = auth.uid()`, one raise site so "no such thread" and "not your club" are
indistinguishable, `security definer`, `set search_path = ''`, `revoke all from public, anon`,
`grant execute to authenticated`. It deletes one row and lets the FK cascade take the messages.

**Message-level owner moderation stays deferred** — no control is drawn — and its shape is
`public.moderate_club_message(uuid)`, the same definer pattern.

Together the two RPCs add **two** `authenticated_security_definer_function_executable` advisors,
taking the documented total from thirteen to **fifteen**. `club_discussion_unread` is `invoker` and
adds none. Re-derive with `get_advisors(security)` before and after; a sixteenth means a revoke did
not land.

### Grants — the shape, per table

| Table | `authenticated` table grants | INSERT column grant |
|---|---|---|
| `club_discussions` | `select, delete` | `(id, club_id, author_id, title)` — **not** `created_at` |
| `club_messages` | `select` **only** | `(id, discussion_id, author_id, body)` — **not** `created_at` |
| `club_discussion_reads` | `select, insert, update` | table-level (nothing to withhold) |

`club_messages` holding no DELETE grant is the enforcement, not an omission — deletion is
`delete_own_club_message` — so it is asserted in both directions, the missing grant and the missing
policy, exactly as `034` §4 asserts its missing UPDATE.

`anon` gets nothing anywhere. Note the reading trap `034` records: `information_schema.role_table_grants`
returns **2** for the content tables because INSERT is a *column* grant and does not appear there —
reading 2 and concluding inserts are broken is the wrong conclusion. And scope every grant assertion
to its grantee or use `has_table_privilege`: an unscoped DELETE-grant count reads 2 against a correct
database, `postgres` and `service_role` holding everything by Supabase default.

`club_messages.id` stays client-suppliable, per `034`: an interrupted send retried with the same id
lands as `23505`, which the action reads as success rather than double-posting. It discloses nothing
— RLS evaluates WITH CHECK before the index insert, so a non-member is refused `42501` and never
reaches `23505`.

### Text bounds — `~ '\S'`, never `btrim`

Both CHECKs use `body ~ '\S' and length(body) <= N`. **Not** `length(btrim(body)) >= 1`:
`btrim` with no second argument strips **spaces only**, so `btrim(E'\n\n')` is length 2 and the
constraint accepts a body of newlines while the Zod schema's `.trim()` refuses it — the client
stricter than the database, which is the exact inversion `CLAUDE.md`'s "no new integrity rule may
live only in a Zod schema" exists to prevent. `034` measured this on Postgres 16; `011` and
`postcard_comments` carry the `btrim` form and therefore the gap, inherited knowingly and not fixed
here.

Bounds: `title` ≤ **80**, `body` ≤ **1000**. The body matches `ride_messages` for `034`'s stated
reason (a chat holds far more rows than a comment thread, so its per-row bound should be *tighter*
than a comment's, not looser). 80 for a title is a line on a 390px frame at `Poppins/16/Semibold`;
and it is `rides_title_length`'s bound from `018` rather than a judgement — the `Questions Closed` section, D5.

Ceilings are on the **raw** length so padding cannot smuggle a longer value past a trimmed check.

### Realtime — the second stream

`club_messages` joins `supabase_realtime` **in `081`**. `club_discussions` does not, stated in the
file: a thread appearing live is not required, and the list revalidates by key. `supabase/tests/harness.sql`
already creates an empty publication of that name for the suite, so both the membership and the
non-membership are assertable on plain Postgres.

Channel name: `club-discussion:${discussionId}:messages` — kind **and** id, per the new
`realtime-subscriptions` requirement. `ride:${rideId}:messages` was unambiguous with one stream in
the app; it is not a namespace with two.

Default replica identity (no `full`): there is no UPDATE on the table and the subscriber reads
INSERT.

**The one thing the RLS suite cannot assert** is that Realtime applies the SELECT policy per
subscriber. It must be confirmed by observation against DEV — two accounts, a block between them, a
shared thread — per `.claude/agents/realtime.md`, which requires confirming a blocked rider receives
silence rather than inferring it from the policy.

### Components — generalise, do not copy

There is **no v2 frame for a club Discussions screen**. `npm run figma -- ls` returns the club set
(`Private club - Timeline / Rides / Members / About / Sub Pages`, `2043:10604` / `2059:6390` /
`2059:6545` / `2059:6700` / `2059:5931`, plus the public-club frames) and nothing matching
`discuss|thread|topic`. The composition below is **ours**, assembled from measured components.

Two frames are the measured sources: **`Ride - Chat` (`2226:4999`)** for the thread, and
**`Inbox - Chats` (`2375:9518`)** for the list — the latter is the DM inbox, which PD-100 removed
the tab for and which is unbuilt. Reading its row geometry is fine; **building the Inbox is not
this change**, and restoring the nav tab is explicitly `realtime`'s call, not a side effect here.

Move and rename, with the ride screens importing from the new home:

| From | To |
|---|---|
| `src/components/rides/RideChatThread.tsx` | `src/components/chat/ChatThread.tsx` |
| `src/components/rides/RideChatRow.tsx` | `src/components/chat/ChatRow.tsx` |
| `src/components/rides/RideChatComposer.tsx` | `src/components/chat/ChatComposer.tsx` |
| `src/components/rides/MarkRideChatSeen.tsx` | `src/components/chat/MarkChatSeen.tsx` |
| `formatRideMessageDay` in `src/lib/utils.ts` | `formatChatMessageDay` |

Copying instead is how a repo gets two chat renderers that drift — the same argument `lib/data/`
rests on. The cost is a diff into shipped code; the coverage is that `npm run walk` renders the ride
chat, so a regression there is caught by the one gate that renders anything.

`formatRideTime(created_at, null)` stays as the message clock — a club discussion has no timezone at
all, so `null` is the honest argument, and `CLAUDE.md` forbids adding a generic formatter.

New components: `ClubDiscussionsSection` (the club detail section, shaped like Members — header,
rows, `See all`), `ClubDiscussionRow` (title, author username, `formatRelativeTime`, unread dot),
`ClubDiscussionsList`, `CreateDiscussionForm`. Icons from `@/components/icons/generated`;
`Element / Icon / Chat Bubble` exists. Primary button is near-black `Grey/100 #1A1A1A`, not green.

### Routes and cache keys

```
/clubs/detail/discussions?id=<club id>            the list
/clubs/detail/discussion?id=<discussion id>       the thread
/clubs/detail/discussions/new?id=<club id>        create
```

Both `id` params are `DETAIL_ID_PARAM`; the segment says which entity it names, matching
`/rides/detail/chat?id=`.

```
clubs.discussions(clubId)          ['clubs','detail',clubId,'discussions']
clubs.discussionsUnread(clubId)    ['clubs','detail',clubId,'discussions','unread']
clubs.discussionMessages(discId)   ['clubs','discussions',discId,'messages']
```

The third **is not under `['clubs','detail',clubId]`**, because the thread screen holds only the
discussion id. So `clubs.all()` reaches the first two and not the third, and `sendClubMessage` must
name it explicitly. `deleteClubDiscussion` must name both, carrying the club id in the action rather
than re-reading it after the row is gone. This is the first key in `keys.ts` its domain prefix does
not reach; the header table has to say so.

The unread key nests under the list key so invalidating the list reaches the mark and not the
reverse — `rides.unread` under `rides.messages`, exactly.

### Notifications — out of scope, with the two traps recorded

Deferred to its own proposal against `event-fanout-integrity`. Two things that will bite whoever
picks it up:

1. **`private.is_club_member` is caller-relative** — it resolves `auth.uid()` — and `036` trap (c)
   is that such a helper must never compute a fan-out recipient set. `private.is_club_member_for`
   (`060`) is the subject-taking one.
2. **`event-fanout-integrity` requires a fan-out to be bounded and not assumed small.** A club-wide
   notification on every message points that requirement straight at a chat. The Welcome club
   contains every onboarded rider.

### What account deletion does, read from `private.transfer_owned_clubs` rather than summarised

Two corrections to how this was described in an earlier draft, both read off the live function body:

- **The successor is not "the longest-tenured remaining member".** The order is
  `case role when 'admin' then 0 when 'member' then 1 else 2 end, joined_at, user_id` — so an
  **admin outranks an earlier-joined member**, and `joined_at` only breaks ties within a role. That
  matters here because the successor inherits `moderate_club_discussion` over every surviving
  thread.
- **There is a no-successor branch and it deletes the club outright**, cascading every thread and
  message in it. Unlike `delete_owned_club`, it does **not** check `clubs.is_default` — so the last
  remaining rider deleting their account takes the Welcome club and its "Say hello" thread with it,
  permanently, and `058`'s auto-join then points at nothing for every future rider. That is a
  pre-existing gap in `029`/`059` rather than one this change introduces, and this change makes it
  *more* costly by putting content in that club. It is recorded here and in the spec, covered by an
  assertion, and **not fixed** — closing it is a change to `transfer_owned_clubs`, which is
  `delete-account`'s territory.

## Risks / Trade-offs

**A builder transfers `034`'s conclusion instead of its reasoning and drops the membership helper**
→ every public club's threads become readable by every signed-in rider, silently, with green tests.
Mitigated by: the correction section in `proposal.md`, the inverted-direction scenarios in the
`database-enforced-integrity` delta, and an RLS assertion that a **non-member of a public club**
reads zero threads — which is the one case a policy carrying only the `EXISTS` fails.

**Deleting a thread author's account deletes other riders' messages** → this is the one genuinely
new deletion semantic in the change (see `specs/club-discussions/spec.md`). Mitigated by: stating
it, and recording the `SET NULL` + tombstone alternative as declined in the `Questions Closed` section, D1, not deferred.

**A builder re-adds a DELETE grant on `club_messages` because its absence looks like an oversight**
→ the erasure path silently reverts to one a block can disable. Mitigated by: asserting the absence
in both directions (no grant, no policy), and by the table comment saying deletion is
`delete_own_club_message` and why.

**A blocked pair holding a conversation neither can see** → reads as a bug and is a design. Mitigated
by: an explicit scenario, and by refusing the alternative (blocking the insert) which would disclose
the block to the poster.

**The watermark table's row count is bounded more weakly than `feed_reads` or `ride_reads`** →
those are bounded by *membership*; this is bounded by *threads opened*, so a club with 500 threads
and 200 members admits up to 100k rows. Acceptable and named rather than discovered. Mitigated by:
nothing, deliberately — the alternative (one watermark per club) makes reading thread A mark thread
B read, which is the failure the thread model exists to avoid.

**The two definer RPCs raise the advisor count by two** → a fourteenth and fifteenth WARN look like
a regression to a session checking the documented thirteen. Mitigated by: a task updating
`CLAUDE.md`'s advisor table in the same PR, and by `078`'s recorded lesson — quoted in `CLAUDE.md`
itself — that this advisor fires once per function, so a sweep adding two adds two.

**Generalising the chat components touches shipped ride screens** → a rename across four components
and one formatter. Mitigated by: `npm run walk` renders the ride chat; `npm run docs:check` and
`crossrefs.test.mjs` catch a moved section pointer or a stale claim naming `formatRideMessageDay`.

**Two agents on this change collide on one test database and two fixed ports** → `run.sh` opens with
`drop database if exists` and each step is its own `psql`, so a concurrent run dies mid-chain.
Mitigated by: `TEST_DB=`, `RELAY_PORT=`, `WALK_BASE=` per agent, or serialising the verification step.

## Migration Plan

**One file, `081_club_discussions.sql`.** Nothing in it is destructive, so it does not need
`069`/`070`'s additive-before / destructive-after split; it is additive and goes to PROD **before**
the promotion build serves. It hangs no trigger on an already-shipped write path — both gate
triggers land on brand-new tables — so `036`'s hand-exercise-on-DEV gate does not fire. Both checked,
not assumed.

Order inside the file: tables → indexes → RLS enable → policies → grants (table, then per-column
INSERT) → the three triggers → the two functions → publication → the `enforce_participation_gate()`
comment restamp → the verification block.

1. Re-derive the number. `list_migrations` on both projects against `ls supabase/migrations/`;
   promote anything the gap already contains, in filename order, before adding to it.
2. Write the file. It is well under the 61 KB that forced `036`'s reduction technique, so
   `apply_migration` takes it as a string unreduced.
3. Apply to DEV. Then run the verification block in the file's footer — policy count and roles,
   `anon` grant count 0, the enumerated INSERT columns, `has_table_privilege` scoped to
   `authenticated`, publication membership **and** non-membership, `prosecdef` false on the reader
   and true on the moderator, the gate trigger count reading **13**, and `get_advisors(security)`
   reading **15** with `auth_leaked_password_protection` still the only genuinely outstanding one.
4. `PGPASSWORD=postgres npm test` — the suite must be green and its **label set** compared against
   the pre-change run, not its count: a count cannot tell a rename from a loss, which is what `038`
   did to one of `036`'s assertions.
5. Ship the code. Merge to `development`; Vercel builds the Preview against `letsride-dev`.
6. PROD gets `081` at the next promotion, **before** the build serves.

**Rollback.** Additive and self-contained: `drop table public.club_discussion_reads, public.club_messages, public.club_discussions cascade;`
plus `drop function public.club_discussion_unread(uuid), public.moderate_club_discussion(uuid), public.stamp_club_discussion_read();`
and restoring the `enforce_participation_gate()` comment. Nothing else in the schema references
these, and the publication membership goes with the table. Written as a **new** migration if it is
ever needed — migrations are append-only.

## Questions Closed

**All five questions this design opened with are answered. Nothing here is open**, and none of them
should be read as awaiting a reply. Each was decided by **this session, on the recommended
default**, on 2026-08-27, and each is recorded with the reasoning that made the default the
recommendation rather than merely the cheapest option.

**D1 — a thread author's account deletion cascades the thread and every reply in it.** `ON DELETE
CASCADE` on `club_discussions.author_id`. It is the only answer consistent with every other authored
row in this schema, it needs no tombstone machinery, and it is the reading of GDPR erasure this repo
has already taken everywhere. The cost is real and stays stated rather than softened: deleting one
rider can remove a conversation forty others took part in, which is **wider than `ride_messages`**,
where only the leaver's own messages go. The alternative — `ON DELETE SET NULL`, a nullable author,
a "deleted rider" byline and a surviving thread — was declined, not deferred.

**D2 — a blocked rider's thread is hidden whole, conversation included.** The block arm sits on
`club_discussions.author_id`, so hiding the thread hides messages from riders the viewer has not
blocked. That is decision #2 read literally — *"disappears from feeds, search, chat, member lists
and ride crews simultaneously"* — and the alternative (render the thread, suppress the byline) is a
second visibility rule to keep in step and leaks that a hidden rider exists. **This is what makes
§Deleting a message necessary**, and the two were decided together rather than one falling out of
the other.

**D3 — the thread list sorts by creation, newest first.** Sorting by most recent activity needs
either a stored `last_message_at`, which is a copy of a visibility decision and would bump a thread
for the very rider who blocked its latest author, or a per-viewer aggregate over `club_messages` for
every row. The `security invoker` shape that does it correctly later is named in §Ordering. **The
cost is the Welcome club's greeting sinking down the list** — see §Ordering, where that is called out
as a loss the owner is accepting rather than a wash.

**D4 — a new discussion does not badge the club card on `/clubs`.** `club_unread_counts()` is
untouched. Widening it mixes a count (postcards + rides) with a boolean (threads) on a shipped
counter already carrying a divergence `079` fixed on one arm only. The unread mark lives on the
Discussions section and in the thread list, and nowhere else.

**D5 — a thread title is bounded at 80 characters, and it has a precedent after all.**
`018_text_bounds.sql` sets `rides_title_length` at exactly 80, so this is the repo's existing bound
for a rider-authored title rather than a number measured off a frame. **The floor is not copied**:
`018` uses `length(btrim(title)) >= 1`, and `btrim` with no second argument strips spaces only, so
that form accepts a title of newlines while the Zod schema's `.trim()` refuses it — the client
stricter than the database. This change uses `title ~ '\S'`, per §Text bounds. Taking the ceiling
from `018` and refusing its floor is deliberate and is the whole reason to cite the file rather than
just the number.
