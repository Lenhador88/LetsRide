# Ride chat is retired and a ride gets threads instead

## Why

**Two conversation models for one app is the thing to remove, and the club's is the one that got
the second pass.** `ride_messages` (`034`) is a single unbounded stream per ride with no title, no
way to find anything in it later, no moderation RPC and no timeline presence. `club_threads` /
`club_messages` (`081`, `082`) is the same conversation with a title, a moderation path (`094`), a
reply notification (`098`) and a row on the club's timeline. PD-402 swaps the ride onto the second
model and deletes the first.

Product owner, 2026-09-05: *"Ride chat stops existing, now we also have threads. We are not live
yet, so all ride chats can be dropped."* **The data call is the owner's and is recorded as made.**

### Three of the issue's premises are false, measured rather than reasoned about

Each was measured on DEV (`fpmrimzxadewsaiwpsel`) and PROD (`zwprydcyryvudhurbnye`) on 2026-09-06.
They matter because two of them remove work the issue asks for, and the third changes which
migration number this change takes.

**1. There is no `ride_message` notification kind. Nothing needs retiring, and the `101` question
does not arise.** The issue says *"`036` writes a notification on a ride message and `060`
narrowed its recipients … Both need the kind retired, not merely orphaned"*, and asks whether
`ride_message` gets `101`'s treatment. It does not exist:

| Measured | Result |
|---|---|
| Arms of the live `notifications_type_check` | **16**, and `ride_message` is not one |
| Triggers on `ride_messages` | **one** — `enforce_participation_gate`. No fan-out |
| `notifications` rows of type `ride_message`, DEV / PROD | 0 / 0 (the type is not legal) |
| `grep -rn "notify_ride_message\|'ride_message'" supabase/ src/` | **0 hits** |

`036` and `060` mention `ride_messages` only in **comments**, as the precedent their own reasoning
copies — `036` line 389 and 865, `060` line 73. This is CLAUDE.md §Technology Decisions' comment
trap exactly: a grep for the retired thing counted its obituaries. The two fan-outs `060` actually
rewrites are `notify_ride_joined` and `notify_ride_created_in_club`, and **neither is touched by
this change**. So there is no enum arm to keep or drop, no `notifications_subject_shape` edit, and
no `101` precedent call to make. That is roughly a third of the migration the issue describes,
gone.

**2. The migration state in the issue body is stale in a way that matters.** The body says *"DEV is
at `104`, PROD at `100`"*. Measured: the repo has **106** files, PROD is at **100**, and DEV has
applied **107** — `a_club_may_outlive_its_last_member`, at `20260905203011`, which is slot-1's
declared `107_a_club_may_outlive_its_last_member.sql`. **That file does not exist on
`development`.** So `107` is taken on the database by a file the repo does not have, and this
change must not claim it. See `tasks.md` T0.

**3. Nothing in `design/` draws a ride thread, and nothing draws a club thread either.** The
snapshot holds `Ride - Chat`, `Ride - Chat - Options`, `Ride - Chat - Text focus` — the screens
being deleted — and `Inbox - Chats*`, whose tab PD-100 removed. `npm run figma -- ls` returns **no
frame** for a club thread, thread list or thread composer. The club's thread screens were built
without a v2 frame and this change copies **the shipped club implementation**, not a design. That
is a fact the build must not rediscover by hunting for a frame that is not there.

## What Changes

### Schema — two migration files, and the split is load-bearing

**Migration A (additive), applied BEFORE the client deploys.** Creates `public.ride_threads`,
`public.ride_thread_messages` and `public.ride_thread_reads`, their policies, per-column INSERT
grants, `enforce_participation_gate` triggers, the read-watermark trigger, the unread accessor,
`public.delete_own_ride_thread_message(uuid)`, `public.moderate_ride_thread(uuid)`, and
`alter publication supabase_realtime add table public.ride_thread_messages`. It touches **no
existing policy, grant, CHECK, trigger or column**, and creates no object any shipped bundle can
observe.

**Migration B (destructive), applied only AFTER the new client is confirmed *serving* on DEV.**
Drops `public.ride_messages` and `public.ride_reads`, and with them
`public.stamp_ride_read()` and `public.ride_has_unread(uuid)`. `drop table` removes
`ride_messages` from `supabase_realtime` on its own; no separate `alter publication` is needed and
issuing one first is harmless but redundant.

