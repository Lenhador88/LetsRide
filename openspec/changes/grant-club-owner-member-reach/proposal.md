# A club's owner SHALL reach their own club as a member does

## Why

**`private.is_club_member` has no owner arm, so a club owner who holds no `club_members` row
loses their own private club's rides — and cannot create one in it either.** Re-verified against
DEV (`fpmrimzxadewsaiwpsel`) on 2026-08-12, chain at `053`, read from `pg_proc` and `pg_policies`
rather than recalled:

```sql
CREATE OR REPLACE FUNCTION private.is_club_member(target_club_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
  );
$function$
```

Membership table only. No `clubs.owner_id` arm. The `rides` SELECT policy resolves a club ride
through exactly that function, and so do nine other policies.

**It is not read-only.** `rides` INSERT carries the same predicate in its `WITH CHECK`, so the
club renders, its Rides sub-page renders, and the write is refused — the owner is locked out of
their own club's rides in both directions.

**`clubs` itself is fine and that is what makes this silent.** Its SELECT policy is
`is_public OR (owner_id = auth.uid()) OR private.is_club_member(id)` — an explicit owner arm.
So the club is visible, the screen loads, and only the rides inside it vanish. **One policy in
the caller set already got this right; the other nine did not**, and this change closes that
disagreement rather than patching the one symptom that got reported.

### The state is currently unreachable, and that is the reason to fix it now rather than later

Measured against both projects 2026-08-12, RLS bypassed:

| | DEV (`fpmrimzxadewsaiwpsel`) | PROD (`zwprydcyryvudhurbnye`) |
|---|---|---|
| Clubs | 4 | 2 |
| Clubs whose `owner_id` holds no `club_members` row | **0** | **0** |
| Private clubs in that state | **0** | **0** |
| Owner rows carrying the wrong `role` | **0** | — |
| Rides with a `club_id` | 2 | 2 |

**Read the zeros correctly.** No rider is in the broken state today, so nothing is on fire and
no backfill is owed. What the zeros do settle is that this can be fixed **constraint-first, with
no data migration and no rider-visible transition** — which is the cheapest this will ever be.
Two doors lead in, and the second needs nothing to fail: `createClub`'s two un-transacted inserts
(the subject of `enforce-creator-membership`), or an owner simply leaving —
`club_members` DELETE is `auth.uid() = user_id` with no owner carve-out, verified live.

## What Changes

- **`private.is_club_member` gains an owner arm.** One `CREATE OR REPLACE`, and all ten calling
  policies become correct together. The predicate becomes *"holds a membership row in this club,
  **or** is this club's `owner_id`"*.
- **The function is hardened while it is open.** It is the only function in `private` whose
  `search_path` is `'public'` rather than `''` — every other one, including `is_blocked`,
  `is_club_public` and `is_ride_crew`, uses the empty search path with schema-qualified
  references. The replacement SHALL schema-qualify `public.club_members` / `public.clubs` and
  set `search_path = ''`, matching its siblings. This is incidental to the bug and is included
  because the alternative is leaving a known inconsistency in a file being rewritten anyway.
- **The name does not change.** See `design.md` §D2 — a rename would mean recreating all ten
  policies for a naming gain, and the name becomes accurate again the moment
  `enforce-creator-membership` makes the owner row mandatory.
- **`COMMENT ON FUNCTION` states the two-arm contract**, so the next reader does not re-derive
  "this returns true for a non-member" as a bug.
- **No policy is recreated, no grant changes, no table changes, no application code changes.**

**Explicitly NOT in this change**, each with its reason:

- **Forbidding an owner from leaving** (issue option 3) — that is `enforce-creator-membership`'s,
  which already specifies a `BEFORE DELETE` guard on `club_members` refusing removal of the
  owner's row. Duplicating it here would put two changes on one policy surface. See §Relationship.
- **A "rejoin your own club" screen.** The database already permits it — `club_members` INSERT
  admits `role = 'owner'` when `clubs.owner_id = auth.uid()`, and its club arm reads
  `c.is_public OR c.owner_id = auth.uid()`, so an owner can rejoin even a **private** club they
  own. No screen offers it. After this change the owner no longer *needs* to rejoin to see or
  create rides, so the missing UI drops from a lockout to a cosmetic roster gap. Separate story.
