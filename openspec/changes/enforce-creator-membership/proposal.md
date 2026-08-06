# Enforce creator membership in the database

## Why

**`createClub` and `createRide` each do two inserts with no transaction, and the compensating
delete that used to cover that stopped being a rollback on 2026-08-06.** As Server Actions, both
inserts and the compensation ran inside one server request that completed whether or not the
rider's tab survived. They run in the browser now. Closing the tab, losing signal or killing the
app between the two round trips leaves:

- a **club with an `owner_id` and no `club_members` row**, or
- a **ride whose `organizer_id` holds no `ride_members` row**.

That state went from *reachable only on a Supabase error* to **reachable on demand**, and it is
logged as the first entry in `docs/HANDOFF.md` §Known issues.

**The real gap is not the missing transaction — it is that nothing asserts the invariant.** No
CHECK, trigger or constraint anywhere says "a club has an owner-membership row". PostgREST has no
multi-statement transaction, so *any* two-round-trip create has this window; making the window
smaller is not the fix, removing it is. Once the database establishes the membership row itself,
the client has one statement to issue and the intermediate state has no representation.

**Both call sites have named a `security definer` function as the fix since they were written, and
that is half right.** `security definer`, yes. A *function the client calls*, no — an RPC binds
only the callers that choose to call it, and this repo already ships a publishable key that lets
anyone insert into `clubs` directly. The shape that binds every writer is an `AFTER INSERT`
trigger. **This proposal contradicts two long-standing code comments and one `docs/HANDOFF.md`
entry, and corrects all three in the same change** rather than leaving a superseded claim behind.

**The damage is worse than "a UI orphan", which is what the existing notes say.** Measured against
the policy set rather than recalled:

| Orphan | Who can see it | What is broken |
|---|---|---|
| **Private** club | `008`'s `owner_id = auth.uid()` arm — the owner, and nobody else | It is on neither club list (`getYourClubs` reads membership, `getExploreClubs` filters `is_public`), so it is reachable from **no screen at all**, by anyone, including its owner. Only the owner's `clubs` DELETE policy could remove it and no screen offers delete |
| **Public** club | Everyone, on `/clubs/explore` | It shows on Explore **to its own owner**, because Explore excludes by membership. Tapping `Join club` inserts `role` defaulted to `'member'`, and `club_members` has **no UPDATE policy** (`019` Q10), so the owner is permanently recorded as a member of the club they own — an irreversible self-inflicted demotion reachable in two taps |
| Either | — | `private.is_club_member` has no owner arm, so the owner **cannot create a ride in their own club** (`017`), **cannot post a postcard to it** (`009`), and for a private one cannot read its own roster (`008`/`009`) |
| **Ride** | Everyone, if public | `toRideListItem` already draws the organizer "on the ride by construction"; `getRideCrew` reads `ride_members` only. So the ride card and `/rides/[id]/crew` **disagree about the same ride**, and `RideAttendanceBar` is hidden from the organizer (`!is_organizer`), so they have no way to put themselves back |

**And the create window is not the only door to that state. It is not even the likely one.**
`leaveClub` has no owner guard — its own comment says so — and `club_members` DELETE is
`auth.uid() = user_id` with **no owner exception** (verified live against `pg_policy`, not
recalled).

**There is no UI guard either, and an earlier revision of this paragraph said there was.**
`ClubMembershipButton` contains no owner branch of any kind. `/clubs/[id]/about` renders it as
`isMember={!!club.data.viewer_role}`, and `viewer_role` is `'owner' | 'admin' | 'member' | null`
(`src/types/index.ts`), so `'owner'` is truthy and the button reads **"Leave Club"**. Every
verified link in the chain:

| Step | Evidence |
|---|---|
| Owner opens their own club's About page | `src/app/(app)/clubs/[id]/about/page.tsx:104` |
| Button renders "Leave Club" for them | `isMember={!!viewer_role}`; no owner branch in `ClubMembershipButton.tsx` |
| Tap calls `leaveClub(clubId)` | `ClubMembershipButton.tsx:43` |
| Action deletes unconditionally | `src/lib/actions/clubs.ts:281` — no owner check |
| RLS permits it | `club_members` DELETE policy = `auth.uid() = user_id`, no owner arm |

So the orphan state is reachable by **a club owner tapping a visible button on their own club,
once**. No tab close, no lost signal, no hand-rolled request, no race. The create-window race
this proposal is named for is the *narrower* of the two doors.

