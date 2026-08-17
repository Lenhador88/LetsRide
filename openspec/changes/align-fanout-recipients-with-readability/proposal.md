# A fan-out's recipient set SHALL be the set that can read the row

## Why

**Two notification fan-outs address recipient sets their subject's SELECT policy does not
resolve, and they have drifted in opposite directions.** `036` §7.5 names the class in its own
words — *"a row nobody can ever read is worse than no row: nothing raises, no count moves, no
assertion fails."* Both halves are that failure, one from being too wide and one from being too
narrow, and neither has a symptom.

**Provenance of the facts below, stated exactly, because an unlabelled inference must never read
as a measurement** (`CLAUDE.md` §Working Principles). They were **transcribed** from `055`'s
migration header, the committed migration files and `supabase/tests/rls_test.sql` while this
proposal was written — the session writing it held no database tool — and then **confirmed against
DEV (`fpmrimzxadewsaiwpsel`) at build time on 2026-08-17**, where every one held: `rides` SELECT's
`qual` is verbatim as quoted below, `clubs` SELECT is
`(is_public OR (owner_id = auth.uid()) OR private.is_club_member(id))`, `is_club_member` has
exactly **10** calling policies, the security advisors are **9** with the definer-executable count
at **7**, and `list_migrations` read 59 before `060` and 60 after.

Re-verify at the next build rather than trusting this paragraph — it is a dated snapshot, and
`tasks.md` §1 is written to take the readings again rather than to read them here.

### Half 1 — `ride_joined` is too wide

`055` widened `ride_joined` from the organizer alone to the whole crew. `rides` SELECT, verbatim:

```
((organizer_id = auth.uid()) OR ((NOT private.is_blocked(auth.uid(), organizer_id))
 AND ((is_public AND ((club_id IS NULL) OR private.is_club_public(club_id)))
      OR ((club_id IS NOT NULL) AND private.is_club_member(club_id)))))
```

**There is no `ride_members` arm and no `is_ride_crew` arm.** The three ways into a ride are
organizer, public, and club member. So *"is on this crew"* and *"can see this ride"* are
different sets, and a `ride_members` row survives every event that takes the ride away. Two
measured routes produce a permanently-addressed, permanently-unreadable row:

- **(a) A block.** A crew member on a **public** ride who blocks the organizer keeps their
  `ride_members` row and reads the ride as zero rows — the organizer arm is not theirs, and the
  second disjunct is gated on `NOT private.is_blocked(...)`.
- **(b) Leaving a club, with no block anywhere.** A crew member RSVPs to a **private** club's
  ride, then leaves the club. `club_members` DELETE is a bare `auth.uid() = user_id` and nothing
  reaches `ride_members`, so they stay on the crew and lose the ride.

Both are already pinned in `supabase/tests/rls_test.sql` as `KNOWN GAP` — **055.6** and
**055.6b** — with 055.6b's own label recording why the obvious half-fix is refused: *"a fan-out
that only excluded riders blocked with the organizer would close 055.6 and miss this one
entirely."*

### Half 2 — `ride_created_in_club` is too narrow

`036` §7.5 excludes `clubs.owner_id` from the `ride_created_in_club` recipient set. Its
justification was correct when written: `private.is_club_member` read `club_members` only, with
no owner arm, so a row written to an ownerless owner was one their own SELECT policy discarded on
every read, for ever.

**`054` gave `private.is_club_member` an owner arm** (PD-128). An ownerless owner now resolves
their own private club's rides, which the suite already asserts under the `036/054:` label —
*"was 0 until 054 gave is_club_member an owner arm, so the withheld notification above is now a
gap rather than a consequence."* The narrowing survives; its reason does not.

**Two stale comments carry that reason forward, not one.** `036` §7.5's prose, and the live
`comment on function private.notify_ride_created_in_club()`, which `059` re-issued verbatim —
*"rides SELECT's only club arm is private.is_club_member, which has no owner arm"* — three
migrations after that stopped being true. A future session reading the object rather than the
file gets the same wrong answer.

### Why now

