# Design — Manage riders, and telling a rider the club said no

Everything measured below was read off `letsride-dev` (`fpmrimzxadewsaiwpsel`) on 2026-08-28
through `execute_sql`, or off the migration chain in this repo. Where a claim came from the
spawning brief rather than from a measurement, it says so.

## The authority matrix

One table, and every cell is a decision with a reason. **Read it as the specification of the three
RPCs' bodies**, not as a summary of them.

| Actor ↓ / Target → | the owner | an admin | a member | themselves |
|---|---|---|---|---|
| **owner** | — | remove ✓, demote ✓ | remove ✓, promote ✓ | remove ✗, demote ✗ |
| **admin** | remove ✗, demote ✗ | remove ✗, demote ✗, promote ✗ | remove ✓, promote ✗ | remove ✗ |
| **member** | ✗ | ✗ | ✗ | leaves, via the existing DELETE policy |
| **non-member** | ✗ | ✗ | ✗ | — |
| **blocked with the target** | as their role | as their role | as their role | — |
| **signed-out** | ✗ — no `anon` grant on any of the three RPCs, and decision #1 | | | |

### Why an admin may not remove another admin

**The refusal is a predicate on the TARGET's role, not on the caller's.** `remove_club_member`
requires the caller to be owner-or-admin **and** the target's `club_members.role` to be exactly
`'member'` unless the caller is the club's owner. So the same admin who may remove a member is
refused on an admin, and one raise site makes the two indistinguishable to them.

The reason is that admins are appointed by one person and are otherwise equals. If they can remove
each other, the roster becomes a race — whoever opens the app first wins — and the owner's
appointment is undone by somebody the owner did not consult. There is no audit trail (`085`
refused a `responded_by` column and this change adds no equivalent), so nothing would even record
that it happened.

### Why an admin may not remove the owner, and why the role predicate is not enough on its own

The role predicate above already excludes a target whose role is `'owner'`. **It is not sufficient,
and that is the trap this paragraph exists for.** `054`'s *ownerless owner* — a `clubs.owner_id`
holding no `club_members` row — is reachable on demand (`createClub` issues two un-transacted
inserts), and a hand-made roster row can say `'member'` for the owner. In both shapes a
role-only predicate lets an admin remove the club's owner: in the first there is no row to read a
role from and a `role = 'member'` filter matched against nothing behaves however the query was
written; in the second it matches outright.

So both RPCs carry an explicit `rider <> c.owner_id` conjunct read from `clubs`, and the assertion
that pins it uses the **ownerless-owner fixture**, not an ordinary one. That is the one case an
obvious test would miss.

### Why an admin may promote, and only the owner may demote

**An admin promotes. That is the deliverable, not a default this build chose.** PD-326's own title
is *"an admin can remove a rider and promote one"*, and the product owner's sentence behind it
(2026-08-27) is *"allows admins to accept new riders, remove existing riders, or promote riders to
admins"*. `queue-pickup.md` STEP 5 says to read a title literally, and this one names the
capability. Building it owner-only would deliver less than the story names, which is PD-279's
failure mode.

**The counter-argument is real and is recorded rather than built, because it is the owner's to
weigh.** Promotion is the grant of the power to remove, and — measurably — the power to inherit the
club: `private.transfer_owned_clubs` (`029`, body replaced by `032`) orders its successor
`case m.role when 'admin' then 0 when 'member' then 1 else 2 end, m.joined_at, m.user_id`, so making
somebody an admin moves them to the front of the succession queue, ahead of every longer-tenured
member. If the owner wants that decision kept to themselves it is **one conjunct** —
`v_uid <> v_owner` in `promote_club_member` — plus one assertion. That direction is also the
reversible one, which is why the flip is written out here rather than argued again later.

**Demotion is owner-only, and that half is not the owner's sentence being narrowed — it is the half
the sentence does not mention.** If an admin can demote an admin, an admin can remove an admin in
two steps and `remove_club_member`'s refusal is decorative. Silence is not a grant when the thing
granted is irreversible by the person losing it. An admin may still step **down** themselves: that
takes nothing from anybody else, and an admin with no way out would have to leave the club entirely
to shed the role.

### Why nobody may demote or remove the owner, including the owner

