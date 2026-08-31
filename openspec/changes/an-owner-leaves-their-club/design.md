# Design — an owner leaves their club

## Context

Everything in this table was read from the migration chain, the live policy set or `src/` on
**2026-08-31**. Nothing is quoted from `CLAUDE.md` or `docs/HANDOFF.md`, and one row below
contradicts a doc comment that has been in the tree for weeks.

| Fact | Value | How to re-derive |
|---|---|---|
| `club_members` DELETE policy | `auth.uid() = user_id` — **no owner exception** | `pg_policy`, `polcmd = 'd'` |
| `club_members` policies | `SELECT`, `INSERT`, `DELETE` — **no UPDATE, still** | `select polcmd from pg_policy where polrelid = 'public.club_members'::regclass` |
| `club_members` triggers | `enforce_participation_gate` (BEFORE **INSERT**), `notify_club_joined` (AFTER **INSERT**) — **no DELETE trigger at all** | `pg_trigger`, `not tgisinternal` |
| `enforce_participation_gate` on `clubs` and `club_members` | **INSERT only**, `when (CURRENT_USER = 'authenticated')` | `pg_trigger.tgtype & 28` |
| `clubs` UPDATE policy | `using` **and** `with check`, both `auth.uid() = owner_id` | `pg_policy`, `polcmd = 'w'` |
| `clubs` UPDATE column grant to `authenticated` | `avatar_path, cover_image_path, description, is_public, latitude, location_name, location_place_id, longitude, name` — **no `owner_id`** | `information_schema.column_privileges` |
| `club_members` grants to `authenticated` | table-level `SELECT, DELETE`; per column `INSERT (club_id, user_id, role)` and `UPDATE (club_id, user_id, role)` | same |
| `private.is_club_member(club)` | membership **OR `clubs.owner_id = auth.uid()`** since `054` | `pg_get_functiondef` |
| `private.is_club_admin_for(candidate, club)` | `clubs.owner_id = candidate` **OR** roster `role in ('owner','admin')` | `085`, `pg_get_functiondef` |
| `public.delete_owned_club(p_club_id)` | owner-only; refuses `is_default` since `059`; deletes the club's `is_public = false` rides; returns surrendered Storage paths | `043`, `059` |
| `private.transfer_owned_clubs(departing)` | admin-then-member succession; **demotes** the departing rider; deletes the club when nobody remains | `029`, replaced by `032` |
| FKs into `clubs` | `club_members`, `club_join_requests`, `club_threads`, `feed_reads`, `notifications`, `postcards` all **CASCADE**; `rides` is **SET NULL** | `pg_constraint`, `confrelid = 'public.clubs'::regclass` |
| FKs into `club_members` | **none** | same, `confrelid = 'public.club_members'::regclass` |
| `feed_reads` FKs | `club_id → clubs` CASCADE, `user_id → profiles` CASCADE — **nothing from `club_members`** | same |
| Published definer functions `authenticated` may execute | **24** | `pg_proc` × `has_function_privilege` |
| Next free migration number | **095** by instruction; `091` is the last file on disk | `ls supabase/migrations/` vs `list_migrations` |

**One of those rows falsifies a doc comment this change is rewriting anyway.** `leaveClub`'s
docstring says *"The row goes, and `015`'s FK cascade takes the watermark with it — so rejoining
later reads as 'everything since you rejoined' rather than resurfacing a year of history."*
`feed_reads` has exactly two foreign keys, to `clubs` and to `profiles`, and `club_members` has **no
child tables and no DELETE trigger**, so leaving a club leaves the watermark in place and rejoining
resurfaces nothing. Task 8.2 corrects it in the same file this change edits. It is recorded here
rather than merely fixed because the wrong version is what a reader would re-derive from the
sentence *"`015` added `feed_reads`"* without opening `pg_constraint`.

Six facts shape everything below.

1. **PostgREST has no transaction.** A transfer is three writes across two tables; done as three
   round trips it tears into a club whose `owner_id` and whose roster disagree, which is precisely
   the disagreement PD-128 and `043` both had to reason around. One statement or nothing.
2. **`authenticated` cannot write `clubs.owner_id` at all** — the column grant, then the WITH CHECK.
   So the transfer is elevated by necessity, not by preference.
3. **`016` pins both image paths to the current `owner_id`.** Any ownership change raises `23514`
   unless both are NULLed in the same statement.
4. **Inside a `security definer` function `current_user` is the owner**, measured on Postgres 16 for
   `021` §3 and relied on by `023`, `058` and `085`. That one fact decides whether the gate fires,
   whether the new guard fires, and whether `019`'s role rule applies.
5. **`club_members` SELECT drops rows in both block directions.** Every count a client can take of a
   roster is a floor, so no arm may be *decided* from one — see §D7.
6. **`054` made the ownerless-owner state survivable but not legal.** An owner with no roster row
   still reaches their club, so nothing is on fire; the state is still one the schema should not be
   able to represent, and every arm below has to behave correctly for a club already in it.

## Goals / Non-Goals

**Goals**

- The three arms are decided by the **database**, from the true state, and no client read can move
  a club from one arm to another.
- **No call a rider makes as "leave" can delete a club.** Deletion is reachable only through a
  confirmation the rider gave to a sheet that told them what it destroys.