Half 2 is a live product defect: the owner of a private club is the one rider guaranteed to care
about a ride created in it, and they are the only member who is never told. Half 1 accumulates
rows that render nowhere and are removed only when their subject is deleted, which is a retention
question as well as a correctness one. And the two halves share one instrument — a visibility
predicate that takes its **subject** as an argument — so building it once is cheaper than building
it twice and much cheaper than leaving one half open with the other closed.

## What Changes

**Nothing outside the `private` schema, and no policy at all.**

- **`private.can_read_ride(candidate uuid, target_ride uuid) returns boolean`** — new.
  `security definer`, `stable`, `set search_path = ''`, in `private`, **`EXECUTE` revoked from
  `public`, `anon` and `authenticated`.** It restates `rides` SELECT with `candidate` substituted
  for every `auth.uid()`. This is the shape `036` trap (c) demands of any predicate a fan-out
  applies per candidate, and the shape `055`'s header already named as the only one that closes
  both routes at once.
- **`private.can_read_club(candidate uuid, target_club uuid) returns boolean`** — new, same
  hardening, same revokes. It restates `clubs` SELECT with `candidate` substituted:
  `c.is_public or c.owner_id = candidate or private.is_club_member_for(candidate, c.id)`.
  **It exists because a `ride_created_in_club` row carries two subjects and `036` §3 tests them
  independently** — see the second bullet under `notify_ride_created_in_club` below.
- **`private.is_club_member_for(candidate uuid, target_club_id uuid) returns boolean`** — new.
  Holds `054`'s two-arm body: a `club_members` row in the club, **or** `clubs.owner_id`.
  Same hardening, same revokes.
- **`private.is_club_member(uuid)` becomes a one-line wrapper** —
  `select private.is_club_member_for(auth.uid(), $1)`. **One body, two entry points**, so the
  caller-relative predicate in ten policies and the candidate-relative one the fan-outs use are
  **asserted to share a body** rather than merely intended to. Signature, OID and grants are
  unchanged, so **no policy is recreated and none of the ten callers changes**.

  **What asserts it, and why the obvious assertion is not enough.** The `rides` `qual` pin
  (§*The residual hazard*) does not reach the helper bodies that text delegates to: an arm added
  to the **wrapper** — `select private.is_club_member_for(auth.uid(), $1) or exists (…)` — leaves
  `rides` SELECT's text unchanged, still satisfies a `like '%is_club_member_for%'` match, and
  makes `can_read_ride` silently **narrower** than the policy. That is PD-211's own shape,
  one level down. The suite therefore pins `is_club_member`'s `prosrc` by **equality**, not by
  `like`, so the wrapper cannot grow an arm without failing.
- **`private.notify_ride_joined()`** applies `can_read_ride(recipient, new.ride_id)` **after the
  union, never inside an arm** — `036` §7.6 and `055`'s own rule, because a rider can qualify
  through both arms and filtering inside one leaves them in through the other. **It deliberately
  does NOT call `can_read_club`**: a `ride_joined` row leaves `club_id` NULL, so `036` §3's
  club conjunct is vacuous for that type. The asymmetry is pinned by assertion **in both
  directions**, because an unasserted deliberate omission is indistinguishable from a missed one.
- **`private.notify_ride_created_in_club()`** unions `clubs.owner_id` into the candidate set and
  filters the whole union by **both** `can_read_ride(recipient, new.id)` **and**
  `can_read_club(recipient, new.club_id)`. The recipient set becomes **measured** rather than
  derived from a claim about another function's body — which is the drift this change exists to
  end. `059`'s early return for the club carrying `clubs.is_default` is **reproduced verbatim**
  and must not be lost.

  **Both conjuncts, because the row has two subjects and `036` §3 tests them independently.**
  Its conjuncts 4 and 5 require the ride **and** the club each resolve for the reader, and it
  forbids in as many words deriving one from the other: *"Ride-implies-club is a derivation from
  today's policy text and SHALL NOT be relied on."* Filtering on `can_read_ride` alone would be
  exactly that derivation. **It excludes nobody today** — every candidate is a `club_members` row
  or `clubs.owner_id`, and both satisfy `clubs` SELECT — which is precisely the state `036` §7.5
  was in when it was written, and the reason to install the conjunct now rather than after it
  bites. The reachable state that opens it is the one `041` already names: `clubs` SELECT gaining
  a block predicate, after which a member blocked with the **club owner** but not with the **ride
  organizer** passes `can_read_ride`, fails `clubs` SELECT, and holds a permanently unreadable
  row.