There is no demote-owner operation and no self-target on any RPC. Both refuse `rider = auth.uid()`
outright, before anything else.

**The owner removing themselves is already a no-op, and offering it would be a lie.** Every
authority predicate in this schema reads `clubs.owner_id`, not the roster row:
`private.is_club_member_for` has an owner arm (measured `prosrc`), `private.is_club_admin_for` has
one, `clubs` SELECT has one, `delete_owned_club` gates on the column. So an owner who deleted their
own `club_members` row would still see the club, still be its admin, still be able to delete it —
and would simply be missing from the roster. `ClubOptionsMenu` already draws `Leave club` only when
`!isOwner`, which is the same rule in the UI; the RPC is where it becomes enforceable.

Ownership *transfer* would be the honest version of "step down", and it is not in this change:
`clubs` UPDATE is `auth.uid() = owner_id` in **both** USING and WITH CHECK (measured), so an owner
cannot write a different `owner_id` at all, and `029` is the only writer that ever does. Widening
that is a story with its own negative cases.

## The block conjunct `085` has and these RPCs must not

`085`'s two RPCs both carry `and not private.is_blocked(v_uid, r.user_id)`, and copying it here is
the obvious move. **It would be wrong, and the rule that says so is the same rule that put it
there.**

`036` §4 states it: *no write path may reach a row no read path returns* — because the difference
between the two is a count an admin can compare against the list they were just shown, and decision
#2 forbids a block being revealed by any gap, count or marker. In `085` the read path
(`club_join_requests` SELECT) **does** hide blocked riders' requests, so the write path must hide
them too.

Here the read path hides nothing. **`club_members` SELECT carries no block predicate at all** —
measured; the qual is `private.is_club_member(club_id) or exists (select 1 from clubs c where c.id
= club_members.club_id and c.is_public)` — which `085`'s own header already records for a different
reason. A blocked rider is on the roster and is drawn. So a block conjunct on the RPC would produce
a control the admin can see, aimed at a rider the admin can see, that refuses with no explanation:
**a marker for the block rather than a hiding of it**, which inverts what decision #2 is for.

So: **no block conjunct on `remove_club_member`, `promote_club_member` or `demote_club_admin`**, and
the reason is derived from the read path rather than copied from the neighbouring file. The
`club_join_requests` side of the Manage riders screen keeps `085`'s conjuncts exactly as they are.

## Removal must not be undoable by an approval