- An owner-membership row has exactly two legal ways to disappear — the transfer, and the club going
  away — and every other route is refused by the database rather than by a component.
- The club carrying `clubs.is_default` cannot be left, transferred out of, or deleted by any rider.
- Nothing here becomes a way to learn something about a rider a block is hiding.

**Non-Goals**

- Choosing a successor by hand, an "invite a co-owner" flow, or a "step down to admin but stay".
- A notification to the successor (§Q3). Deferred with a reason, not skipped.
- Relaxing `016`'s path CHECKs so a transferred club keeps its avatar and cover (§Q5).
- Anything about **rides**. `enforce-creator-membership` owns the organizer half and PD-194's
  asymmetry with it is deliberate — a club outlives its owner and has a roster to inherit it; a ride
  is one rider's plan on one date with nobody to hand it to (that change's Q2, answered **no**).
- Reopening decision #1 (no anonymous access), #2 (blocking in RLS) or #8 (Supabase is the backend).

## Decisions

### D1 — One RPC that only transfers, and two raises that are the other two arms

The obvious shape is one function that does all three arms — transfer, or delete, or refuse. **It is
wrong, and the reason is worth stating before the shape**: a function that can delete a club is a
function a stale cache can aim at a club with members in it.

Walk it. The client decides which affordance to draw from a roster count, and that count is read
under RLS and out of a cache. It can be **stale** (a member left since the last fetch, or joined) and
it is **always a floor** (a blocked member is not in it). So:

- Client thinks arm 2, truth is arm 3 → a delete-all-arms function refuses. Fails closed. Fine.
- Client thinks arm 2, truth is arm 1 → it transfers instead of deleting. Non-destructive. Fine.
- **Client thinks arm 1 or 3, truth is arm 2** → the rider taps a row that says *Leave club*, and a
  club is **destroyed**, with every postcard in it, on a tap that promised nothing of the kind. Not
  fine, and reachable from an ordinary stale cache with no blocking involved at all.

So: **`public.leave_owned_club(p_club_id uuid)` performs arm 1 and nothing else.** When there is no
admin to hand the club to it **raises**, and the client's response to that raise is to open the
existing `DeleteClubSheet` — which counts what it would destroy, phrases every count as a floor, and
takes a second, explicit confirmation before calling `deleteClub`. Deletion is therefore reachable
only behind a confirmation, by construction rather than by care.

**Arm 2 gets no new SQL.** `deleteClub` → `public.delete_owned_club(p_club_id)` already: re-checks
ownership, refuses `is_default` (`059`), deletes the club's `is_public = false` rides so `SET NULL`
cannot strand them (`043` §2, `032` §2), and returns the Storage paths. Writing a second deletion
route would duplicate four rules and the duplicate is the copy that drifts.

**Return shape:** `returns table (object_path text)`, byte-identical to `delete_owned_club` and
`private.transfer_owned_clubs`. The transfer surrenders the club's avatar and cover (D2), and the
leaver is the only rider whose Storage policy reaches those objects, so they must come back. The
client's sweep is then literally the code `deleteClub` already runs.

**Parameter name `p_club_id`**, matching `delete_owned_club` rather than `088`'s `target_club`.
`043`'s reason still holds — `club_id` is a column on five tables, so a parameter of that name makes
`where club_id = club_id` ambiguous — and this function *calls* `delete_owned_club`'s sibling
constraints, so matching the one it stands next to is worth more than matching the newer pair.
`#variable_conflict error` and alias-qualified column references throughout, `043`'s belt and braces
for a function that can move a club.

### D2 — The transfer, in one statement, and the two things that raise if you get the order wrong

```
1. v_uid := auth.uid();                       raise 42501 if null
2. select owner_id, is_default, avatar_path, cover_image_path
     from public.clubs where id = p_club_id and owner_id = v_uid  for update
   not found ->                               raise 42501, ONE message
3. is_default ->                              raise 42501
4. successor := private.pick_club_admin_successor(p_club_id, v_uid)
   null ->                                    raise 23514, ONE message covering arms 2 and 3
5. return the surrendered avatar_path / cover_image_path
6. update public.clubs
      set owner_id = successor, avatar_path = null, cover_image_path = null
    where id = p_club_id
7. update public.club_members set role = 'owner'
    where club_id = p_club_id and user_id = successor
8. delete from public.club_members
    where club_id = p_club_id and user_id = v_uid
```

**Step 6 NULLs both paths in the same statement as the ownership move, and that is not tidiness.**
`016`'s `clubs_avatar_path_owned` and `clubs_cover_image_path_owned` are row CHECKs evaluated at the
end of the statement; setting `owner_id` alone raises `23514` on the happy path. `032` already does
it this way and is the precedent rather than a coincidence.

**Step 8 deletes; it does not demote.** This is the single most important divergence from `032`, and
PD-194's body flags it: `032` **demotes** the departing rider because its transfer commits before the
rest of an account deletion runs, and a Storage 5xx in between must not eject a rider from a private
club they can no longer rejoin. Here the rider is *choosing* to leave, in one call that either
commits whole or does not, so leaving them a `member` row would be leaving them in a club they asked
to leave. Copying `032` wholesale would ship exactly that bug.