- **Both stale comments are replaced**, and the `comment on function` is re-issued so the object
  and the file say the same thing.

**Explicitly not in this change:**

- **No DDL on any table. No new type. No new grant to any client role. No change to any RLS
  policy. No `src/` change.** `tsc`, ESLint, `next build` and `npm run test:unit` are not gates
  for it; `npm test` is.
- **No retraction trigger** on `ride_members` or `club_members` DELETE. `notifications`' standing
  spec forbids one in as many words, and a rider who becomes unable to read a ride keeps rows
  that the read policy already discards — an eviction, not a deletion, reversible on unblocking
  or rejoining.
- **No crew arm on `rides` SELECT.** See below; it is refused rather than deferred.

## The option refused, and why it is wrong rather than merely expensive

PD-211 offers two ends for half 1. The cheap end — **giving `rides` SELECT a crew arm** — would
make the gap disappear with no fan-out change at all. It is refused on two measured grounds.

### 1. It breaks blocking, or it does not do the job

A crew arm written as a **top-level disjunct** sits outside the
`NOT private.is_blocked(auth.uid(), organizer_id)` conjunct, so a rider who blocked the organizer
would read the ride again through a stale roster row. Architectural decision #2 is explicit that a
blocked rider disappears from ride crews, and `grant-club-owner-member-reach`'s `design.md` §D4
makes the same **domination** argument in the other direction: an arm is safe only if no
assignment satisfies the policy through it while the governing `is_blocked` conjunct is false.

Put the crew arm **under** the block conjunct instead and route (a) stays open — a blocked crew
member still cannot see the ride, which is correct — while route (b) closes. That reads as a
complete repair and is a half-fix, exactly the shape 055.6b's label warns about.

### 2. It silently widens two other audiences

`034`'s `ride_messages` SELECT and INSERT are an **intersection**:
`exists (select 1 from public.rides r where r.id = ride_messages.ride_id)` — evaluated under the
caller's own RLS — **AND** `private.is_ride_crew(ride_id)`. `034`'s own `comment on table` says
why: using the crew helper alone *"lets an ex-club-member read a private ride's chat"*, a leak it
shipped in draft and fixed. **A crew arm in `rides` SELECT collapses that intersection**, because
the RLS-filtered `EXISTS` becomes implied by the crew conjunct — to the crew alone under the
top-level placement, and to `crew ∧ ¬blocked` under the placement beneath the block conjunct.
**`034`'s named victim, the ex-club-member with no block anywhere, returns under both**, so the
refusal does not depend on which placement is chosen. It would re-open, from the other side, the
exact leak `034` closed — and `ride-chat`'s standing requirement
*"Chat visibility SHALL be the intersection of ride visibility and crew membership, never crew
membership alone"* would be false while its policy text was untouched.

`041`'s postcard ride-tag `WITH CHECK` has the identical shape —
`ride_id is null or (exists (select 1 from public.rides r where r.id = ride_id) and
private.is_ride_crew(ride_id))` — and collapses the same way.

**So the fan-out narrows to the readable set instead.** That is the direction that cannot leak:
the read policy still decides what anyone sees, and a fan-out change can only ever remove a row
from a list, never add one to a screen.

## Negative cases

Each is a statement about a role and a resource, so each maps onto an assertion — see `tasks.md`
§3. **N1–N10 are the negatives. N11 is the one rider who must NOW receive a row and does not.
N12–N14 are the positives that must not regress. N15–N19 are the read-side properties this change
must be shown *not* to have touched.**

### Who must NOT receive a row

- **N1 — A crew member blocked with the organizer.** A rider holding a `ride_members` row who has
  blocked, or been blocked by, `rides.organizer_id` SHALL receive **no** `ride_joined` row.
  `can_read_ride` fails for them on the same `is_blocked` conjunct their own read fails on.
  **055.6 flips from "row written, unreadable" to "no row written".** Blocking is symmetric
  though the row is directional, so the assertion SHALL be run with the pair exchanged.