That also changes the urgency: the create window needs an accident, and this needs a rider
doing something the interface openly invites. The same shape applies to
`setRideAttendance(rideId, null)` for an organizer. **A fix that closes only the create window
leaves the wider door open**, so this change states the invariant and closes both.

Integrity, not confidentiality. `019` already prevents the abandoner forging a role on the way
through — verified against the migration, whose INSERT policy admits `role = 'owner'` only when
`clubs.owner_id = auth.uid()`. Nothing here changes what anyone can *see*.

## What Changes

- **The database establishes creator membership**, in the same statement as the row it belongs to.
  An `AFTER INSERT` trigger on `clubs` writes `(new.id, new.owner_id, 'owner')`; an `AFTER INSERT`
  trigger on `rides` writes `(new.id, new.organizer_id, 'going')`. Both derive every value from
  the row being inserted and **take no caller input at all**, so there is no id to pass and
  nothing to pass someone else's id *to*.
- **The invariant is asserted on the way out as well as the way in.** A `BEFORE DELETE` guard on
  `club_members` refuses removal of the row whose `user_id` is the club's own `owner_id`, and on
  `ride_members` the row whose `user_id` is the ride's `organizer_id`. Both allow the delete when
  the parent row is already gone, so deleting a club or a ride still cascades.
- **Both create actions lose their second insert and their compensating delete.** `createClub` and
  `createRide` become one round trip each, `useActionState` unchanged, and the message *"That club
  was only partly created"* becomes unreachable and is deleted rather than left as dead copy.
- **Existing orphans are backfilled**, with `joined_at` taken from the parent row's `created_at`
  rather than `now()`. This deliberately differs from `023`'s **no-backfill** ruling and the
  difference is the point: `023` refused to write a consent timestamp because a fabricated record
  of a person's *act* is worse than a missing one. An owner-membership row records no act — it is
  derived from `clubs.owner_id`, which is already stored, and is exactly the row `createClub`
  would have written.
- **New migrations, split in two** for the reason `021` was split — the two halves are safe at
  different moments relative to the code deploy:
  - **`029_creator_membership.sql`** — the two seeding triggers, the two delete guards, and the
    backfill. Additive: nothing the application reads is removed.
  - **`030_club_member_owner_arm.sql`** — removes `019`'s `role = 'owner'` INSERT arm, which is
    dead the moment the trigger owns that row. Applies only *after* the code stops sending
    `role: 'owner'`, and strictly narrows what `authenticated` may claim.

  The next free number is **`029`** as of 2026-08-06 — `028_refresh_stale_column_comments` took
  `028` today. Re-derive with `ls supabase/migrations/` against `list_migrations` rather than
  trusting this line; it is the exact claim this repo has had wrong in both directions.
- **`getRideCrew` is deliberately not changed.** After the trigger, the rows agree with
  `toRideListItem`'s "on the ride by construction" reading by construction. Teaching the crew read
  to synthesise an organizer row would be a second copy of that rule, free to drift — the mistake
  `getExploreClubs`'s header describes and `getYourClubs`'s header declines to make.