**Step 8 deletes zero rows for an ownerless owner, and that is correct rather than an edge case to
guard.** `054`'s state — a club whose `owner_id` holds no roster row — passes through arms 1, 2 and 3
unchanged: step 2 finds the club (the check is on `clubs.owner_id`, not on a roster row), step 4 sees
the same candidates, and step 8 is a no-op. Task 5.9 asserts it, because an implementation that
raised on "no row deleted" would leave that rider unable to leave at all.

**Steps 6 and 7 do not fire the participation gate**, because it is **INSERT only** on both tables
(measured — see §Context; `023`'s WHEN clause is the second reason, not the first). And step 7 does
not fire `notify_club_joined`, which is AFTER **INSERT**. So the successor is told nothing — §Q3.

**Nothing here needs `019`'s INSERT policy, in either direction.** The function is `security definer`,
so RLS does not apply to steps 6–8; and when `enforce-creator-membership` later removes `019`'s
`role = 'owner'` INSERT arm, this function is unaffected because it UPDATEs rather than INSERTs.

### D3 — The successor query is copied from `032`, deliberately, and what must not drift is asserted instead

`enforce-creator-membership`'s `design.md` §Open Questions Q1 instructs this change to **extract**
`032`'s successor `select` into a shared `private.pick_club_successor(club_id, departing)` and have
both call it, on the ground that *"a second hand-written copy drifts, and a club would then inherit
differently depending on why its owner left."*

**This change declines that instruction, and does so knowingly, because its stated fear is now the
decided behaviour.** The two rules differ in **candidate set**, by product decision:

| | `032` — the owner is deleting their account | `095` — the owner is choosing to leave |
|---|---|---|
| Candidates | admin, **else any member**, else delete the club | **admin only** |
| Nobody left | deletes the club silently | **refuses**, and the rider is offered the delete sheet |
| Departing row | **demoted** to `member` | **deleted** |

The reason they differ is that `032` has **nobody to ask**. An account deletion is irreversible, it
is already committing, and its alternative to a member-successor is destroying every other member's
postcards through the `clubs → postcards` cascade. A voluntary leave has a rider standing there who
can promote somebody, so it can afford to refuse. Unifying the two behind a `boolean admins_only`
would put a product decision inside a flag, which is the shape `088` spent a section refusing.

**So: two functions, and the shared part is asserted rather than extracted.** What must never drift
is the **ordering**, not the candidate set:

- `case role when 'admin' then 0 when 'member' then 1 else 2 end` — a **total** order over the enum,
  so a stray second `owner` row sorts last instead of being picked at random. `095`'s function filters
  to `role = 'admin'` and therefore needs only `joined_at, user_id`, but it writes the same total
  CASE anyway so the two bodies are diffable.
- `joined_at` ascending, tie-broken by `user_id`. `user_id` is a uuid and is arbitrary, which is the
  point: it is **deterministic**, so two runs against the same roster pick the same rider, and it is
  a rule SQL can evaluate rather than one a client picks.
- `for update of p` on the joined `profiles` row, `032`'s lock, which makes the selection sound
  *within* the transaction: a candidate whose own deletion is committing concurrently is skipped in
  favour of the next rather than misread as "no successor". `032` §3 measured `LockRows` sitting
  below `Limit`; task 0.5 re-measures it rather than inheriting the observation.

Task 5.14 asserts the two functions agree on a fixture whose admin set and member set coincide, which
is the honest testable version of "extract, never copy".

**`private.pick_club_admin_successor` also locks the candidate's `club_members` row (`for update of
m, p`)**, which `032` does not, because `088` exists now: `promote_club_member`, `demote_club_admin`
and `remove_club_member` all take `for update` on exactly that row. Without the lock, a demotion
committing between the select and step 7 would leave the club owned by a rider whose roster row says
`member`. See §D6 for the lock order.

### D4 — The guard, and the third of its three rules is the one that fails open

`before delete on public.club_members for each row when (current_user = 'authenticated')`, executing
`private.protect_club_owner_membership()`. Three rules, and they are
`enforce-creator-membership` §D3's, reused rather than re-derived:

1. **Refuse** when `old.user_id` equals the club's `owner_id`. `check_violation` (`23514`), never
   `insufficient_privilege` — `023` §2's rule, because `42501` is indistinguishable from an ordinary
   RLS denial and an assertion that accepted "any error" would pass when the wrong rule fired.
2. **`when (current_user = 'authenticated')`** on the trigger, `023`'s shape and not `022`'s. This is
   a rule about what the **client** may do, not an invariant about what the table may contain, and it
   is what lets `leave_owned_club` (definer → `current_user` is the owner → the WHEN clause is false)
   pass straight through. It is also what keeps `add-account-deletion`'s cascade working. Copying
   `022`'s no-escape shape here would make this change unimplementable without `disable trigger`.
3. **Allow when the parent `clubs` row is already gone.** Deleting a club cascades to `club_members`
   and the RI action fires after the parent is deleted, so `select 1 from public.clubs where id =
   old.club_id` finds nothing and the guard returns `old`. Without this rule **an owner cannot delete
   their own club**, which is a shipped feature with tests.

**Rule 3 is why the function is `security definer`, and that is correctness rather than convention.**
Under invoker rights the probe runs beneath the caller's RLS, so *"the club row is invisible to me"*
and *"the club row does not exist"* are the same empty result — and the guard's answer to the second
is to **permit the delete**. A guard that fails open is the exact hazard §D7 spends a section on for
assertions, and it must not then be left to chance in the guard itself. No exploit is reachable today
(every rider who can delete a `club_members` row is that row's own `user_id`, and `054`'s owner arm
plus `009`'s roster predicate mean they can see the club), but the property has to hold by
construction rather than by a coincidence of the current policy set.

**It lives in `private`, where `enforce-creator-membership` put its equivalent in `public` with a
`revoke`.** Both add no advisor; `private` makes that **structural** — `005` grants no USAGE to any
client role and PostgREST publishes only `public` — rather than dependent on a `revoke` surviving
`apply_migration`'s string round trip, which `021`'s footer records as a real failure mode. It is
also where `085`'s eight helpers and `036`'s fan-outs live, so it is the current convention.

**The guard keys on `clubs.owner_id`, never on `club_members.role`.** Those are two different answers
to "who owns this club" and they can disagree — `054` exists because they did, `088`'s
`promote_club_member` carries an explicit `target_rider = v_owner` arm commented *"054's ownerless
owner, whose row may say 'member'"*, and PD-128 is the whole story. `owner_id` is the one that
decides, everywhere: `clubs` UPDATE and DELETE, `delete_owned_club`, `is_club_admin_for`'s first arm,
and now this. `role` is the roster's **rendering** of that fact and is allowed to lag; a guard keyed
on `role` would let an ownerless owner delete a row the invariant needs and would refuse a delete on
a stale `owner` row for a club somebody else owns.

### D5 — The `is_default` club cannot be left, and this closes a gap `059` had to leave open

`059` §3 records the shape exactly: after `058` every rider joins the welcome club, so it always has
members and can never reach `032`'s "nobody left, delete it" arm — it **transfers**, to whichever
rider joined earliest. That rider then satisfies `delete_owned_club`'s entire access check, so `059`
added an `is_default` refusal there. What it could not fix is the transfer itself: `clubs.owner_id`
is `NOT NULL` with a CASCADE FK, so *"do not transfer"* is unavailable when the owner's account is
being erased — the alternatives are transfer or destroy the club and every postcard in it. `059`
recorded the result as a **known gap**: an ordinary rider holding rename and imagery rights over the
club everyone is in, reachable only by that club's owner deleting their account.

**A voluntary leave has the option `059` did not: the owner can simply stay.** So
`leave_owned_club` refuses the club carrying `clubs.is_default`, and arm 2 is already refused for it
by `delete_owned_club`. The welcome club is therefore unleavable and undeletable by any rider, by any
route, which is the correct weight for the club every rider is in — unflagging it is a deliberate act
needing database access, exactly as `059` argues.

Without this, the change would take `059`'s known gap from *"reachable only by an account deletion"*
to **one tap in the club menu**, and would do it silently.

**`42501`, and the message may be specific**, because `059` already settled this: *"Nothing is hidden
by the choice here — the caller can read `is_default`"*, `058` §2 having granted SELECT on that
column. So this refusal discloses nothing and can say what it means.

**On PROD today the only club is the welcome club**, so this refusal is the entire production
behaviour of this change until somebody creates a second club. The PR body says so.

### D6 — Lock order, and the concurrency cases it decides

**`clubs` → `club_members` → `profiles`, always.** Derived rather than chosen: `delete_owned_club`
locks `clubs` and nothing else; `088`'s three RPCs lock a `club_members` row and read `clubs`
unlocked; `032` locks `clubs` then `profiles`. No existing function takes them in the opposite order,
so this ordering introduces no cycle, and `leave_owned_club` taking all three is the union rather
than a new convention.

Three races, and each resolves without a new mechanism:

- **The owner leaves while the only admin is being demoted or removed.** `088` holds `for update` on
  that `club_members` row; §D3's select wants the same lock. One blocks. If the demotion commits
  first, the select's `role = 'admin'` predicate is re-evaluated after the lock is granted and the row
  is skipped — so the RPC correctly finds no successor and raises. If the transfer commits first, the
  demotion's own re-read finds `role = 'owner'` and `088`'s `v_role <> 'admin'` arm refuses it. Both
  orders are correct and neither needs a new guard.
- **The owner leaves while the only admin leaves.** The admin's `leaveClub` is a plain DELETE, which
  takes a row lock on the same `club_members` row. If the admin wins, the select skips them and the
  RPC raises. If the owner wins, the admin's row now says `role = 'owner'` **and `clubs.owner_id` is
  them**, so their DELETE meets the new guard and is refused with `23514`. They have become the owner
  and must use these same three arms. Nothing is lost and no club is orphaned — and note this second
  half **only works because `095` carries the guard**, which is a concrete argument for §D8's split.
- **The successor's account is deleted concurrently.** `for update of p`, `032`'s lock, unchanged.

### D7 — Which arm applies is a property of the table; which affordance is drawn is a property of the viewer, and the two are allowed to disagree

The obvious client is wrong and would look right:

```ts
// WRONG. Reads 0 other members for a healthy club whose only other member has blocked the owner.
const others = club.members_count - 1
```

`009`'s `club_members` SELECT predicate drops rows in **both** block directions, and `getClub`'s
`members_count:club_members(count)` embed runs under RLS. So every roster number a client can hold is
a **floor**, and `getClubDeletionImpact` already says so in as many words, phrasing its output *"at
least N"*.

**The rule this change adopts: the client picks the affordance, the database picks the arm, and every
disagreement is ordered so that it fails toward the less destructive outcome.** §D1 established that
a leave can never delete. The remaining disagreements resolve as:

| Client believes | Truth | What happens |
|---|---|---|
| others > 0 → draws *Leave club* | arm 1 | transfers. Correct |
| others > 0 → draws *Leave club* | arm 2 or 3 | RPC raises; client opens the delete sheet with its own counts and a second confirmation |
| others = 0 → draws the delete sheet | arm 2 | deletes. Correct |
| others = 0 → draws the delete sheet | arm 1 (a blocked admin exists) | the rider deletes a club that had a successor. **Destructive, and accepted** — see below |
| others = 0 → draws the delete sheet | arm 3 (a blocked member exists) | the rider deletes a club with a hidden member in it. **Destructive, and accepted** |

**The last two rows are the honest cost and they are accepted rather than solved, for one reason: they
grant no power the owner does not already have.** `ClubOptionsMenu` has carried an unconditional
*Delete club* row for the owner since PD-280. The sheet they land on is the same sheet, with the same
floors and the same confirmation. This change makes the destructive path *easier to reach by mistake*
for a blocked owner, and does not make it reach further. Making it reach less far — a privileged,
unfiltered count so the sheet could say *"this club has members you cannot see"* — would tell an owner
exactly how much content a rider who blocked them holds, which is what blocking exists to withhold and
which `getClubDeletionImpact`'s header already refuses to build.

**The one-bit leak, and why the refusal message is a single string.** If `leave_owned_club` said
*"promote someone to admin first"* for arm 3 and *"this club has no members; delete it"* for arm 2, an
owner blocked with their club's only member would be told **that a member exists whom they cannot
see** — one bit about a person a block is hiding, obtainable today by no other route (`088`'s three
RPCs and `delete_owned_club` all collapse to one raise site precisely to prevent that). So arms 2 and
3 leave by **one raise site with one message** that names both remedies and is true in either case:

> `this club has no other admin to take it on; promote another rider to admin, or delete the club`

Two consequences that must be carried into the code and the tests:

- Every assertion about the invariant runs with **RLS bypassed, or as the club's owner** — `reset
  role` / `set role postgres` around the check, not the suite's ambient `set role authenticated`. An
  assertion written under `authenticated` passes on a database full of orphans owned by riders the
  runner is blocked from.
- **No screen may be built to detect or report a hidden member.** There is nothing to detect, and a
  count that could distinguish "no members" from "members I cannot see" is a block-visibility leak.

### D8 — `enforce-creator-membership` is not superseded. The club-side DELETE guard moves here, and nothing else does

The brief offered two options — fold that change in and mark it superseded, or keep both with an
explicit ordering. **Neither is right, and the third option is better than both for a reason that
falls straight out of what that change actually contains.**

`enforce-creator-membership` covers **four** functions across **two** domains:

| | clubs | rides |
|---|---|---|
| **in** — seed the creator's row on INSERT | `establish_club_owner_membership` | `establish_ride_organizer_membership` |
| **out** — refuse deleting the creator's row | `protect_club_owner_membership` | `protect_ride_organizer_membership` |

PD-194 is **exactly one cell of that table**: the club-side *out* door. The ride half has nothing to
do with an owner leaving a club, and its own Q2 answered **no** to the analogous question and called
the asymmetry deliberate. Folding the whole change in would swallow the ride half as scope; making
this one depend on the whole change would park a decided feature behind 45 unchecked tasks that have
been open since 2026-08-07.

**So: the club-side DELETE guard moves into `095`, and `enforce-creator-membership` keeps everything
else** — both seeding triggers, the backfill, the ride-side guard, and `019`'s dead owner arm. That
change is **amended, not rewritten**: its reasoning is why this guard is shaped the way §D4 shapes it,
and §D4 cites it rather than restating it.

**The two changes then have no ordering constraint in either direction**, which is worth more than
the tidiness of one change, and it is checked rather than asserted:

- **`095` first.** The guard refuses deleting the row whose `user_id = clubs.owner_id`. A club with no
  such row (the state that change's seed exists to prevent) has nothing to guard, so the guard is
  silent and every arm still behaves — §D2 walks the ownerless owner through all three.
- **`enforce-creator-membership` first.** Its seed writes owner rows; its backfill inserts and
  repairs them. Neither is a DELETE, so `095`'s guard cannot interfere. Its `019` narrowing is
  INSERT-only and `095` writes `owner` by UPDATE inside a definer function.
- **Either, then the other.** The end state PD-103 and PD-194 jointly owe — *an owner always holds a
  `club_members` row with `role = 'owner'`, established by the database, and the only way out is arm 1
  or arm 2* — holds when **both** have landed, and each is independently correct before then. Neither
  is a half-invariant that breaks something.

**The collision that comes with it, and it is now three-way rather than two.** PD-103's body warns
that its delta *"collides with `add-account-deletion`"* and that both delta files carry a
coordination banner. That banner is itself **stale**: `manage-club-riders` also **MODIFIES** `Club
membership role SHALL NOT be self-assignable`, so **three** unarchived changes now replace the same
requirement wholesale and whichever archives last discards the other two.

This change **does not become the fourth.** Its `database-enforced-integrity` delta is **ADDED only**.
The transfer does write `role = 'owner'`, so a MODIFIED here would be defensible — and it would be
one more edit to a requirement that already has two competing versions. The rule this change actually
states is about **DELETE and about ownership**, not about role self-assignment, so it stands as its
own requirement and the reconciliation note lives in the banner instead. Task 9.3 extends
`enforce-creator-membership`'s banner to name the third change; reconciling the three texts is the
job of whichever archives first and is not this change's.

### D9 — Blocking does not filter the successor, and it does not filter the arm

The candidate query reads `club_members` inside a `security definer` function, so RLS does not apply
and a block between the leaving owner and a candidate admin is invisible to it. **That is the
decision, not an accident**, and there are three reasons:

- **A block is a relation between two riders, not a property of a club.** The leaver is leaving. The
  successor's fitness to run the club has nothing to do with whether the departing rider can see them.
- **Filtering would hand any admin a way to trap the owner.** Blocking is symmetric even though the
  row is directional (`002`), so an admin who blocked the owner would make themselves invisible to
  the successor query, drop the club to arm 3, and leave the owner with no exit but deleting a club
  full of other people's postcards. A rule an adversary can trigger by clicking Block is not a rule.
- **`032` already ignores blocks**, and it must, because an account deletion has no viewer at all. If
  `095` filtered and `032` did not, a club would inherit differently depending on why its owner left
  — which is the precise drift `enforce-creator-membership` §Q1 warned about, arriving through the
  door nobody was watching.

**Two consequences that must be stated rather than left to be discovered:**

- **The successor may be a rider the leaver cannot see.** So the confirmation must **not name them**.
  Naming requires a per-viewer read that returns nothing for a blocked admin, and the two available
  fallbacks are both bad: *"handing this club to someone"* is uninformative, and a privileged read
  that names them is a block-visibility leak. `Q4` carries the copy; the default is that the leave
  confirmation names the **rule** (*"another admin will take this club on"*) and never a person.
- **The block survives the transfer and stops mattering.** After arm 1 the leaver holds no roster row,
  so the two riders no longer share a club membership; `blocks` is untouched and every policy that
  reads it is unchanged. This change writes no row into `blocks` and reads none.

### D10 — What arm 1 leaves behind, table by table, and none of it is new machinery

`club_members` has **no child tables and no DELETE trigger**, so deleting the leaver's row deletes
exactly one row and nothing follows it. Everything else is an audience predicate re-resolving:

| Thing | After arm 1 |
|---|---|
| The leaver's **postcards in the club** | Stay. `postcards.club_id` is untouched and there is no cascade from `club_members`. The leaver **can no longer read their own postcard there**, because `009`'s club arm is membership — the same asymmetry a removed rider gets (`088`) and an ordinary leaver already gets |
| The leaver's **rides in the club** | Stay, and they keep organising them. `017`'s membership rule is on INSERT only; their `ride_members` rows are untouched |
| The leaver's **`feed_reads` watermark** | **Stays.** `feed_reads` cascades from `clubs` and `profiles`, never from `club_members` — see §Context, and the doc comment this corrects |
| The leaver's **notifications about the club** | Rows survive (`notifications.club_id` cascades from `clubs`, which still exists). For a **private** club they silently stop being returned, because `036` §3's SELECT conjunct resolves under the reader's own RLS — so they leave the list *and* the unread count with nothing written or deleted. `invalidateClubMembership` already invalidates `notifications.all()` for exactly this |
| The leaver's **club threads and messages** | Stay, authored by them, and become unreadable to them (`081`: a club's audience is the membership helper alone) |
| The club's **avatar and cover** | **Cleared** (`016`, §D2). The bytes stay in Storage under the leaver's uid prefix; the RPC returns both paths so the leaver's client can delete them, which is the only client that can |
| The **successor** | Gains `clubs.owner_id`: edit, delete (subject to `is_default`), `delete_own_club_message` / `moderate_club_thread` (`081`), `088`'s three RPCs over admins as well as members, and `085`'s join-request approval. They are told **nothing** — §Q3 |
| **Pending join requests** (`085`) | Untouched by a transfer. The new owner inherits them and `is_club_admin_for` resolves for them, so they can approve or decline |
| **Live ride invites and invite links** (`083`, `091`) | Untouched. They key on rides, not clubs |

### D11 — What arm 2 destroys, which is more than "the owner's own club"

Arm 2 runs `delete_owned_club` unchanged, so this is a restatement of an existing blast radius and
not a new one. It matters here because the confirmation's wording changes and the wording must not
shrink the truth:

- **Every postcard tagged to the club, including other riders' — and "no other members" does not mean
  "no other riders' content".** A rider can join a public club, post, and leave; nothing removes what
  they posted, and `032`'s pre-flight names `seed.sql`'s `...00e5` — captioned *"Posted before I
  left"* — as exactly that row. So a club with **zero** other members can still hold other people's
  postcards, and arm 2 destroys them. This is the strongest reason arm 2 goes through the existing
  sheet, whose counts already cover it, rather than through a one-line confirmation.
- Every `club_members` row, every `feed_reads` watermark, every notification about the club, every
  `club_join_requests` row (so a pending requester's ask vanishes and they are told nothing — their
  `089` decline notification cascades away too), and every `club_thread` with its `club_messages` and
  `club_thread_reads` behind it.
- Every ride in the club with `is_public = false`, and with each of those its `ride_members`,
  `ride_messages`, `ride_reads`, `ride_invites`, `ride_invite_links` and `ride_map_render_attempts`.
  A **public** ride survives with `club_id` NULL, keeping its crew, its chat and its invite links —
  `032` §2's rule, and the reason the predicate is the *ride's* own audience rather than the club's.
- **Storage**: the club's own avatar and cover come back for the client to delete;
  cascade-deleted postcards' images belong to other riders, sit under their uid prefixes, and are
  **permanently orphaned** (PD-94). Unchanged, and stated so the copy does not imply otherwise.

## Risks / Trade-offs

- **The successor is told nothing.** A rider can acquire a club, and the rename/delete rights that go
  with it, and find out by opening the club. §Q3 defers the notification with a reason (`089`'s
  exhaustive-switch ordering) rather than declining it, and it is the item most likely to come back
  as a complaint.
- **A transferred club loses its avatar and cover**, permanently and visibly, because `016` pins both
  to `owner_id`. §Q5 offers the alternative; the default is to accept it, since the alternative
  relaxes a CHECK whose whole job is keeping a Storage path under the uid whose policy governs it.
- **The one-bit disclosure in §D7**, accepted and argued, and the mitigation (one raise site, one
  message) is a real constraint on the copy rather than a note.
- **The guard is a trigger on a live write path.** Every ordinary member leaving any club runs new
  code inside their own transaction from the moment `095` applies, and a raise there takes their leave
  down. `036`'s hand-exercise gate is mandatory here; tasks 6.3 and 6.6.
- **Arm 1 ships unexercised by real data** — 0 `admin` rows on both projects. Its assertions are the
  only thing that will run it before a rider does.
- **An admin can choose the club's successor.** `088` lets an admin promote a member, and the
  successor is the longest-standing admin by `joined_at`, so promoting the club's earliest-joined
  member puts them at the head of the queue immediately. That is `088`'s own recorded trade — *"promoting
  a rider puts them first in line to inherit the club"* — arriving one step earlier than it did there.
  Not reopened; admins are trusted, an admin cannot promote themselves (`v_role <> 'member'` refuses a
  caller who is already an admin), and the owner-only gate `088` records as one conjunct away is still
  one conjunct away.

## Questions Closed

Every question this change answered, with **what would have to become true to reopen it**. A question
with no reopening condition is a decision, not an answer.

- **Should the RPC perform all three arms?** No — arm 1 only (§D1). *Reopens if* the client can be
  given a roster count that is neither stale nor block-filtered, which decision #2 forbids.
- **Should arm 2 have its own deletion SQL?** No — `delete_owned_club` (§D1). *Reopens if* arm 2 ever
  needs to destroy something that path does not, at which point that path is what changes.
- **Is the successor query shared with `032`?** No — two functions, one asserted ordering (§D3).
  *Reopens if* the product owner makes a voluntary leave fall back to a member, at which point the
  candidate sets coincide and the extraction `enforce-creator-membership` §Q1 asked for is correct.
- **Does the departing owner's roster row get demoted or deleted?** Deleted (§D2). *Reopens if* the
  transfer ever stops being one statement, which is `032`'s reason for demoting.
- **Does the guard key on `clubs.owner_id` or `club_members.role`?** `owner_id` (§D4). *Reopens if*
  those two ever become one column, which PD-128 and `054` say they are not.
- **Where does the guard's function live?** `private` (§D4), not `public` + `revoke` as
  `enforce-creator-membership` drafted. *Reopens if* something outside `private` ever needs to call
  it, which nothing can.
- **May the welcome club be left?** No (§D5). *Reopens if* `clubs.is_default` moves off that club, at
  which point it is an ordinary club and the refusal stops matching anything.
- **Does blocking filter the successor?** No (§D9). *Reopens if* blocking ever becomes a club-scoped
  concept rather than a rider-to-rider one — decision #2 says it is not.
- **Does the confirmation name the successor?** No (§D9, §Q4). *Reopens if* a privileged name read is
  ever acceptable, which §D7's argument says it is not.
- **Is `enforce-creator-membership` superseded?** No — the club-side guard moves, nothing else (§D8).
  *Reopens if* that change is archived or cancelled without shipping, at which point the ride half and
  the two seeds need a new home.
- **Does this change MODIFY `Club membership role SHALL NOT be self-assignable`?** No (§D8).
  *Reopens if* the three existing MODIFIED versions are reconciled into one, after which a fourth
  edit is merely an edit rather than a fourth competing replacement.
- **Does the transfer fire the participation gate or the join fan-out?** Neither — both are INSERT
  triggers and this is an UPDATE (§D2). *Reopens if* either gains an UPDATE arm, which task 0.4
  re-measures.

## Open Questions

Each carries a recommended default so the build is never blocked, and names who can answer it.

**Blocking — one, and it is the product owner's. ANSWERED 2026-08-31: the roster row is DELETED.**

- **Q1 — ANSWERED. Does an owner who leaves keep their membership of the club, as an ordinary
  member?** **No.** Put the two readings to the product owner on 2026-08-31 and they chose *they
  leave*: the membership row goes with the transfer, "Leave club" does what it says, and an owner
  who wants out of a club is out of it. If they want back in they join like anyone else. That is
  the default below, so §2.4 stands as written and §D2 needs no revision. **Stepping down — hand
  the club over and stay — is a separate affordance nobody has asked for**; it is not this row
  under a different name, and building it later means a new row rather than a changed one.

  The reasoning as it was put, kept because it is what makes the answer defensible: The decision says *"an owner can only leave a club"*, and "leave" plainly means out. But
  the alternative reading — *step down: hand the club over and stay as a member* — is a different and
  arguably kinder product, and it is what `032` does for a deleted account.
  **Default: leave means leave. The roster row is deleted** (§D2), and stepping down is a separate
  affordance nobody has asked for. It is blocking only because it changes step 8 from a `delete` to an
  `update`, which is a one-line change now and a migration later. If nothing answers, build the
  default.

**Non-blocking**

- **Q2 — ANSWERED 2026-08-31, and with it the larger question behind it: the successor set is
  ADMINS ONLY.** The product owner, restating the rule for this change: *"an owner can only leave a
  club if there is at least one more admin associated with it, or if it has no members."* Arm 3
  refuses, and refusing is the intended outcome rather than a default nobody chose.

  **This supersedes PD-194's body**, which was written 2026-08-11 and says *"if no left admins, admin
  is passed by to the rider who joined the longest time ago"* — a **member** fallback. That sentence
  is the standing record on the issue and it now reads as the opposite of what ships, so a reader
  arriving through Linear will re-derive the wrong rule from it. **This exact re-derivation has
  already happened once**, in the pre-merge review of this change, which is why the supersession is
  written here rather than left implicit and why it is also a comment on PD-194.

  What remains true from that body is the ORDERING — *longest time ago* — which `pick_club_admin_successor`
  applies within the admin set (§Q6). The `order by case m.role when 'admin' then 0 when 'member'
  then 1 else 2 end` in that function is `032`'s clause kept for diffability, and with the
  `and m.role = 'admin'` filter above it the `'member'` arm is unreachable by construction. Do not
  read it as a member fallback that has been disabled; read it as the shared shape, and see §D3 for
  why the query is copied rather than extracted.

  The original framing, kept because it is what makes the answer defensible: *should an owner be
  able to leave by promoting somebody in the same flow?* **No — two steps, no shortcut.** Promotion
  is an authorization decision (`088`'s whole argument); folding it into a leave would make one tap
  both promote a rider and hand them the club.
- **Q3 — product owner. Is the successor notified that they now own a club?**
  **Default: not in this change**, and it is the deferral most likely to be regretted. It needs a new
  `notifications.type`, a new `notifications_subject_shape` arm, and three exhaustive client switches
  (`notificationCopy`, `NotificationsListItem`'s `describe`, the type union) — which drags in `089`'s
  deploy-ordering rule and would make this change's ordering strictly harder for a benefit that is
  separable. File it as its own issue with the five-rating block rather than as a comment here.
- **Q4 — designer / product owner. Three strings.** (a) the owner's Leave row and its confirmation;
  (b) the arm-3 refusal; (c) the arm-2 wording on the existing delete sheet.
  **Defaults:** (a) *"Leave club — another admin will take this club on"*, naming the rule and never a
  person (§D9); (b) *"This club has no other admin to take it on. Promote another rider to admin, or
  delete the club."* — one string covering arms 2 and 3, per §D7's leak argument, so it must not be
  split into two however much clearer two would read; (c) the owner's own words, *"You are the only
  rider here — leaving deletes this club"*, **above** the sheet's existing counts and never instead of
  them (§D11: zero other members does not mean zero other riders' postcards).
- **Q5 — product owner. Should a transferred club keep its avatar and cover?**
  **Default: no, they are cleared** (§D2). Keeping them means relaxing `016`'s two path CHECKs so a
  path may sit under a uid that is not the current `owner_id`, which decouples the object from the
  Storage policy that governs it and would need a copy-on-transfer or a re-keyed path. `032` already
  accepts the clearing; this would be the change that reopens it for both.
- **Q6 — product owner. Is `joined_at` the right succession order, or should it be recency of
  activity?** **Default: `joined_at` ascending, tie-broken by `user_id`** — the owner's own 2026-08-11
  phrasing (*"passed by to the rider who joined the longest time ago"*), it is what `032` already
  does, and it is a rule SQL can evaluate from a stored column. Activity would need a definition, a
  column and a backfill.
- **Q7 — `data` agent. Should `095` also assert that no club is in the ownerless state?**
  **Default: assert the count and do not repair it.** The repair is
  `enforce-creator-membership`'s backfill and duplicating it here would put the same UPSERT in two
  files. Both projects read **0** today (proposal §Pre-flight), so the assertion is a tripwire rather
  than a migration.