- **N2 — A crew member who left the private club.** A rider holding a `ride_members` row for a
  ride in a private club they have since left SHALL receive **no** `ride_joined` row, **with no
  block anywhere in the fixture**. **055.6b flips the same way.** This is the route the cheap
  half-fix misses, and it is asserted separately for that reason: a single assertion cannot say
  which conjunct did the work.
- **N3 — The actor themselves, through either arm.** An organizer RSVPing to their own ride is
  `rides.organizer_id` **and**, one statement later, a `ride_members` row. They SHALL receive
  nothing. The exclusion SHALL sit in the outer `WHERE`, after the union — filtering inside the
  crew arm leaves them in through the organizer arm and tells every organizer they joined their
  own ride.
- **N4 — Everybody, for a ride in the club carrying `clubs.is_default`.** Zero
  `ride_created_in_club` rows, for every rider including the club's owner. `059`'s early return
  SHALL be reproduced verbatim and SHALL sit **ahead** of the owner union, or adding the owner
  re-opens an app-wide broadcast any rider can fire at will by creating a ride in the welcome
  club.
- **N5 — Everybody, for a ride with `club_id is null`.** Zero rows. A ride with no club has no
  audience to address, and a public ride SHALL NOT be fanned out to every signed-in rider.
- **N6 — A club member blocked with the organizer.** Unchanged from `036`, and it SHALL be
  asserted again after the union is widened, because a new arm is a new way past a filter that
  used to sit on a single arm.
- **N7 — A club owner blocked with the organizer.** The newly-unioned owner SHALL be dropped by
  the same block conjunct as any member. **Ownership SHALL NOT step past a block**, in either
  direction, matching `club-owner-authority`'s rule that an ownership arm never dominates one.
- **N8 — A `ride_created_in_club` candidate who cannot resolve the CLUB, whatever their reach to
  the ride.** A recipient SHALL satisfy `can_read_club(recipient, new.club_id)` as well as
  `can_read_ride`, because `036` §3's conjuncts 4 and 5 test the two subjects **independently**
  and it forbids deriving either from the other.

  **This excludes nobody today and is installed anyway**, which is the whole point of stating it
  as a negative: every candidate is a `club_members` row or `clubs.owner_id`, and both satisfy
  `clubs` SELECT, so a recipient count cannot exercise the conjunct at all. The suite therefore
  exercises `can_read_club`'s three arms **directly**, because a conjunct nothing exercises is
  one a later edit deletes silently. The reachable state that opens it is the one `041` already
  names — `clubs` SELECT gaining a block predicate — after which a member blocked with the
  **club owner** but not with the **ride organizer** passes the ride test, fails the club test,
  and would hold a permanently unreadable row.
- **N9 — A rider on the crew with a status outside `{going, maybe}`.** The crew arm names both
  statuses, which is total against today's `ride_members_status_check` and therefore excludes
  nobody. It SHALL stay asserted, because a third status added later silently changes who is
  notified rather than failing.
- **N10 — A signed-out visitor.** Receives nothing and can read nothing: `anon` holds no grant on
  `notifications`, and a fan-out addresses a `profiles` row rather than a session, so there is no
  visitor for it to address. Stated as a negative only — decision #1 grants a visitor nothing and
  this change adds no grant.

### Who must NOW receive a row and did not

- **N11 — The ownerless owner of a private club, for a ride created in it.** The rider named by
  `clubs.owner_id` who holds no `club_members` row SHALL receive a `ride_created_in_club` row and
  SHALL be able to **read it back under their own session**. The second half is the assertion that
  matters: `036`'s standing rule is that counting rows written does not cover a defect whose whole
  shape is a row that exists and is unreadable.

### Who must still receive one — the properties that must NOT regress

- **N12 — The whole crew of a ride they can all resolve.** `055`'s widening survives intact. A
  ride whose crew can all read it SHALL notify every member of it, minus the actor.
