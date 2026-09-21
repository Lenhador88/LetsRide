# Design — retire ride chat for ride threads

Everything measured here was measured on 2026-09-06 against DEV (`fpmrimzxadewsaiwpsel`) and PROD
(`zwprydcyryvudhurbnye`), or against `origin/development` at `6ffa5dd`. Where a number is inferred
rather than measured it says so.

## D1 — Why the audience swap is a swap and not a new rule

`034` built `ride_messages` by taking `club_messages`' shape and **replacing** the club-membership
predicate with `private.is_ride_crew`, then discovering — after a leak — that the parent `EXISTS`
had to stay. `081` built `club_threads` on the club-membership predicate with the parent `EXISTS`
intact from the start, because `clubs` carries no block predicate and the trap does not exist there.

This change runs `034`'s swap **backwards**: it takes `081`/`082`'s thread shape and substitutes
`private.is_ride_crew` ∩ ride visibility for `private.is_club_member` ∩ club visibility. That means
the trap comes back, and it comes back at **two** tables instead of one, because the thread model has
a grandchild.

**The single most likely way this change ships a leak** is a build that copies `082`'s
`club_messages` policy and swaps the helper — arriving at `is_ride_crew(...)` with no `EXISTS`
against `rides`, which is `034`'s first draft exactly. `034`'s header calls the reasoning
*"seductive"* and the failure *"silent"*. The spec asserts the two conjuncts in isolation for
precisely this reason: a single combined assertion cannot say which one did the work.

## D2 — The new message table is `ride_thread_messages`, and the name `ride_messages` is retired

Three arguments, in descending order of force.

1. **The split forces it.** Migration A must create the new tables while `ride_messages` still
   exists (it is dropped in migration B, after the deploy). Two tables cannot share a name.
   Collapsing to one file to free the name would defeat the sequencing this whole change is built
   around.
2. **Reuse fails worse than absence.** An old bundle reading a dropped `ride_messages` gets
   `PGRST205` — a clean, loud, diagnosable "relation does not exist". An old bundle reading a
   *recreated* `ride_messages` with a `thread_id` where it expects a `ride_id` gets rows it
   half-understands, filtered by a policy it does not know about. Absence is the better failure.
3. **A later reader should not have to date the name.** `git log` on a reused table name mixes two
   different tables' history under one identifier, and `docs/reference/schema.md`'s per-table
   contract would need to say which era it describes.

The cost is a naming asymmetry with the club (`club_threads` / `club_messages` vs `ride_threads` /
`ride_thread_messages`). Accepted and stated, rather than resolved by renaming the club's tables —
that would be a second destructive change to a shipped surface for a cosmetic gain.

## D3 — Why the notification kind is not in scope, in one place

`proposal.md` premise 1 has the measurements. The short form for anyone arriving from the issue
body: **there is no `ride_message` notification type.** `036` and `060` mention `ride_messages` only
in comments, as the precedent their own reasoning copies. `notifications_type_check` has sixteen
arms and that is not one of them. The only trigger on `ride_messages` is
`enforce_participation_gate`.

So the question the issue poses — *"decide, and say why, whether `ride_message` gets the same
treatment"* as `101`'s `club_thread_waved` arm — **has no subject**. `101`'s decision was about
whether to narrow a CHECK constraint and delete real notification rows; here the constraint does not
carry the arm and there are no rows (0 on DEV, 0 on PROD, and the type is not legal so there could
not be). Migration B touches `notifications` not at all.

This is CLAUDE.md §Technology Decisions' comment trap in its purest form: a grep for the retired
thing counted its obituaries. Recorded here rather than in a correction paragraph elsewhere, because
a careful reader running the issue's own suggested grep gets a plausible wrong answer — the grep
returns `036` and `060` — and would re-derive the wrong version from the same evidence.

## D4 — Who moderates a ride thread, when a ride has no admin role

`094` gives `moderate_club_thread(thread)` to a club's owner and admins. A ride has an organizer and
nothing else: `ride_members.status` admits `going` and `maybe` only, there is no role column, and
PD-351 records that nothing can even remove a rider from a ride.

Three candidates were considered:

- **The organizer alone.** Taken. `034` already granted the organizer a DELETE policy over *every*
  message on their ride, so anything less is a reduction. It is also the only role that exists.
- **The organizer plus the club's admins, when the ride belongs to a club.** Rejected. It makes the
  moderation authority depend on a relationship the thread does not carry, and it would mean a club
  admin can remove a thread on a ride they are not on and cannot read — which they cannot even
  enumerate to act on. It also fails the private-club-invitee case in reverse: a rider invited to the
  ride would be moderated by someone with no connection to them.
- **Nobody, first pass.** Rejected as a regression, per the first bullet.