**They cannot be one file.** The publication entry and the new tables must exist before the new
bundle subscribes and reads (`realtime-subscriptions`: *"A table SHALL be in the publication before
anything subscribes to it"*), and `ride_messages` must survive until no bundle reads it. One file
cannot be both before and after the deploy. This is `CLAUDE.md` §Supabase Rules' sequencing rule
with the two halves pulling in opposite directions, which is precisely why they get one file each.

### Naming — the new message table is `ride_thread_messages`, not `ride_messages`

Asymmetric with the club (`club_threads` / `club_messages`) **on purpose, and the split above
forces it**: migration A must create the new table while `ride_messages` still exists, so the name
is unavailable. Reusing it later would also be worse than leaving it dropped — an old bundle
hitting a same-named table with a different column set gets malformed rows rather than a clean
`PGRST205`. `design.md` D2 carries the full argument. **The name `ride_messages` is retired
permanently and SHALL NOT be reused.**

### What the ride gets on day one, feature by feature

The issue asks for this decision to be made here rather than in the build. The club shipped
threads in `081`/`082` and moderation, reports and notifications weeks later in `094` and `098`;
this follows that precedent except where following it would be a **regression** against the chat
being deleted.

| Club feature | Ride, day one | Why |
|---|---|---|
| Threads with titles, messages, per-thread read watermark | **Yes** | the change |
| Realtime on messages | **Yes** | `ride_messages` had it; dropping it is a regression |
| Author deletes their own message (`delete_own_club_message` shape) | **Yes** | `034` gave the author a DELETE policy; an RPC is the only shape that works — see below |
| Organizer removes a thread (`moderate_club_thread` shape) | **Yes** | `034` let the organizer delete any message on their ride. Not shipping it removes a right |
| A thread row on the ride timeline | **Yes** | the half a chat never had, and the issue's stated point |
| Reply notification (`098`) | **No — follow-up** | the chat produced none, so it is not a regression; `098` is an 800-line migration with a retraction, an event-key rebuild and two CHECK rewrites. Q3 |
| Thread reports + reader queue (`094` §2) | **No — follow-up** | as above, and the club waited. Q4 names the App Store trigger that raises it |
| Waves on a thread | **No** | `101` retired the club's. Not built into a second domain |

### Deletion is an RPC, not a DELETE policy — and this closes a recorded gap

`082`'s ruling, adopted whole: `ride_thread_messages` gets **no DELETE policy and no DELETE
grant**, and deletion goes through `security definer` RPCs. RLS filters a DELETE by what the caller
may READ, so a policy-based delete silently affects zero rows whenever the row is invisible to its
own author.

This is not theoretical here. `docs/HANDOFF.md` §Your own row survives the parent going out of view
records `ride_messages` as carrying a **residual silent `DELETE 0`** that `102` deliberately left
open — *"a rider who leaves the crew of a ride they can still see … comes from the `is_ride_crew`
conjunct rather than the block conjunct, and hoisting past `is_ride_crew` would break the
documented invariant that this table's audience is an INTERSECTION."* Building the replacement with
`082`'s RPC shape **closes that gap** rather than porting it, because a definer function is not
subject to the SELECT policy at all.

### Client

- **Deleted:** `/rides/detail/chat`, `RideChatRow`, `RideChatButton`, `useRideMessageStream`,
  `lib/data/ride-messages.ts`, `lib/actions/ride-messages.ts`, `rideMessageBodySchema`,
  `routes.rideChat` / `detailPaths.rideChat`, the `RideChatMessage` / `RideMessage` types, and the
  ride-chat entries in `Navbar` and `RideHeader`.
- **Added:** `/rides/detail/threads`, `/rides/detail/thread`, `/rides/detail/threads/new` — the
  club's three routes one domain over — plus `RideThreadRow`, `RideTimelineThreadRow`,
  `CreateRideThreadForm`, `RideThreadOptions`, `lib/data/ride-threads.ts`,
  `lib/actions/ride-threads.ts`, a `thread` and a `reply` arm on `RideTimelineEvent`, and keys under
  `rides.threads(rideId)`.
- **Shared and NOT deleted:** `src/components/chat/ChatThread.tsx`, `ChatComposer.tsx`,
  `MarkChatSeen.tsx` and `src/lib/data/chat.ts` (`groupMessages`, `decorateChat`). All four are
  imported by `src/app/(app)/clubs/detail/thread/page.tsx` as well — verified on this branch — and
  the ride's new thread screen imports them too. Deleting them with the chat breaks club threads.
- **`resolveRideDetailActions` gains the sheet PD-401 deliberately did not pre-build.** Its
  `bottomSlot: 'create'` now opens a two-entry sheet — a postcard tagged to the ride, and a thread
  — instead of linking straight to the composer, and the timeline heading's `(+)` fallback opens
  the same sheet. See `design.md` D9 for what happens to its exhaustive test.

### The ride timeline gains a thread source, and the no-paging argument survives — conditionally

`src/lib/data/ride-timeline.ts` argues it does not page because *"a ride is a bounded event with
two sources"*. A conversation is the first source on a ride with **no natural ceiling** — the
standing `ride-chat` spec says so in as many words. The argument survives **if and only if** the
thread sources are bounded by thread count rather than message count: thread creations are one row
per thread, and the replies source collapses its window to one row per thread the way
`getClubThreadReplies` does. That is stated as a requirement rather than left to the build.

`mergeRideTimeline` does **not** inherit the club's completeness bug: `docs/HANDOFF.md` records
that `mergeClubTimeline` derives completeness from *"the horizon filter dropped nothing"* and is
reachable-wrong precisely through `getClubThreadReplies`, while `mergeRideTimeline` uses the
stronger *"no source declared a horizon"*. Adding the analogous source to the ride is therefore
safe, and this is the reason — not luck.

## What Does NOT Change

- **`private.is_ride_crew` is untouched.** Same function, same signature, same grant. `041`
  (postcard ride tags) and `051` (map tiles) call it and must keep working.
- **No existing policy, on any table, is modified.** Not `rides`, not `ride_members`, not
  `ride_invites`, not `notifications`. Migration A is purely additive and migration B only drops.
- **`083`'s fourth arm is not touched.** A live ride invite still makes a ride readable; what it
  does *not* do is make the holder crew. See the negative cases.
- **The nav stays at four tabs**, and no Inbox returns.
- **`notifications`, its CHECKs, its policies and its fan-outs are untouched** — see premise 1.
- **`club_threads`, `club_messages`, `club_thread_reads` and every club RPC are untouched.**
- **No `anon` grant is added.** Decision #1.
- **Blocking stays in RLS.** No screen, data function or action filters by block.

## Impact

- **Security advisors: +2 per project, DEV 39 → 41.** Derived from the catalog rather than assumed:
  `public.delete_own_club_message` and `public.moderate_club_thread` are both `prosecdef = true`
  with `authenticated` EXECUTE, so their ride analogues produce one
  `authenticated_security_definer_function_executable` WARN each. The unread accessor produces
  **none**, because `public.club_thread_unread` is `prosecdef = false` and its ride analogue must be
  too. Migration B removes **none**: `public.ride_has_unread` is `prosecdef = false` and
  `public.stamp_ride_read` holds no `authenticated` EXECUTE. Everything in `private` adds nothing.
  If Q2 defers moderation, it is +1 rather than +2.
- **Data destroyed, counted rather than estimated (2026-09-06):**

  | Table | DEV | PROD |
  |---|---|---|
  | `ride_messages` | **7** rows across 6 rides | **0** |
  | `ride_reads` | **14** | **0** |
  | `notifications` type `ride_message` | 0 (illegal type) | 0 |

  **Nothing is archived and nothing needs to be.** PROD holds zero ride messages, so the owner's
  data call costs seven fixture rows on DEV written by test riders. The `drop table` cascade is the
  whole disposition. See `design.md` D10 for why an archive would be worse than useless.
- **Ordering, and it breaks in one direction.** Migration A → deploy → **confirm serving** →
  migration B. "Confirmed serving" is `READY` on the merge sha with `aliasError` null, **not** the
  merge. This repo applied a destructive file 102 seconds after a merge, out from under a Preview
  still calling the function it dropped. `tasks.md` makes the confirmation its own numbered task
  with its own command, so the two cannot collapse.
- **PostgREST relationship count — checked, not assumed.** `ride_threads` carries `ride_id →
  rides` and `author_id → profiles`, making it a **junction between `rides` and `profiles`** and
  therefore a `092`-class HTTP 300 risk for any unhinted embed between that pair. Measured: every
  `profiles` embed in `src/lib/data/` names its foreign key, and
  `src/lib/data/__tests__/embed-hints.test.ts` refuses an unhinted one. `ride_members` and
  `ride_invites` are already junctions on the same pair, so the ambiguity this would introduce is
  already present and already handled. `tasks.md` T2 re-measures it before migration A applies
  rather than trusting this paragraph.
- **Migration numbers are named relative to the chain at build start, never hardcoded** — see
  `tasks.md` T0 and premise 2 above.
- **RLS suite grows.** Every negative case in `specs/ride-threads/spec.md` maps onto an assertion in
  `supabase/tests/rls_test.sql`, and every assertion naming `ride_messages` or `ride_reads` is
  deleted with migration B.

## Open Questions

Every one has a recommended default so the build is never blocked on an answer. Each names who can
answer it.

**Q1 — A rider who accepted an invite to a private club's ride, and is not in that club, opens the
ride and taps Threads. What do they see? (BLOCKING, product owner.)**
*Default, and what the spec below is written to:* **the ride's threads, in full, and no part of the
club.** They hold a `ride_members` row, so `private.is_ride_crew` is true, and `083`'s fourth arm
makes the ride readable — the intersection admits them. A ride thread carries a `ride_id` and no
club data, so nothing about the club leaks. The alternative — intersecting with club membership too
— would mean the organizer invites someone to a ride and then cannot talk to them on it, which is
the invite feature contradicting itself. Confirm rather than assume, because it is the one place
this change lets a non-member read text written inside a private club's orbit.

**Q2 — A ride's organizer opens a thread on their own ride that has gone bad, and taps the ⋯ menu.
Is there a Remove entry? (Non-blocking, mine unless overruled.)**
*Default:* **yes** — `public.moderate_ride_thread(uuid)`, `094`'s `moderate_club_thread` shape with
the club-admin arm replaced by `rides.organizer_id`. Not shipping it takes away a right `034`
already granted (the organizer's DELETE policy over every message on their ride), and a ride has no
admin role, so the organizer is the only candidate. Answering *no* is a deliberate reduction and
should be said out loud.

**Q3 — A rider replies in a ride thread someone else started. Does the thread's author get a
notification? (Non-blocking, product owner.)**
*Default:* **no, deferred to a follow-up story.** The chat it replaces produced no notification, so
this is not a regression, and `098` is the largest fan-out migration in the repo. The follow-up is
cheap and already scoped: `private.can_read_ride` (`083` §3b) is the *"recipient set computed by
direct query"* half that `event-fanout-integrity` requires, and it already exists.

**Q4 — A rider reads something abusive in a ride thread and looks for a way to report it. What do
they find? (Non-blocking, product owner.)**
*Default:* **nothing, this pass** — they can leave the crew, and they can block the author, which
RLS already applies to the thread. `094` §2's `club_thread_reports` + `076` reader is the follow-up.
**Named as the owner's because of its trigger, not its size:** App Store Review Guideline 1.2 wants
a report path on user-generated content, and this change *adds a new UGC surface*. The trigger that
flips this to blocking is the store submission, not a rider count.

**Q5 — A rider opens a ride that finished last month and taps Threads. Can they read it, and can
they post? (Non-blocking, mine unless overruled.)**
*Default:* **read yes, post yes** — a past ride behaves exactly like a current one, because nothing
in the schema distinguishes them and `rides` has no `is_upcoming` column to gate on. `034` made the
same call by omission; this states it. The place riders talk after a ride is the same thread they
used before it, and the postcard flow PD-401 built is explicitly aimed at past rides.

**Q6 — What is the retention window on a ride thread? (Non-blocking, product owner.)**
*Default:* **none, stated rather than omitted** — messages live as long as their ride, nothing
deletes a past ride, so retention is indefinite. Carried forward verbatim from the standing
`ride-chat` requirement, which called this an open question owned by the product owner. It stops
being tolerable the day background location tracking lands.