- **N13 — The organizer, unconditionally.** Whatever `is_public`, whatever `club_id`, whether or
  not they hold a `ride_members` or `club_members` row. Their arm in `rides` SELECT is
  unconditional and leads the policy, so `can_read_ride` SHALL return true for them by that arm
  alone. **A filter that dropped the organizer would be the most visible regression this change
  could ship**, and it is the reason the filter is applied to the union rather than substituted
  for it.
- **N14 — Every ordinary member of a non-default club**, and its admins, who can resolve the
  ride. An `admin` holds a `club_members` row, so admins were already in the set and gain
  nothing new; they are named because `openspec/config.yaml` requires the role be stated rather
  than assumed to follow from `member`.

### Who must NOT be able to read anything new

- **N15 — Nobody. No read policy is widened by this change at all.** Zero policies are created,
  dropped or replaced. This is the property a reviewer should check first, because it is what
  makes the whole change unable to leak.
- **N16 — `rides` SELECT still has NO crew arm.** Neither `ride_members` nor `is_ride_crew`
  appears in its `qual`. The existing 055.7 assertion pinning that absence SHALL stay green and
  SHALL NOT be relaxed — this change closes 055.6 from the fan-out side precisely so that
  assertion does not have to move.
- **N17 — `034`'s `ride_messages` intersection and `041`'s postcard tag gate are untouched**, and
  SHALL be asserted as untouched, because §2 above is the reason the cheap option was refused and
  an unasserted reason decays into a preference.
- **N18 — No client role may EXECUTE `can_read_ride`, `can_read_club` or `is_club_member_for`.**
  `has_function_privilege('authenticated', ...)` SHALL be **false** for all three, and the
  assertion SHALL name the role rather than attempt the call — `031`'s lesson, since the suite
  runs as the table owner for whom the barrier does not exist. **A candidate-taking visibility
  predicate reachable by a rider is a probe**: pass any two ids and learn another rider's block
  state and club membership, one bit at a time, from a table neither read discloses. Reachable
  only from the definer fan-outs, which run as the owner.
- **N19 — `is_club_member`'s own behaviour is unchanged for every one of its ten calling
  policies.** Same signature, same OID, same grants, same answer for the same caller. The wrapper
  is a refactor of where the body lives, not of what it returns, and the ten policies SHALL NOT be
  recreated. **Its `prosrc` is pinned by equality**, so the wrapper cannot quietly grow an arm
  that `can_read_ride` would not see.

## The residual hazard, stated rather than hidden

**`can_read_ride` restates `rides` SELECT and `can_read_club` restates `clubs` SELECT, so a
rewrite of either policy makes its twin stale** — silently, in the direction of writing rows
nobody can read. `rides` SELECT has already been rewritten twice, by `017` and by `022`, and `054`
changed a function underneath it. `036` §3 argues against exactly this shape: *"the conjunction is
cheap and does not go stale; the derivation does."*

It is accepted here because there is no alternative that closes both routes — a fan-out cannot ask
the read policy a question about somebody else, and the two other candidate mechanisms are worse:
a crew arm on `rides` SELECT is refused above, and an `is_ride_crew`-style caller-relative helper
computes the actor's own answer and applies it to every candidate (`036` trap (c)).

**The mitigation is an assertion, not a comment**, and it takes **three** pins rather than one:

1. **`rides` SELECT's `qual` text**, labelled with `private.can_read_ride` (suite §060.1).
   `055.7` already pins two *structural* properties of that policy; this adds the text pin those
   two do not give.
2. **`clubs` SELECT's `qual` text**, labelled with `private.can_read_club` (§060.1b) — the twin,
   added because the second restatement has the identical failure mode as the first.
3. **`private.is_club_member`'s `prosrc`, by equality rather than by `like`** (F5). The two
   `qual` pins do not reach the helper bodies those policy texts delegate to: an arm added to the
   **wrapper** leaves both policy texts unchanged, satisfies any `like '%is_club_member_for%'`
   match, and makes `can_read_ride` silently narrower than the policy it claims to restate. That
   is PD-211's own shape one level down, which is why "the two entry points **cannot** drift" was
   a stronger claim than the evidence, and is now stated as "are **asserted** to share a body".