The organizer's arm is `rides.organizer_id`, read inside the definer function, and **not**
`private.is_ride_crew` — crew is who may talk, organizer is who may remove. Keeping them distinct is
what stops a future edit from widening moderation to the whole crew by pattern-matching on the read
policy.

## D5 — Deletion as an RPC, and the gap it closes

The full argument is in `specs/database-enforced-integrity/spec.md`. What matters for the build:

`docs/reference/journal.md` §Your own row survives the parent going out of view records, in the list of things
`102` deliberately left alone, that **`ride_messages` has a residual silent `DELETE 0`** — a rider
who leaves the crew of a ride they can still see cannot delete their own message, and the statement
reports success. `102` could not fix it because the only policy-level fix (hoisting the own-row arm
above `is_ride_crew`) would break the intersection invariant.

Building the replacement with `082`'s shape — no DELETE policy, no DELETE grant, a `security
definer` RPC — closes it without touching the invariant, because the function is not subject to the
SELECT policy at all. **This is a defect fixed by the migration that replaces the table, at no extra
cost, and it should be called out in the PR body rather than absorbed silently.**

## D6 — Where the own-row arm goes, per policy, stated once

`102` (PD-362) found seven policies with the own-row branch written *inside* the block conjunct where
`blocks_no_self_block` makes it a no-op. Three were hoisted, four left alone, each for its own
reason — and a sweep would have got them wrong. For three brand-new tables the placement is decided
here rather than inherited:

| Policy | Own-row arm | Why |
|---|---|---|
| `ride_threads` SELECT | inside the block group, above `is_blocked` | you never lose sight of what you wrote to a block |
| `ride_threads` INSERT (WITH CHECK) | n/a — `author_id = auth.uid()` is the whole check | forging an author is the only thing to refuse |
| `ride_thread_messages` SELECT | inside the block group, above `is_blocked` | as the thread |
| `ride_thread_messages` INSERT | n/a | as the thread |
| both, DELETE | **no policy exists** | D5 — the RPC is the path |
| both, UPDATE | **no policy and no grant** | nothing is editable |
| `ride_thread_reads` all | `user_id = auth.uid()`, top level, no visibility conjunct | a watermark is a fact about the reader, not the content; `081`'s `club_thread_reads` shape |

**Neither SELECT arm is hoisted above `is_ride_crew` or above the `rides` EXISTS.** That is the
refusal `docs/HANDOFF.md` records for `ride_messages` and it holds here for the same reason. The
consequence — an ex-crew member cannot read back their own messages — is stated as a scenario rather
than left to be met in the field, and D5's RPC is what stops it from being a stranded row.

## D7 — What the ride invite arm does and does not buy

`083` added a **fourth** audience arm to `rides` SELECT: a live `ride_invites` row of status
`pending` or `accepted`, reached through `private.has_live_ride_invite`, sitting **inside** the
block-dominated group. Read from the migration and confirmed against the live policy.

The interaction with this capability is clean and worth writing down because it is not obvious:

| Rider | Reads the ride? | `is_ride_crew`? | Reads the threads? |
|---|---|---|---|
| Invite `pending` | **yes** (083 arm) | no — no `ride_members` row | **no** |
| Invite `accepted` | yes | **yes** — `join_ride_from_invite` writes the row | **yes** |
| Invite declined / withdrawn | no | no | no |
| Blocked either way | no — the arm sits inside the block group | irrelevant | no |

So the invite arm widens *ride* visibility and never *thread* visibility, and the transition point
is the `ride_members` row rather than the invite's status. That is the right seam: `083`'s own table
comment says `status` *"is the answer to the invitation and NEVER a copy of ride_members: nothing
keeps the two in step and nothing should"*. A thread policy reading `ride_invites.status` would be
building exactly the coupling that comment forbids.

The pending case gets its own assertion because it is the only situation in the app where a rider
provably reaches a ride's detail screen and must reach none of its conversation.

## D8 — What a threads source does to the ride timeline's no-paging argument

`src/lib/data/ride-timeline.ts` declines the club's window machinery on a stated argument: *"A ride
is a bounded event: it happens once, its crew is capped in practice by who turns up, and its journal
is the photos of one day. Both of its sources are read whole at bounds set here."*

A conversation breaks the premise. The standing `ride-chat` spec says so outright — *"A chat is the
only list in this app with no natural ceiling"* — and the club needed `CLUB_TIMELINE_REPLIES` and a
per-thread collapse to keep its own timeline sane.

**The argument survives, on one condition: both thread sources must be bounded by thread count, not
message count.** Thread creations are naturally one row each. Replies must collapse to one row per
thread, which is what `getClubThreadReplies` already does. Under that bound the ride gains at most
*2 × (number of threads)* rows, and a ride's thread count is bounded by the same human behaviour
that bounds its crew. Without it, one busy thread fills `RIDE_TIMELINE_LIMIT` and the ride's own
postcards and joins vanish under it with no signal.

**And the ride does not inherit the club's completeness bug.** `docs/HANDOFF.md` records that
`mergeClubTimeline` derives completeness from *"the horizon filter dropped nothing"* and is
reachable-wrong **precisely through `getClubThreadReplies`**, because that source collapses its
window and so returns fewer rows than the display cap. `mergeRideTimeline` uses the stronger *"no
source declared a horizon"*. Adding the analogous source to the ride is therefore safe — and it is
safe by construction rather than by luck, which is why the spec pins the derivation rather than
merely noting it.

Consequence for the build: **do not "align" `mergeRideTimeline` with `mergeClubTimeline` while
adding this source.** The two differ on purpose and the ride's is the correct one.

## D9 — `resolveRideDetailActions` and the sheet PD-401 deferred

PD-401 shipped `RideCreateBar` and `resolveRideDetailActions` with one action, and its own note says
*build the one-action version, do not pre-build the sheet* — because *"that is all a ride creates
until PD-402 lands"*. This is PD-402.

**What changes.** `bottomSlot: 'create'` and the timeline heading's `(+)` both stop linking to
`routes.newPostcardInRide` and start opening a sheet with two entries: a postcard tagged to the
ride, and a new thread. The invariant PD-401 protected — *"a crew member is offered exactly one
entrance … never two and never none"* — is unchanged and still resolved in one function.

**What happens to the exhaustive test.** Today the function takes two booleans, so the table is four
rows. Two options were considered:

- **Add a third boolean `canStartThread`.** Rejected *for now*: both entrances require
  `private.is_ride_crew` today — `041` for the postcard tag, this capability for the thread — so a
  third boolean would always equal the second, and the four new rows of the table would be
  unreachable states. Inventing a distinction the domain does not have is how a case table stops
  being read.
- **Return the sheet's contents from the same function.** Taken. `RideDetailActions` gains
  `createOptions: RideCreateOption[]` where `RideCreateOption` is `'postcard' | 'thread'`, so the
  test still enumerates four input rows but now asserts three fields each, and the empty-options
  case is pinned as a state that cannot occur alongside `bottomSlot: 'create'`.

**Written down so it is not rediscovered:** the day the two predicates can differ — a ride-level
"threads off" setting, or a postcard tag rule that stops being `is_ride_crew` — `canCreate` splits
into two booleans and the table doubles to eight. The spec carries that sentence as a scenario.

## D10 — Data disposition: seven rows, and why an archive would be worse than useless

Measured, not estimated:

| | DEV | PROD |
|---|---|---|
| `ride_messages` | 7 rows, across 6 distinct rides | **0** |
| `ride_reads` | 14 | **0** |
| `notifications` type `ride_message` | 0 (type is not legal) | 0 |

**PROD holds no ride chat at all.** The owner's *"all ride chats can be dropped"* therefore costs
seven message rows on DEV, written by test riders during the walk and by fixtures. There is no rider
data on the production project to lose, which is the strongest possible form of the owner's *"we are
not live yet"*.

**Nothing is archived.** Three reasons: the PROD count is zero so there is nothing to preserve; the
DEV rows are fixtures whose content is walk chatter; and an archive table would itself need RLS
policies, a retention window and a place in `docs/reference/schema.md` — a permanent surface created
to hold seven rows nobody will read. The `drop table` cascade is the whole disposition.

**The window closes at launch and this is the reason the story has urgency at all.** Recorded here
because the issue's Urgency 3/10 is only correct while the PROD count stays 0; the day it is not,
this change needs a migration path and becomes a different story.

## D11 — Two active changes carry `MODIFIED` deltas against requirements this one removes

Measured on this branch:

- `openspec/changes/add-ride-chat-unread/specs/ride-chat/spec.md` — `MODIFIED` *The surfaces this
  change does not build SHALL be named rather than half-built*
- `openspec/changes/archive/2026-09-08-invite-riders-to-a-ride/specs/ride-chat/spec.md` — `MODIFIED` *Chat visibility
  SHALL be the intersection of ride visibility and crew membership, never crew membership alone*

**The second of those archived on 2026-09-08; `add-ride-chat-unread` is still open.** `openspec
archive` folds a delta in by replacing a requirement wholesale, so if it archives **after** this
change, it modifies a requirement that no longer exists.

**Recommended order: archive `add-ride-chat-unread` before archiving this one.** It describes work
that shipped long ago (`061` and `083` are applied on both projects), so archiving it is
bookkeeping rather than a decision. If that is not done, this change's archive step should be expected to need a
manual reconciliation, and the `ride-chat` spec file should be confirmed **deleted** from
`openspec/specs/` afterwards rather than left as an empty shell.

This is recorded because it is silent: nothing fails, the second archive just discards an edit.

## D12 — The junction risk this change introduces, and why it is contained

**`ride_threads` is not a junction, and getting that wrong is the more expensive mistake here.**
`src/lib/data/columns.ts` gives the definition — *two foreign keys, and a primary key that is exactly
the union of their columns* — and explicitly refutes the loose version: *"any third table holding a
key to both" is the tempting rule and it is FALSE*, with `postcards` as the counter-example.
`ride_threads` has PK `id`, so holding `ride_id → rides` and `author_id → profiles` does **not** make
it one. Its exact analogue `club_threads` (PK `id`) is likewise absent from the junction set that
`columns.ts`'s own query returns against DEV:

```
club_join_waves, club_members, club_thread_reads, postcard_hides, postcard_likes,
ride_members, ride_reads
```

**Seven, and `columns.ts`'s own prose says eight** — that file went stale when `101` retired
`club_thread_waves`, not the other way round. Re-run the query rather than reading the count.

**The table migration A does add as a junction is `ride_thread_reads`** — PK `(user_id, thread_id)`,
exactly the union of its keys to `profiles` and `ride_threads`, mirroring `club_thread_reads`, which
that query confirms is one. It is harmless: `ride_threads` is created by the same migration, so no
shipped bundle holds an embed of that pair that could become ambiguous.

So there is no `092`-class risk to contain, and **no reason for the build to stop**. `092` remains
the reason the discipline exists — every `profiles` embed in `src/lib/data/` names its foreign key
(`organizer:profiles!organizer_id`, `author:profiles!author_id`, `invitee:profiles!invitee_id`,
`MEMBER_PROFILE_EMBED`) and `src/lib/data/__tests__/embed-hints.test.ts` refuses an unhinted one —
but this change does not test it.

**Re-measure anyway, and know what a surprise would mean.** `tasks.md` 1.1 re-runs `columns.ts`'s
junction query against the tree at build time rather than trusting this paragraph. But the thing it
is checking for has changed: **not** whether an unhinted embed exists — no new `rides`↔`profiles`
path is added, so an unhinted one would already be broken today — but whether `ride_threads` came
out of the build with the primary key this design specifies. If the query returns `ride_threads`,
the PK was written as `(ride_id, author_id)` or similar instead of `id`, and *that* is the thing to
stop on. **There is no deadlock and no preparatory hint-only deploy**; an earlier draft of this
section said there was, on the strength of miscounting `ride_threads` as a junction.

## Open questions

All six live in `proposal.md` §Open Questions with their recommended defaults, their blocking status
and who can answer them, so they sit next to the change they affect rather than in two places. In
summary:

| | Question | Blocking | Whose |
|---|---|---|---|
| Q1 | An accepted-invite rider on a private club's ride — do they get the ride's threads? | **yes** | product owner |
| Q2 | Does the organizer get a Remove control on a thread? | no | mine unless overruled |
| Q3 | Does a reply notify the thread's author? | no | product owner |
| Q4 | Is there any way to report a ride thread? | no | product owner |
| Q5 | Can a past ride's threads still be read and posted to? | no | mine unless overruled |
| Q6 | What is the retention window? | no | product owner |

**Q1 is the only blocking one**, and only because it is the single place this change lets a rider who
is not in a private club read text written by that club's members. The default is written into the
spec so the build proceeds; a *no* answer would mean adding a club-membership conjunct to the two
SELECT policies, which is a one-line change to each and two more assertions — cheap to reverse, which
is the other reason it is safe to default.

## Questions closed here, so they are not reopened in the build

- **Does the ride reuse `club_threads` with a nullable `club_id` and a nullable `ride_id`?** No. A
  single table with two mutually-exclusive parents means one audience predicate branching on which
  column is null, evaluated on every row of both domains — and a `CHECK` keeping exactly one non-null
  that nothing in RLS can rely on. Two tables, two policies, each stating its own audience in its own
  text. This is the same reasoning `082` gives for the grandchild restating its audience.
- **Does the thread list get its own tab on the ride detail?** No. The ride detail is one screen
  since PD-254 and a timeline since PD-393; threads reach it through the timeline row and the create
  sheet, which is how the club does it.
- **Is `private.is_ride_crew` modified?** No. Same body, same signature, same grant. `041` and `051`
  call it and any change to it is a change to postcard tagging and map tiles.
- **Is there a ride-level "conversation off" switch?** Not in scope. Nothing in the design draws one
  and it would be a fifth thing the organizer can configure on a screen PD-254 spent a story
  condensing.