- **Any owner or admin moderation power.** This change grants the owner a *member's* reach and
  nothing more. See the negative cases below.
- **The fan-out gap.** `private.notify_ride_created_in_club` reads `club_members` directly, so an
  ownerless owner is notified of nothing in their own club. This change cannot fix that and must
  not try: `event-fanout-integrity` requires the recipient set be computed by direct query,
  **never through a caller-relative helper**, and `is_club_member` is caller-relative
  (`auth.uid()`). The only fix is the membership row existing — which is
  `enforce-creator-membership`'s. This is the honest reason the two are complementary rather than
  alternatives.

## The option chosen, and what it widens

The issue offers three. **Option 1 — the owner arm in `is_club_member`.**

The enumeration below is why, and it is the substance of the decision rather than a formality.
**Ten policies call the function** (`pg_policies`, DEV, 2026-08-12; zero callers in `storage`,
zero in any other function, so this list is complete). For a rider who owns club C and holds no
`club_members` row in C:

| Table | Cmd | Policy | What the owner gains in C |
|---|---|---|---|
| `rides` | SELECT | Rides are viewable by the club, organizer and signed-in riders | **The reported bug.** Sees C's private rides. Block conjunct unchanged |
| `rides` | INSERT | Riders create rides, and only in clubs they belong to | **The reported bug.** Can create a ride in C |
| `rides` | UPDATE | Organizers update their own rides, within their own clubs | Can edit **their own** ride in C. Still `auth.uid() = organizer_id` |
| `club_members` | SELECT | Club rosters follow club visibility | Sees C's roster when C is private. Block conjunct unchanged |
| `postcards` | SELECT | Postcards are viewable by their audience | Sees postcards posted into C. Block and hide conjuncts unchanged |
| `postcards` | INSERT | Riders can post as themselves, into their own clubs | Can post into C |
| `postcards` | UPDATE | Authors can edit their own postcards | Can edit **their own** postcard in C |
| `feed_reads` | INSERT | Riders mark only their own audiences seen | Can set their own C watermark. Own-row |
| `feed_reads` | UPDATE | Riders advance only their own watermarks | Same. Own-row |
| `clubs` | SELECT | Clubs are viewable by members and signed-in riders | **Nothing — already has `owner_id = auth.uid()`.** No-op |

**Nine changes and one no-op, and every one of the nine is the same defect in a different
policy.** An owner locked out of their own club's postcards is not collateral damage from fixing
rides; it is the identical bug, unreported. Option 2 (rides-only) would fix the two symptoms
someone happened to file and leave seven behind, guaranteeing a second issue against `postcards`
and a third against the roster. Option 1 is *narrower in diff and wider in correctness*, which is
the pairing to prefer.

### The transitive widening — a grep for `is_club_member` misses all of it

Six further policies gate on a bare `EXISTS (select 1 from rides r …)` or
`EXISTS (select 1 from postcards p …)`, which is itself RLS-filtered, so they inherit the change
without naming the function. Enumerated because an unstated widening is exactly what
`openspec/config.yaml` warns becomes whatever the migration author assumed:

| Table | Cmd | Inherited effect |
|---|---|---|
| `ride_members` | SELECT | Owner sees the crew of C's now-visible rides. Block conjunct on `user_id` unchanged |
| `ride_messages` | SELECT / INSERT | The `EXISTS(rides)` conjunct flips true — **but `private.is_ride_crew` still gates, so no chat access is gained.** See negative case N7 |
| `postcard_comments` | SELECT / INSERT / DELETE | Follows postcard visibility. Owner sees and can write comments on C's postcards. DELETE still author-of-comment or author-of-postcard only |
| `postcard_likes` | SELECT / INSERT / DELETE | Same shape. DELETE still own-like only |
| `postcard_reports` | INSERT | Owner can report a postcard in C they can now see |
| `notifications` | SELECT / UPDATE | Only **their own** rows, whose referential-existence conjuncts may now resolve |
| `ride_map_render_attempts` | SELECT / INSERT | **Nothing** — organizer-only, no club predicate |