## Capabilities

### Modified Capabilities

- **`event-fanout-integrity`** — two requirements change.
  **`The recipient set SHALL be computed by direct query, never through a caller-relative
  helper`** is MODIFIED: its prohibition is correct and stays, but its worked scenario asserts the
  `ride_created_in_club` narrowing as a *consequence* of `is_club_member` having no owner arm,
  which `054` made false. It gains the positive form — a **candidate-relative** predicate is the
  permitted instrument — and its `ride_joined` scenario, which still says *"the organizer and
  nobody else"*, is brought up to `055` plus this change.
  **`A fan-out SHALL NOT write a row that the read policy can never return to its recipient`** is
  MODIFIED: its per-type table records `ride_joined → rides.organizer_id` and
  `ride_created_in_club → club_members only`, and both rows are now wrong. It also gains the rule
  that **a type with more than one subject SHALL be filtered by one predicate per subject** — the
  table's own conjunct column already says the subjects are tested independently, and nothing
  said the recipient set had to be.
- **`database-enforced-integrity`** — its requirement **`Ride visibility SHALL be stated per
  role`** is MODIFIED. It enumerates organizer, club member, non-member/public,
  non-member/private, blocked and signed-out, and **has no crew scenario at all**. That omission
  is half 1's root cause: *"a rider on this ride's crew"* reads as a role that can obviously see
  the ride, and it is not one. It gains a **Crew member** scenario stating the negative, and a
  **Club owner** scenario is already added by `grant-club-owner-member-reach` — see the
  coordination warning in that delta.

**The other six standing specs were read and are deliberately NOT modified.** `notifications` —
no read policy, screen state, count, ordering, retention or cascade changes; its rules about
eviction and about not adding a retraction trigger are *preserved*, and preserving a rule is not
modifying it. `ride-chat` — §2 above exists to keep its intersection requirement true, which is
the opposite of changing it. `client-cache-invalidation`, `client-render-shell`,
`client-session-storage` and `realtime-subscriptions` — no cache key, no screen, no channel and
no session behaviour changes.

### New Capabilities

- **`candidate-relative-visibility`** — the cross-cutting rule no standing spec owns: when a
  privileged writer must answer *"can this **other** rider see that resource"*, the predicate
  SHALL take its subject as an argument, SHALL be unreachable by any client role because it is a
  probe, and SHALL share one body with its caller-relative twin — with an **equality** pin on that
  body, since a `like` match cannot see an arm added to the wrapper.
  `event-fanout-integrity` states the prohibition (*never a caller-relative helper*) and no spec
  states the permitted instrument, which is why each fan-out has so far invented its own answer.
  This capability is written to outlive `notifications`: ride reminders, "ride updated", push
  delivery and the Inbox epic all need the same predicate.

## Impact

**Database.** One migration. Three `create function` (`can_read_ride`, `can_read_club`,
`is_club_member_for`), one `create or replace` on the wrapper, two on the fan-outs, the matching
`revoke`s, and the `comment on function` set. **Zero policies recreated, zero grants to a client
role, zero DDL on any table, no backfill, no new type.** The migration number is **`060`** —
re-derive with `ls supabase/migrations/` against `list_migrations` rather than trusting this line,
which this repo has had wrong in both directions. **`060` was written in the main thread and is
not this proposal's to write;** it applied to DEV on 2026-08-17, where `list_migrations` read 59
before and 60 after.

**Blast radius.** `036`'s standing warning applies unchanged: from the moment this applies, every
RSVP and every ride creation runs the new code inside the rider's own transaction, and a fan-out
that raises takes that rider's write down with it. Both paths SHALL be hand-exercised on DEV in a
rolled-back transaction before PROD.

**Recursion, inherited from `054` and restated because the function is being rewritten.**
`is_club_member_for` reads `public.clubs`, and `clubs` SELECT calls `is_club_member`, which now
wraps it — the same direct self-edge `054` recorded. It does not recurse only because
`pg_class.relforcerowsecurity` is **false** for `public.clubs` and the definer owns the table.
`ALTER TABLE public.clubs FORCE ROW LEVEL SECURITY` would turn every club read into `42P17`
infinite recursion. `can_read_ride` adds `public.rides` to the same dependency, and
`can_read_club` adds a **second** reader of `public.clubs` on that same edge.