A `club_join_requests` row can outlive the join it asked for. `085`'s own lifecycle table records
the path: a club flips **private → public**, a rider with a `pending` row joins directly through the
`club_members` INSERT policy, and the stale `pending` row survives — *"which the approval RPC's `on
conflict do nothing` renders harmless"*.

It stops being harmless the moment removal exists. Remove that rider and the stale `pending` row is
still there, still answerable, and an admin approving it puts them straight back in — with
`join_club_from_request`'s `on conflict do nothing` making it look like an ordinary approval.

**So `remove_club_member` deletes any `club_join_requests` row for that (club, rider) in the same
statement.** It is one `delete`, it fires `085`'s `retract_club_join_requested` on the delete arm
for free, and it means removal is not silently reversible by a different admin answering an old
question. Asserted at `088.7`.

Note what it does **not** do: it writes no `declined` row and creates no cooldown. A removed rider
may ask again immediately, which is §What a removed rider may do next.

## What a removed rider keeps, loses and may do next

Every line below was read off the live policies and constraints, not inferred. **No foreign key
anywhere references `club_members`** (measured: zero rows in `pg_constraint` with
`confrelid = 'public.club_members'::regclass`), so removal cascades nothing. Everything that
changes, changes because a policy stopped returning true.

| Thing | What happens | Mechanism |
|---|---|---|
| Their **postcards in the club** | rows survive; every remaining member still sees them; the author still **reads** them and still may **delete** them; the author may **no longer edit** them | `postcards` SELECT's FIRST arm is `author_id = auth.uid()`; DELETE is `author_id = auth.uid()`; **UPDATE's WITH CHECK** is `author_id = auth.uid() and (club_id is null or private.is_club_member(club_id))` |
| Their **club threads and messages** | survive, stay visible to the club, become invisible to them | `club_threads` / `club_messages` SELECT both conjunct `private.is_club_member` |
| Deleting their **own club message** | still possible | `public.delete_own_club_message` gates on `m.author_id = v_uid` and **nothing else** (measured `prosrc`) |
| Deleting their **own thread** | no longer possible | `club_threads` DELETE conjuncts `private.is_club_member(club_id)` as well as authorship |
| A **ride they organised** in the club | unaffected; still in the club, still theirs | `rides.club_id` is `ON DELETE SET NULL` on the *club*, and removal does not touch `rides` |
| A **private-club ride they are only crew on** | **they keep the `ride_members` row and lose the ride, its roster and its chat** | `rides` SELECT's club arm is `private.is_club_member(club_id)`, and `022` guarantees a private club's rides are `is_public = false` |
| Their **`feed_reads`** watermark for the club | row survives, frozen | UPDATE WITH CHECK conjuncts `private.is_club_member(club_id)` |
| Their **`club_thread_reads`** | rows survive, frozen | same shape |
| **Notifications naming the club** | evicted from list *and* count, in the same instant, for a private club; unchanged for a public one | `036` §3's club conjunct, and `unread_notification_count()` is `security invoker` so it reads the same predicate |
| The admins' **"X joined club"** notification about them | **survives** | `036` §7.6 decided this for leaving — *"the row records an EVENT AT AN INSTANT"* — and removal is not a different event |

**The crew row is the sharp one and it is accepted rather than repaired.** Evicting a removed rider
from every ride in the club would destroy an organizer's crew as a side effect of a club decision —
the shape `043` rejected when it refused to widen the `rides` DELETE policy with a club-owner arm —
and it would be a second, larger blast radius arriving inside a roster operation. It is written
down here so the next reader finds it stated rather than discovers it.

### May they rejoin?

- **Public club: immediately, in one tap**, through the existing `club_members` INSERT policy.
  Nothing here adds a cooldown, and adding one would mean a tombstone table — new state, its own
  retention question, and a new way to disclose that a removal happened. The tool for keeping
  somebody out is `blocks`, which is symmetric and already enforced in every policy.
- **Private club: they re-request**, and `private.club_takes_join_requests_for` admits them — they
  are not the owner, not a member, and the club is still private. They hold **no** request row,
  because approval deleted it (`085` §The state machine) and removal deletes any stale one (§above).
  So the ask is clean and the unique key does not refuse it.

### Is removal distinguishable from leaving?

**To the removed rider: no**, and deliberately. The club disappears from their clubs (private) or
reverts to a Join affordance (public), exactly as it would if they had left. No notification, no
marker, no row anywhere naming who did it. A "you were removed" notice is a moderation statement
addressed to the person moderated in an app with no appeal surface, and `085` already settled the
principle it would break: *a club refuses as a club*.

**To everyone else: also no.** `club_members` holds no tombstone and this change adds none. The
roster simply has one fewer row.

The honest consequence, stated rather than glossed: **on a public club, removal is a suggestion.**
The rider rejoins in one tap. That is the accurate description of the feature and the reason the
confirmation copy must not promise more than it delivers.

## Does anything notify

**No, for both promotion and removal**, and the two reasons are different — which matters, because
one of them is a mechanism and the other is a choice.

**Removal: a product rule, not a schema one.** The reason is §Is removal distinguishable — a
notification is precisely the distinguisher, and the whole design says there must not be one. It is
worth being explicit that the *mechanism* would work: a `club_removed` row addressed to the removed
rider with the club as subject would be readable for a public club through the ordinary conjunct,
and for a private one through this change's own type-scoped disjunct, since
`club_takes_join_requests` is true for a removed rider. So "we cannot" is not the argument; "we
decided not to" is.

**Promotion: a scope choice, and it is a real candidate.** The recipient is a member, the actor is
the owner, both resolve, and the subject shape is `club_joined`'s — so it needs a type string, one
`notifications_subject_shape` arm, a fan-out and a retraction on demotion. Nothing about it is hard.
It is left out because this change already carries three RPCs, a policy widening on a shipped
`036` predicate and a `storage.objects` policy, and because a rider promoted today is a rider the
owner is talking to anyway. Its trigger is the first club big enough that the owner is not.

## The mechanism, adversarially

The brief's proposed mechanism, evaluated against the two bars the product owner's decision imposes:
**it must not name the refusing admin**, and **two declines from two clubs must produce two rows.**

### Bar 2 first, because it is the easy one

`036` §8's `notifications_event_key` is unique over
`(user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id)` with `nulls not distinct`.
Keeping `club_id` set to the club puts a distinguishing value in the key, so two declines from two
clubs differ in the seventh column and produce two rows. **Bar 2 is cleared by `club_id` alone,
whatever the actor is.** This is the entirety of what was wrong with option B, and it is fixed by
not being option B.

### Bar 1 is where the brief's own suggestion fails, and it fails for the reason the brief suspected

The suggestion is `actor_id = the rider who pressed Decline`, "but never render or disclose them".
**Reject.** `NOTIFICATION_SELECT` embeds `actor:profiles!actor_id(${PUBLIC_PROFILE_COLUMNS})` and
the recipient holds table-wide SELECT on `notifications`, so the requester can read `actor_id` with
one hand-rolled PostgREST request against the publishable key that already ships in the bundle. A
client-side omission is **not a guarantee** — it is exactly the class of rule `CLAUDE.md` calls
advisory, and `085` refused a `responded_by` column to prevent this precise disclosure. Shipping it
in `actor_id` instead would be that refusal defeated by a different column name.

**The club's owner is worse, not better.** It is a *false attribution* — the owner may not have
pressed anything — and it is a *new* disclosure: `discoverable_private_clubs` returns seven columns
and `owner_id` is deliberately not one of them, so the owner's identity is currently unreachable to
a non-member. Naming them in a notification would leak the one rider a `clubs` row identifies.

**Making `actor_id` nullable is worse still.** It is a NOT NULL column on a shipped table, and
`036` §3's third conjunct requires the actor's profile to resolve — with NULL it does not, so the
row would be unreadable and a *second* policy change would be needed to rescue it. Two policy edits
to avoid one.

### The actor that is honest by construction: the requester themselves

`actor_id = new.user_id`. The rider who asked is the subject of their own request, the value
discloses nothing they do not already know, it is NOT NULL, and — checked rather than assumed —
every conjunct of `036` §3 passes for it:

- **conjunct 1**, `user_id = auth.uid()`: unchanged, and it is what keeps the row private to its
  recipient.
- **conjunct 2**, `not private.is_blocked(auth.uid(), actor_id)`: a self-block is impossible.
  Measured: `blocks` carries `CHECK (blocker_id <> blocked_id)` (`blocks_no_self_block`), and
  `private.is_blocked(a, b)` is an `exists` over exactly those two orderings — so
  `is_blocked(x, x)` is false against any legal `blocks` table.
- **conjunct 3**, the actor's profile resolves: `profiles` SELECT's **first** arm is
  `auth.uid() = id`. A rider always resolves to themselves — including one who has nulled their own
  username, which is the reachable state `036` §3 documents at length. **This is strictly more
  robust than an admin actor**, which would vanish from the row the moment the requester blocked
  them: a decline the rider then blocks their way out of seeing is a worse outcome than a decline
  they can read.

The cost is honest and is paid in the UI, not in the schema: the row's actor is the reader, so the
row must not draw the actor's name or avatar. §The row draws the club is where that is resolved,
and it resolves *into* `085`'s own rule rather than away from it.

### The disjunct, and why it is not option C

```sql
and (
  club_id is null
  or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
  or (type = 'club_join_request_declined'
      and private.club_takes_join_requests(notifications.club_id))
)
```

on `036` §3's SELECT policy **and on `036` §4's UPDATE policy in both its USING and its WITH CHECK**
— all three, identically, because the suite asserts the three expressions are textually identical
and because a rider who can read a row but not mark it read keeps a badge that never clears.

Six things checked against it, in the order a reviewer would try to break it:

1. **Does any other notification resolve differently?** No. The disjunct is conjoined with a literal
   `type =`, and only this fan-out writes that type. Every other `club_id`-carrying row —
   `club_joined`, `ride_created_in_club`, `club_join_requested`, `club_join_request_approved` —
   evaluates exactly the expression it evaluates today. **That is the difference from option C**,
   which widens the conjunct unconditionally.
2. **Is the function callable from a policy?** Yes. `private.club_takes_join_requests(uuid)` is the
   one-argument caller-relative wrapper and `085` grants EXECUTE on it to `authenticated` precisely
   so RLS expressions can reach it (an RLS expression is evaluated as the querying role). The
   two-argument `_for` twin is revoked and must not appear here — the same mistake §The avatar that
   ships corrects in the storage arm.
3. **Can the row be written and then permanently unreadable — `085`'s original defect, arriving by
   a new route?** Only if the fan-out writes to a rider for whom neither arm is true. So the
   fan-out's guard is the readability predicate itself, subject-taking:
   `private.can_read_club(new.user_id, new.club_id) or private.club_takes_join_requests_for(new.user_id, new.club_id)`.
   A blocked requester fails both and gets no row, which is correct — decision #2 removes
   visibility, and the block also removed the club from their Explore list.
4. **Does the row survive a state change?** Walked, and the answer is yes in every direction that
   should keep it. The club flips **public** → the ordinary `exists(clubs)` arm is true. The rider
   is later **approved** → they are a member, ordinary arm true. A **block** appears → both arms
   false and the row disappears, which is what a block must do. The club is **deleted** →
   `notifications.club_id` is `ON DELETE CASCADE` (measured) and the row goes with it, so there is
   no dangling destination. The **rider** is deleted → both `user_id` and `actor_id` cascade, and
   here they are the same rider, so the row goes once.
5. **What does it cost per read?** One `stable security definer` call per row of that type on a
   page-size-bounded list. `type =` is a cheap equality on the row and the planner is free to order
   the conjuncts; the worst case is one extra `EXISTS` per row on a bounded page. Named rather than
   measured, because there is no production data to measure against.
6. **What does it cost the policy's design?** This is the real price and it should not be waved
   past. `036` §3 says the club conjunct is *"written per COLUMN rather than per TYPE on purpose"*,
   so that `notifications_subject_shape` is the per-type table and the two cannot drift. This
   disjunct is the **first per-type clause in that policy**, and its failure mode is silent: a typo
   in the type string makes the disjunct never fire, the row unreadable, and nothing red — `085`'s
   defect exactly. **So the change owes an assertion that the literal in the policy equals the
   literal the fan-out writes**, compared as strings rather than eyeballed (`089.4`). That
   assertion is the mitigation, and it is why this is a cost rather than a defect.

**Verdict: the mechanism clears both bars, with one correction — the actor is the requester, never
the declining admin.**

## The row draws the club, not the actor

`NotificationRow` composes `actorName` + `copy`. For every existing type the actor is somebody else;
for this one the actor is the reader, so passing the actor through would print the reader their own
name and avatar.

The resolution is not a workaround, it is `085`'s own sentence applied to a component: **a club
refuses as a club.** So for `club_join_request_declined` the row's leading name and thumbnail are
the **club's**, and the copy is a complete sentence after it —
`"<Club> has declined your request to join."`, falling back to `"A club"` exactly as
`club_joined` falls back today. There is no `RideInviteActions`-style control pair: there is nothing
to answer.

**No denormalised text is introduced**, which is what keeps the modified `notifications` requirement
true rather than merely re-worded. The name is read live, on every render, through a predicate that
goes false the moment the rider is blocked with the club's owner. That is the invariant the standing
requirement is actually protecting; the carve-out is only to the sentence about *which* readers a
private club's name may reach, and that audience was already widened by `085`'s accessor before this
change existed.

### Naming the club in a decline row

The `club:clubs(...)` embed **returns null** for this row — that embed runs under the reader's RLS
on `clubs`, which `085` deliberately did not widen and this change does not either. So the name has
to come from `public.discoverable_private_clubs(target_club, page_size)`. Two candidates:

**A) N parallel one-id calls, one per distinct declined club id on the page.** No new function, no
new advisor, and it is exactly what `getClubPreview` already does — so it is a reuse rather than a
new pattern. Bounded by the number of *declined* rows on one page, realistically zero to two.
Exact: it can never miss a club.

**B) A new accessor returning the caller's own declined clubs in one call.** One round trip
regardless of count, and **one more `authenticated_security_definer_function_executable` advisor** —
taking this change from three new to four — for a saving of at most one or two round trips on a row
type most riders will never hold.

A third shape — one unnarrowed `discoverable_private_clubs()` call, matched locally by id — was
considered and **rejected**: the accessor caps at 100 rows ordered `created_at desc`, so a rider
whose declined club sits outside the first hundred discoverable private clubs would silently get no
name. A silent miss is worse than a round trip.

**Chosen: A.** The advisor is a permanent, reviewable surface; the round trip is not.

## The avatar that ships

PD-335's second decision, with the correction from `proposal.md` §2. The third disjunct on `016`'s
`"Club avatars are readable with the club"`:

```sql
or exists (
  select 1 from public.clubs c
   where c.avatar_path = storage.objects.name
     and (storage.foldername(storage.objects.name))[2] = c.owner_id::text
     -- ONE argument. The two-argument `_for` twin is revoked from `authenticated`
     -- (085), and a storage policy is evaluated as the querying role, so the
     -- two-argument form raises 42501 on every avatar read for every rider.
     and private.club_takes_join_requests(c.id)
)
```

The `foldername[2] = c.owner_id::text` binding is **not** optional and is carried verbatim from the
two arms above it: it is `010` §2's line, and without it attaching a victim's object path to a club
you own would make that object readable to the club's audience. `016`'s §1 CHECK already refuses
that write; this is the second of two independent locks and both stay.

**The covers policy is untouched.** Product owner: *an avatar is the club's identity, a cover is its
content.* `085.6` asserts both halves today; its avatar half inverts and its cover half is
reproduced unchanged, so the assertion that a non-member reads zero cover objects survives verbatim.

**The accepted cost, restated because it is a `storage.objects` widening**: every private club's
avatar image becomes readable to every signed-in rider not blocked with that club's owner. That is
the same audience `discoverable_private_clubs` already gives the club's name, town and member count
to, so it adds no new *audience* — it adds bytes to an audience that already had strings.

**Two client changes go with it or the policy does nothing visible.** `toDiscoverableListItem` in
`src/lib/data/clubs.ts` hard-codes `avatar_url: null` with a comment saying the object will not
sign; that comment and that literal both have to go, and the discovered rows have to be passed
through `resolveAvatarUrls` like every other club list. `getClubPreview` carries the same
assumption. A migration that lands without them is a policy nobody can observe.

## Where the screen lives, and who reaches it

`/clubs/detail/manage`, reached from a `Manage riders` row in `ClubOptionsMenu` drawn when
`viewer_is_owner || viewer_role === 'admin'`.

**`viewer_is_owner`, not `viewer_role === 'owner'`** — `ClubJoinRequestsSection` already draws that
distinction and here it decides whether the feature exists at all: the ownerless owner holds no
roster row, `private.is_club_admin_for` admits them through its `clubs.owner_id` arm, and gating the
menu row on the role would hide the screen from the one rider who can actually use it.

**A non-admin who reaches the URL is REDIRECTED to the club, not `notFound()`.** The roster itself
is not secret — every member can already read it at `/clubs/detail/members` — but a screen called
*Manage riders* whose every control refuses is the same class of defect as PD-125's unreachable
screen, arriving from the other side. The guard is an affordance; the three RPCs are the boundary,
and each refuses with one `insufficient_privilege` whatever the client renders.

**`notFound()` is the wrong answer here, and it is the one a careful author reaches for**, because
every sibling detail route uses it. It is this app's answer to *"no such club, or not one you may see"*, conflated on purpose; reaching
this screen means `getClub` returned a club, so the reader can already see it and there is nothing
to hide. Sending them to a 404 on a club plainly in front of them is the app disagreeing with
itself — and the case that makes it reachable is one this change creates, not a guessed URL: an
admin told about a pending request, demoted before they open it, whose notification `085`'s
retraction does not touch because the request is still pending.

The redirect also self-heals a state the 404 could not. `useQuery` serves cached data synchronously,
so a rider promoted mid-session whose `clubs.detail(id)` entry predates the promotion computes
"not an admin"; under `notFound()` the render threw, the revalidation was never issued, and they
were stuck for the rest of the session. The redirect lands them on the club detail, which reads the
same key and revalidates.

**A non-member of a private club** never gets that far: `getClub` returns null and the existing
`notFound()` fires, which is `085`'s conflation of "no such club" with "not yours" and is unchanged.

### The requests section moves rather than duplicating

`ClubJoinRequestsSection` is deleted from `src/app/(app)/clubs/detail/page.tsx` and mounted on the
Manage riders screen with the same `queryKeys.clubs.joinRequests(clubId)` and the same
`getClubJoinRequests` — `085`'s own instruction, and PD-326's territory comment says the same.

The obvious worry is that an admin loses the at-a-glance prompt, and it does not survive contact:
`085`'s fan-out writes a `club_join_requested` notification to **every** owner and admin on every
request, and `ClubJoinRequestActions` already puts Approve and Decline on that row. The section was
never the discovery surface. What it gains on the new screen is the **`Clear`** control on a
declined row — the affordance `085`'s DELETE policy has permitted since it shipped and which
`087`'s header names as PD-326's, and without which a declined rider can never ask again.

## Ordering, and the one that runs backwards

Restated from `proposal.md` because it is the part most likely to be got wrong under time pressure.

- **`088` applies BEFORE the build serves.** Purely additive: three functions nothing calls yet, one
  revoke of a grant no policy makes usable. An old bundle against the new database is unchanged.
- **`089` applies AFTER the build is confirmed serving** — `app.letsride.social` resolving to a
  `READY` deployment on the promotion sha, `aliasError` null, which is the check `070`'s header
  spells out and which "merged" does not satisfy. The reason is in `src/`, not in the SQL:
  `notificationCopy` and `describe` are exhaustive switches with no `default`, so a
  `club_join_request_declined` row reaching an old bundle makes `describe` return `undefined` and
  the destructuring throw — one Decline pressed inside that window takes the whole notifications
  list down for the rider it addresses.

`CLAUDE.md` states the general rule this is an instance of: *the additive-first rule is about which
side fails safe, not about a fixed order.* `089` adds no DDL that removes anything and still belongs
in the destructive-last slot.

## Questions Closed

Each has a default so the build is not blocked, and each names who can answer it.

**Q1 — Does an admin promote, or only the owner? (product owner; ANSWERED, and the answer is the
issue's own title)**
Built: **an admin may promote**, per §Why an admin may promote, and only the owner may demote. The
counter-argument — that `029`'s succession makes a promotion the power to inherit the club — is
written out there and is **one conjunct** away (`v_uid <> v_owner` in `promote_club_member`, plus an
assertion) if the owner wants it. Narrowing later takes a capability away from riders who had it,
so the flip is worth making deliberately rather than by drift.

**Q2 — Does a promotion notify the promoted rider? (product owner; NON-BLOCKING)**
Default: **no**, per §Does anything notify. Non-blocking: it is a type string, a
`notifications_subject_shape` arm, a fan-out and a retraction, all additive, in any later migration.

**Q3 — Does the confirmation for removal say that a public club's removal is undoable in one tap?
(product owner; NON-BLOCKING)**
Default: **yes, in one clause** — "They can join again at any time" on a public club and nothing on
a private one. It is the only place the feature's real strength is stated to the person relying on
it, and the alternative is a rider believing removal is permanent.

**Q4 — Does the Manage riders screen show a rider's `joined_at`? (agent's, recorded)**
Answered: **yes**, because it is already read by `getClubMembers`, already the roster's sort key,
and it is the one fact that makes "who is this and how long have they been here" answerable before
a destructive action. No new disclosure — the members page draws the same rows.

**Q5 — Does the roster on Manage riders paginate? (agent's, recorded)**
Answered: **no**, unchanged. `CLUB_ROSTER_LIMIT` is 200 and truncates, which `getClubMembers`'
own docstring already calls the honest trade. Recorded so the truncation is not read as fixed, and
so a club at the bound is a known state rather than a surprise.

**Q6 — Is the route `/clubs/detail/riders`? (agent's, recorded)**
Answered: **no — it shipped as `/clubs/detail/manage`.** `riders` was proposed to match the product
owner's own word, and the segment reads as a second roster beside `/members` rather than as the
thing you do to one. `manage` says which of the two it is at a glance in `detailPaths`, where every
other club segment is a noun for a *screen*. Not `/members` either way: that is the read-only roster
and must stay reachable, because a member who is not an admin still has somewhere to see who is in
their club.