**Explicitly not in this change:** ownership transfer (that is `add-account-deletion`'s, and it
needs `016`'s `clubs_avatar_path_owned` / `clubs_cover_image_path_owned` CHECKs relaxed, since both
pin the image path to the row's current `owner_id` and therefore make any `update clubs set
owner_id` raise `23514`); an admin or invitation flow; a club-delete or ride-cancel screen; and
`max_riders` enforcement, which `023`'s standing spec already records as deliberately unenforced.

## Capabilities

### Modified Capabilities

- **`database-enforced-integrity`** — yes, and this is the honest answer rather than the
  convenient one. That capability's stated purpose is *"every write rule that must still hold when
  the browser is the only caller"*, which is this change's entire subject. It gains the
  creator-membership invariant, and one of its existing requirements changes shape:

  - **`Club membership role SHALL NOT be self-assignable`** is **MODIFIED**. Its scenario *"The
    creator's own owner row is still permitted"* describes a write the creator no longer makes —
    the trigger makes it, deriving `user_id` from `owner_id`. `030` removes the policy arm that
    permitted it, so `authenticated` ends up unable to insert `role = 'owner'` **or** `'admin'` by
    any route. That is strictly narrower than `019` and it changes a requirement a reviewer would
    otherwise expect to still be true.

  The other three standing specs were read and are **not** modified, which is a claim this section
  is making rather than an omission:
  - `client-render-shell` — this change *removes a cause* of a state its "permission-denied and
    empty" requirement covers (an orphan roster reading as empty). Removing a cause is not
    changing the rule.
  - `client-cache-invalidation` — the invalidation sets of `createClub` and `createRide` are
    unchanged; one round trip invalidates exactly what two did.
  - `client-session-storage` — untouched.

### New Capabilities

- **`atomic-resource-creation`** — the rider-facing half, which no standing spec covers. The
  existing specs cover first paint, reads, cache keys and session storage; none of them states what
  a *create* guarantees. This owns: a create is one statement or it did not happen; what the rider
  sees when it fails, when they are offline, and when they submit twice; and the rule that no
  future create may reintroduce a compensating delete in application code.

## Impact

**Database.** Two migrations. Four new triggers, two new `security definer` trigger functions
(both `revoke all … from public, anon, authenticated`, so **neither adds a security-advisor
finding** — the advisor fires on definer functions `authenticated` can execute, which is why
`enforce_participation_gate` is absent from `CLAUDE.md`'s table of six). One backfill. One policy
narrowed. **No SELECT policy changes at all**, which is a deliberate property: this change does not
touch the visibility layer.

**Code.** `src/lib/actions/clubs.ts` (`createClub` loses ~20 lines, `leaveClub` gains an
owner-refusal message), `src/lib/actions/rides.ts` (`createRide` the same). No component changes,
no new types, no data-layer changes.

**Tests.** Each migration pairs with assertions in `supabase/tests/rls_test.sql` per
`openspec/config.yaml`. The invariant is fully testable on plain Postgres — it needs no Supabase
service, which is unusual for this repo and worth using.

**Sequencing.** Three steps, and the order is load-bearing. See `design.md` §D6.

1. Deploy the actions with their second insert made **idempotent** (`upsert … ignoreDuplicates`,
   the shape `joinClub` already uses). Safe against the database as it stands today *and* against
   the one `029` produces.
2. Apply `029`.
3. Deploy the actions with the second insert and both compensating deletes removed, then apply
   `030`.

Applying `029` before step 1 makes the client's second insert raise `23505`, its rollback delete
the club, and every club and ride creation fail — an instant outage, and the same class of
deadlock `021`'s header dissects.

**A pre-flight this session could not run, stated as a gap rather than assumed away.** The counts
below are **NOT MEASURED**. The hosted project is reachable — `curl -x $HTTPS_PROXY
https://zwprydcyryvudhurbnye.supabase.co/auth/v1/health` returns `401`, verified 2026-08-06 — but
this container holds no `.env.local`, no rider credential, and the Supabase MCP tools did not load
in this session (`mcp__…__list_tables` → *No such tool available*). `anon` holds zero grants, so an
unauthenticated read answers nothing. **Task 0.1 is blocking and must run these before `029` is
written**, with RLS off (dashboard or `list_migrations`-grade access), because under a rider's
session `club_members` is filtered by `009`'s block predicate and the count would be per-viewer:

```sql
-- Orphan clubs, and how many are private (reachable from no screen at all)
select count(*) filter (where not c.is_public) as private, count(*) as total
  from public.clubs c
 where not exists (select 1 from public.club_members m
                    where m.club_id = c.id and m.user_id = c.owner_id);

-- Clubs whose owner holds a membership row with the WRONG role — the
-- self-repair-via-Explore case, which the backfill must NOT skip
select count(*) from public.clubs c
  join public.club_members m on m.club_id = c.id and m.user_id = c.owner_id
 where m.role <> 'owner';

-- Orphan rides, split by whether they have already departed
select count(*) filter (where r.departure_at >= now()) as upcoming, count(*) as total
  from public.rides r
 where not exists (select 1 from public.ride_members m
                    where m.ride_id = r.id and m.user_id = r.organizer_id);
```

The last numbers this repo recorded are `019`'s pre-flight of 2026-08-05 — 3 `club_members` rows,
2 with `role = 'owner'` — and `022`'s of the same day — 3 rides, 0 with a `club_id`. Neither
answers the orphan question, and both predate the client-render deploy that made the window
reachable on demand. **Do not treat them as a zero.**