**Security advisors.** No new finding expected, and confirmed on DEV 2026-08-17: **9 advisors,
with the `authenticated_security_definer_function_executable` count still 7.** All five functions
live in `private`, where `authenticated` holds no `USAGE`, and all three candidate-relative ones
are revoked — so none of them adds a WARN. Re-derive with `get_advisors(security)` rather than
trusting the numbers. A new WARN means a function landed in `public` or a `revoke` did not, and
SHALL be treated as a failed apply.

**Performance.** The predicates are evaluated once per candidate. For `ride_joined` that is
`can_read_ride` over the crew, bounded by ride size. For `ride_created_in_club` it is
`can_read_ride` **and** `can_read_club` over the club's membership — a 500-member club pays 500
evaluations of each inside the organizer's transaction, every one an indexed lookup. The club
predicate is the cheaper of the two and short-circuits on `is_public`. Recorded as a measured
expectation to check on DEV, not as an assumption; `036`'s own bound for this fan-out was 500 rows
in one statement and this adds two per-row predicates to it.

**Rollback** is the current bodies, reproduced verbatim in `design.md` §D6 as a copy rather
than a reconstruction.

**Code.** None.

**Tests.** `supabase/tests/rls_test.sql` gains assertions and **flips two existing `KNOWN GAP`
assertions**, per `openspec/config.yaml` — a policy change with no new assertion is not finished,
and a gap closed without moving the assertion that pinned it is a gap that will be re-discovered.
The suite stands at **1545** assertions after this change; re-derive rather than trust that with
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`, and reconcile **label sets** rather
than counts, since a count cannot tell a rename from a loss.

## Open questions

Every question carries a recommended default, so nothing here blocks the build.

- **Q1 (blocking, agent — answered at build time).** Do `can_read_ride` and `can_read_club`
  reproduce `rides` SELECT and `clubs` SELECT exactly, including the `club_id IS NULL` branch
  inside the public arm?
  **Default: derive both mechanically from `pg_policies.qual` at build time and diff the texts by
  eye in the task, rather than transcribing from this proposal.** Task 1.1 does this; the
  proposal's copy is evidence, not the source. **Answered on 2026-08-17** — both were derived that
  way and both policy texts are now pinned by assertion (§060.1, §060.1b).
- **Q2 (non-blocking, product owner).** Should the ownerless owner also receive `ride_joined`
  rows for rides in their club that they neither organise nor joined?
  **Default: no.** This change makes the recipient set equal to the readable set for the events
  that already exist; it does not add an audience. The owner is not on the crew, and a club owner
  notified of every RSVP in a busy club is a different product decision with its own volume
  problem.
- **Q3 (non-blocking, product owner).** Should a rider who becomes unable to read a ride have
  their **existing** `ride_joined` rows deleted, rather than merely evicted by the read policy?
  **Default: no.** `notifications`' standing spec forbids an `AFTER DELETE` retraction on
  `club_members` or `ride_members` in as many words, and eviction is reversible where deletion is
  not — a row that returns unread on unblocking is the correct answer.
- **Q4 (non-blocking, agent).** Should `is_ride_crew` get a `_for` twin at the same time, for
  symmetry?
  **Default: no.** Nothing needs it today, and a candidate-relative predicate with no caller is an
  unreachable probe waiting for someone to grant it. Add it with the first fan-out that needs it.
- **Q5 (non-blocking, agent).** Should the stale `comment on function` be treated as this change's
  or filed separately?
  **Default: this change's.** It is one statement in a file that is rewriting the function anyway,
  and leaving it is how the next session inherits the wrong justification from the object rather
  than from the file.
- **Q6 (non-blocking, product owner).** When the welcome club (`clubs.is_default`) eventually
  hosts rides — if it ever should — what is the intended audience?
  **Default: none, as `059` decided.** N4 keeps that ruling; changing it is a policy and a
  dropdown, not a fan-out.