Every one of these is "the owner of C reaches, in C, what any member of C reaches". None
introduces a role the system does not have.

## Negative cases

Who must **NOT** gain sight of or power over what. Each maps onto an assertion — see `tasks.md`.

- **N1 — Non-member, non-owner.** A signed-in rider who neither owns C nor holds a row in it
  SHALL still read zero rides, zero postcards and zero roster rows for a private C. The arm keys
  on `clubs.owner_id` and on nothing else.
- **N2 — Ex-member.** A rider who leaves C and does not own it SHALL lose all reach immediately.
  The arm SHALL NOT key on membership history, only on current `clubs.owner_id`.
- **N3 — Admin.** An admin gains **nothing new**: `club_members.role = 'admin'` implies a
  membership row, so `is_club_member` was already true for them. **No admin arm is added**, and
  there is no `clubs.admin_id` column, so no ownerless-admin state exists to repair.
- **N4 — Blocked rider who owns a club. This is the one that must not regress.** In all four
  block-carrying policies the `private.is_blocked` call is a **separate conjunct outside** the
  `is_club_member` call, so widening the membership test cannot step past a block:
  - an owner who has blocked, or been blocked by, a ride's organizer SHALL still read zero rows
    for that ride, **even though they own the club it sits in**;
  - the same for postcards by a blocked author, their comments and their likes;
  - blocked riders SHALL remain absent from the roster the owner can now read.

  **Blocking wins over ownership, in both directions, silently.** Decision #2 is unaffected.
- **N5 — Cross-club.** Owning club A SHALL grant nothing in club B.
- **N6 — Signed-out visitor.** Gains nothing. `anon` holds zero grants on every table in the
  caller set, and the arm reads `auth.uid()`, which is NULL with no session. Asserted as a
  negative, per `openspec/config.yaml`.
- **N7 — Ride chat is NOT widened.** An owner who can now see a private club ride SHALL NOT be
  able to read or post in its chat unless they are its crew. `ride_messages` SELECT and INSERT
  call `private.is_ride_crew`, which this change does not touch, and `ride-chat`'s standing
  requirement *"Chat visibility SHALL be the intersection of ride visibility and crew membership,
  never crew membership alone"* is preserved — this change widens the ride half; the crew half
  still gates.
- **N8 — No moderation power is created.** The owner SHALL NOT be able to edit or delete another
  rider's ride in C (`rides` UPDATE/DELETE stay `organizer_id`-keyed), another rider's postcard
  (`postcards` UPDATE stays author-keyed), or another rider's comment beyond the existing
  author-of-the-postcard carve-out.
- **N9 — No eviction power.** `club_members` INSERT and DELETE are untouched. The owner SHALL
  still be unable to remove another member, and `club_members` still has no UPDATE policy.
- **N10 — No notification reach.** An ownerless owner SHALL still receive no
  `ride_created_in_club` notification, because the fan-out reads `club_members` directly. Stated
  so it is a known gap owned by `enforce-creator-membership` rather than an assumed fix.

## Relationship to `enforce-creator-membership`

**They should stay separate changes, and the split is already clean.** That change's proposal
states, in its own words, *"No SELECT policy changes at all, which is a deliberate property: this
change does not touch the visibility layer."* It owns the **cause** — an `AFTER INSERT` trigger
seeding the owner row, a `BEFORE DELETE` guard refusing its removal, and a backfill. This change
owns the **predicate**.

Folding them together would couple a 46-task integrity change (in progress, 3 tasks done) to a
one-function visibility fix, and would put a second change on a requirement that
`enforce-creator-membership` and `add-account-deletion` already contend for — a collision its own
delta spec carries a coordination warning about.

