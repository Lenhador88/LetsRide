# An owner leaves their club

> **PD-194**, which also closes **PD-103**'s second half. Read both issue bodies before this file;
> both were read on 2026-08-31 and **neither carries a single comment**, so the body is the whole
> record and nothing has overtaken it.
>
> **PD-194's body contains one claim that is now false**, and it is the claim the whole story used
> to be blocked on: *"No club can have an admin today: `019` admits `member` only and
> `club_members` has no UPDATE policy, so nothing can promote one (live count of UPDATE policies on
> that table: 0)."* `088` (PD-326) shipped `public.promote_club_member` and
> `public.demote_club_admin` and is deployed on **both** projects — verified 2026-08-31 against
> `pg_proc` on `zwprydcyryvudhurbnye` and `fpmrimzxadewsaiwpsel`. The UPDATE-policy half is still
> true and is still 0; `088` deliberately writes through a `security definer` RPC instead. So the
> prerequisite PD-194 records as unbuilt is built, and arm 1 below is reachable for the first time.
>
> **What is still zero is the DATA, not the capability**: `select count(*) from club_members where
> role = 'admin'` is **0 on both projects**. Every club in the database today therefore falls to arm
> 2 or arm 3, and arm 1 is exercised only by a fixture until a rider promotes somebody.

## Why

**An owner cannot leave their club, and the reason is not a rule — it is the absence of one.**
`club_members` DELETE is `auth.uid() = user_id` with no owner exception (read from `pg_policy` on
DEV 2026-08-31, not recalled), so the database permits it; `ClubOptionsMenu` renders `Leave club`
only in its `!isOwner` branch, so the app does not offer it. The whole rule lives in a ternary in a
`.tsx` file, which `CLAUDE.md` is unambiguous is the weaker of the two places.

That has two consequences and they pull in opposite directions, which is why one change closes both:

- **A rider who wants out of a club they founded has no route that is not destructive.** Their only
  exit is `043`'s *Delete club*, which takes every other member's postcards with it. PD-194 exists
  because the product owner does not want that to be the only answer.
- **A rider who hand-rolls the request against the publishable key gets out anyway**, leaving
  `clubs.owner_id` pointing at a rider with no roster row. `054` (PD-128) made that state survivable
  — `private.is_club_member` gained an owner arm, so an ownerless owner still reaches their own club
  — but survivable is not legal, and nothing in the schema says it is not.

**The product owner decided the rule on 2026-08-31, and it is three arms:**

> *"194 an owner can only leave a club if there is at least one more admin associated with it, or if
> it has no members."*

and, for the club whose only member is its leaving owner: **delete it, with a confirmation** — the
Leave row becomes the existing Delete-club confirm sheet, worded for the case, and the club's rides
and tagged postcards go with it on the existing cascade.