**Both are wanted, and neither subsumes the other.** The invariant makes the broken state
unreachable; the predicate makes the state harmless if the invariant is ever breached. An RLS
predicate SHOULD NOT depend on a data invariant enforced by a trigger elsewhere — that is the
defence-in-depth posture this repo already takes with the route guard versus RLS. And N10 is a
gap only the invariant can close. **Ship this one first**: it is one statement, it is safe against
the database exactly as it stands, and it does not need `enforce-creator-membership` to have
landed.

## Capabilities

### Modified Capabilities

- **`database-enforced-integrity`** — its requirement **`Ride visibility SHALL be stated per
  role`** is MODIFIED. That requirement enumerates six roles — organizer, club member,
  non-member/public, non-member/private, blocked, signed-out — and **has no club-owner scenario
  at all**. That omission is precisely PD-128: the role was never written down, so the policy
  silently became whatever the migration author assumed. `openspec/config.yaml` names owner,
  admin, member, non-member and blocked as the five that must each be stated; this requirement
  states three of them. It gains a **Club owner** scenario and an explicit **Club admin**
  scenario.

  The other seven standing specs were read. **`ride-chat` is deliberately NOT modified** — N7
  preserves its intersection requirement rather than changing it, and preserving a rule is not
  modifying it. `event-fanout-integrity`, `notifications`, `client-render-shell`,
  `client-cache-invalidation`, `client-session-storage` and `realtime-subscriptions` are
  untouched: no cache key, no fan-out, no channel and no screen state changes.

### New Capabilities

- **`club-owner-authority`** — the cross-cutting rule no standing spec owns: what a club's owner
  may reach in their own club, stated once for every table rather than per policy, plus the rule
  that an ownership arm SHALL NOT step past a block. This exists because the defect was ten
  policies disagreeing about one concept, and a rule written per policy is free to drift again.

## Impact

**Database.** One migration, one `CREATE OR REPLACE FUNCTION`, one `COMMENT ON FUNCTION`. Zero
policies recreated, zero grants changed, zero DDL on any table, no backfill. The next free
migration number is **`054`** — re-derive with `ls supabase/migrations/` against
`list_migrations` rather than trusting this line, which this repo has had wrong in both
directions.

**Rollback** is the current body, reproduced verbatim in `design.md` §D5 as a copy rather than a
reconstruction.

**Security advisors.** No new finding expected. `private.is_club_member` is already
`security definer`, `authenticated` holds no EXECUTE on the `private` schema, and neither
property changes — so the `authenticated_security_definer_function_executable` count SHALL stay
at 7. Verify after applying, per §Supabase Rules.

**Performance.** The added arm is a primary-key lookup on `clubs`, evaluated only when the
membership `EXISTS` returns false, and short-circuited by `or` otherwise. `rides` SELECT calls it
per candidate row.

**Code.** None. No `src/` change, so `tsc`, ESLint, `next build` and the unit suite are
unaffected by this proposal.

**Tests.** `supabase/tests/rls_test.sql` gains assertions per `openspec/config.yaml` — a policy
change with no new assertion is not finished. See `tasks.md` §3.

## Open questions

Each carries a recommended default so the build is not blocked.

- **Q1 (non-blocking, product owner).** Should the roster screen show an ownerless owner at all —
  as a member row, or as a separate "Owner" line read from `clubs.owner_id`?
  **Default: no change.** `enforce-creator-membership` makes the state unreachable, so building a
  screen for it is building for a state that is about to stop existing.
- **Q2 (non-blocking, agent).** Rename `is_club_member` to say what it now means?
  **Default: no** — see `design.md` §D2.
- **Q3 (non-blocking, product owner).** Is "owner reaches their own club as a member" the correct
  *product* rule, or should an owner be able to hold a private club they cannot read into?
  **Default: yes, as proposed.** Three existing behaviours already assume it — `clubs` SELECT's
  owner arm, `club_members` INSERT letting the owner rejoin a private club, and
  `notify_club_joined` unioning `clubs.owner_id` into the recipient set.
- **Q4 (blocking, agent — but answered).** Does the arm step past a block anywhere?
  **Answered: no**, verified conjunct by conjunct against `pg_policies`; task 1.2 re-verifies at
  build time rather than trusting this line.