| Arm | Condition | Outcome |
|---|---|---|
| **1** | At least one `club_members` row with `role = 'admin'` and `user_id <> clubs.owner_id` | The owner leaves. **Ownership transfers** to the longest-standing such admin, `joined_at` ascending, tie-broken by `user_id`. `clubs.owner_id` moves, the successor's row becomes `role = 'owner'`, the leaver's row goes — **one statement** |
| **2** | No `club_members` row for any rider other than the owner | The owner leaves, and leaving **deletes the club**, through `043`/`059`'s existing `public.delete_owned_club` and no second deletion route |
| **3** | Members exist, no other admin | **Refused**, with a message that names the remedy: promote somebody to admin first (`088`'s `promote_club_member`, one screen away at `routes.clubManage`) |

**PD-103 is the same rule from the other end, and this change is what closes its door.**
`enforce-creator-membership`'s own `design.md` §D3 says the invariant has two halves and that *"the
second one is the one the brief was not about"* — the way **out**. PD-103's body agrees that
`leaveClub`'s missing owner guard is the likelier door into the orphan state, likelier than the
create window the change was written about. Arms 1 to 3 are exactly the set of legal exits, so the
guard that refuses everything else is this change's to write. What that change does about it is
§`enforce-creator-membership` below — it is **not** superseded, and it is not a blocker either way.

**Three barriers make this an RPC rather than a policy change, and the first is missed by anyone who
starts at the policy** (PD-194's body derived all three; all three re-measured on DEV 2026-08-31):

1. `authenticated`'s UPDATE **column grant** on `clubs` is `avatar_path, cover_image_path,
   description, is_public, latitude, location_name, location_place_id, longitude, name` — **not
   `owner_id`** (`045`, widened by `066`). A client transfer fails `42501` on the grant *before* any
   policy is evaluated.
2. `clubs` UPDATE carries `using (auth.uid() = owner_id)` **and** `with check (auth.uid() =
   owner_id)`, which is also what stops a rider dumping a club on an unwilling stranger.
3. `club_members` has **no UPDATE policy at all** — three policies, `SELECT`, `INSERT`, `DELETE`, and
   `036` §7.6 rests on the absence.

Widening any of the three widens it for every other purpose too. And a fourth thing makes a
two-round-trip client version wrong regardless: **PostgREST has no transaction**, so a transfer done
as "update the club, then update the roster, then delete my row" tears into a club owned by one
rider whose roster says another.

**And a fifth barrier fires on the happy path, which is the one that is easy to miss.** `016`'s
`clubs_avatar_path_owned` and `clubs_cover_image_path_owned` pin both image paths to the row's
*current* `owner_id`, so **any** `update clubs set owner_id` raises `23514` while either is non-null.
The transfer clears both in the same statement, exactly as `032` does, and hands the surrendered
Storage paths back to the leaver — who is the only rider whose Storage policy can delete those bytes,
because they sit under their uid prefix.

## What Changes

- **One migration, `095_an_owner_leaves_their_club.sql`.** `092`, `093` and `094` are held by three
  concurrent changes; task 0.1 re-derives rather than trusting this line.
- **`public.leave_owned_club(p_club_id uuid) returns table (object_path text)`** — one new published
  `security definer` RPC. It performs **arm 1 only**, and raises for arms 2 and 3. Same return shape
  as `delete_owned_club` and `private.transfer_owned_clubs`, so the client's Storage sweep is the
  code it already has. **It takes a CLUB and nothing else** — no rider id, no successor id, no role
  argument — which is `085`'s and `088`'s shape and is what keeps `019`'s property that `admin` is
  claimable by no client, and its new corollary that **`owner` is nameable by no client**.
- **`private.pick_club_admin_successor(target_club uuid, departing uuid) returns uuid`** — the
  candidate query, in `private`, adding no advisor. It is deliberately **not** shared with `032`'s
  succession; §D3 argues why, and the shared part that must not drift is asserted rather than
  extracted.
- **`private.protect_club_owner_membership()` and its `before delete` trigger on `club_members`** —
  the guard PD-103 owes. Refuses a delete whose `old.user_id` is the club's `owner_id`; carries
  `when (current_user = 'authenticated')` so the transfer RPC and account deletion pass through it;
  and permits the delete when the parent `clubs` row is already gone, so deleting a club still
  cascades. **`security definer`, and for that third rule it is a correctness requirement rather than
  a convention** — under invoker rights *"the club is invisible to me"* and *"the club does not
  exist"* are the same empty result and the guard would **fail open**.
- **Arm 2 gets no SQL at all.** It is the existing `deleteClub` → `delete_owned_club` path, reached
  from the existing `DeleteClubSheet`, with copy for the case. Routing it anywhere else would
  duplicate `043`'s zombie-ride rule, `059`'s default-club refusal and the confirmation's blast-radius
  counts, and the duplicate is the copy that drifts.
- **Client.** `ClubOptionsMenu` grows a `Leave club` row in the **owner** branch;
  `src/lib/actions/clubs.ts` grows `leaveOwnedClub` and rewrites two stale doc comments;
  `DeleteClubControl` takes a `reason` prop so the same sheet can say why it is open. No new screen,
  no new route, no new component.

**Explicitly not in this change**, each because it is a separable decision rather than because it was
forgotten: a notification telling the successor they now own a club (§Q3 — it needs a new
`notifications.type` and `089`'s deploy ordering, which would make this change's ordering strictly
harder); an owner choosing their successor by hand; a "step down to admin without leaving" affordance;
and any relaxation of `016`'s path CHECKs so a transferred club could keep its imagery (§Q5).

## Capabilities

### New Capabilities

- **`club-ownership-succession`** — the rider-facing half. No standing spec owns "what happens to a
  club when the person who owns it stops wanting to": `database-enforced-integrity` owns write rules,
  `client-render-shell` owns first paint, and neither states the three arms, what the successor
  inherits, what the leaver keeps, or what the seven screen states are. It also owns the one rule that
  is easiest to lose in a refactor — that **no call a rider makes as "leave" may ever delete a club**.

### Modified Capabilities

- **`database-enforced-integrity`** — gains four **ADDED** requirements and **MODIFIES nothing**.
  That is a deliberate structural choice, not an oversight. `Club membership role SHALL NOT be
  self-assignable` is already being **MODIFIED by two unarchived changes at once** —
  `manage-club-riders` and `add-account-deletion` — and archiving folds a delta in by replacing the
  requirement wholesale, so whichever goes last silently discards the others. This change is the
  fourth that could plausibly touch it (the transfer writes `role = 'owner'`) and deliberately does
  not: its rule is *"an owner-membership row may be deleted only by these two routes"*, which is a
  statement about DELETE and about ownership, not about role self-assignment. §D8 carries the
  reconciliation note so the collision is recorded rather than joined.

  The other standing specs were read and are **not** modified, which is a claim rather than an
  omission:
  - **`client-cache-invalidation`** — checked against the code rather than assumed.
    `invalidateClubMembership` already invalidates `clubs.all()`, the club's postcard feed, the
    club's ride list **and `notifications.all()`**, the last for exactly the reason arm 1 needs
    (`036` §3's SELECT conjunct resolves per-reader, so a row can leave a list with nothing written
    or deleted). Arm 1 reuses it unchanged; arm 2 reuses `deleteClub`'s set unchanged.
  - **`client-render-shell`** — the Leave row is a new state of an existing menu, not a new screen,
    and its seven states are specified in the new capability rather than by widening this one.
  - **`client-session-storage`**, **`event-fanout-integrity`**, **`notifications`** — untouched.
    §Q3 is what would touch the last two, and it is deferred rather than silently skipped.

## Impact

**Database.** One migration. **One** new published function, **two** new `private` functions, one new
trigger. No new policy, no policy rewritten, no column added or dropped, no grant changed.

**Exactly ONE new security advisor**, taking
`authenticated_security_definer_function_executable` from **24 to 25** — re-derived rather than
quoted: `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where
n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')`
returns **24** on DEV, 2026-08-31, matching `CLAUDE.md`'s table. The one is
`public.leave_owned_club`, and it is narrow on `043`'s and `088`'s stated terms: it takes a **club
and nothing else**, it re-checks ownership in its own body where that check is the entire access
control, it writes three statements against one club, and it discloses one bit about a club the
caller already owns. `private.pick_club_admin_successor` and
`private.protect_club_owner_membership` add **none** — `private` has no USAGE for any client role
(`005`) and PostgREST publishes only `public`, which is `085`'s eight-private-functions-zero-advisors
shape and the reason the count moves by the number of **public** functions rather than of functions.

**`036`'s hand-exercise gate FIRES**, and this is the paragraph not to skim. The guard is a trigger on
a **live write path**: `leaveClub` runs today and every ordinary member leaving a club will execute
new code inside their own transaction from the moment `095` applies. A raise there takes that rider's
leave down with it. Exercise it by hand on DEV first and again on PROD, in a rolled-back transaction,
as `authenticated`, with rows counted rather than assumed — tasks 6.3 and 6.6.

There are **zero DELETE triggers on `club_members` today** (`select tgname from pg_trigger where
tgrelid = 'public.club_members'::regclass and not tgisinternal and (tgtype & 8) = 8` returns nothing
on DEV), so this is the first, and there is no trigger-name ordering interaction to reason about.

**Code.** `src/lib/actions/clubs.ts`, `src/components/clubs/ClubOptionsMenu.tsx`,
`src/components/clubs/DeleteClubControl.tsx`, one string in `src/types/index.ts` if the sheet's
reason is typed. No data-layer change: the arm the client offers is read from data it already holds.

**Tests.** Every task adding or changing SQL is paired with a task adding assertions to
`supabase/tests/rls_test.sql`, per `openspec/config.yaml`. The invariant is fully testable on plain
Postgres.

**Ordering.** `095` is **additive against the shipped bundle** and applies **before** the build that
serves the new row — `069`'s footing. The guard refuses nothing the deployed app does, because
`ClubOptionsMenu` renders `Leave club` only for a non-owner; the RPC is a function an older bundle
never calls. Nothing in this change is destructive, so there is no post-deploy step. `tasks.md` §7
carries it.

## Pre-flight — MEASURED 2026-08-31, RLS bypassed

Run through the Supabase MCP `execute_sql`, which runs as a privileged role, so these are true counts
and not per-viewer ones. **Read them per §D7: any of these counts taken under `authenticated` is a
defect**, because `club_members` SELECT drops rows in both block directions.

| Count | DEV `fpmrimzxadewsaiwpsel` | PROD `zwprydcyryvudhurbnye` |
|---|---|---|
| Clubs total / private / `is_default` | **12 / 1 / 1** | **1 / 0 / 1** |
| `club_members` rows by role | `owner=12, member=8` | `owner=1, member=1` |
| Clubs whose `owner_id` holds no roster row | **0** | **0** |
| Clubs whose owner's roster row is not `role = 'owner'` | **0** | **0** |
| Clubs with another rider at `role = 'admin'` (**arm 1 today**) | **0** | **0** |
| Clubs whose owner is the only member (**arm 2 today**) | **9** | **0** |
| Members of the `is_default` club | **6** | **1** |
| `profiles` | **21** | **5** |
| `establish_club_owner_membership` / `protect_club_owner_membership` | **absent** | **absent** |
| `remove/promote/demote_club_member` (`088`) | present | present |

**Three things those numbers settle, and one they do not.**

- **`enforce-creator-membership` has not shipped on either project.** Neither of its function names
  exists, and `club_members` carries only `enforce_participation_gate` and `notify_club_joined`. So
  this change cannot assume the seeding trigger or the backfill, and §D8 is written on that footing.
- **Arm 1 is unexercised in production data**, both projects. It ships correct-and-unreachable, the
  way `029`'s admin arm did until `088` — so its assertions are the only thing that will ever run it
  before a rider does, and task 5 treats them accordingly.
- **PROD's only club is the welcome club**, and §D5 refuses a leave on it. So the first production
  effect of this change is a refusal, and the only rider it can reach today is whoever owns
  `Welcome club`. Say that in the PR body rather than letting it read as a shipped feature nobody can
  use.
- **What they do not settle** is whether any of it is still true at apply time. Nine clubs sit one
  member away from changing arm, and a single `promote_club_member` call moves a club from arm 3 to
  arm 1. Re-run task 0.2 immediately before applying and record the result in `095`'s header, the way
  `013`, `019`, `022` and `043` do.

```sql
-- Which arm every club falls to right now. Run with RLS bypassed (§D7).
select c.id, c.name, c.is_default,
       (select count(*) from public.club_members m
         where m.club_id = c.id and m.user_id <> c.owner_id)                       as other_members,
       (select count(*) from public.club_members m
         where m.club_id = c.id and m.user_id <> c.owner_id and m.role = 'admin')  as other_admins
  from public.clubs c
 order by c.name;
```
