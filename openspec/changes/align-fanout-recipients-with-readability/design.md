# Design — a fan-out's recipient set SHALL be the set that can read the row

## D1. Why the fan-out narrows rather than the policy widening

PD-211 frames this as two ends of one problem, and the issue's own text calls the policy end
cheaper. It is cheaper in diff and wrong in outcome. Both grounds below are measured, and both
belong in the record because "we picked the expensive one" is the decision a later session is most
likely to reverse without re-deriving.

### D1.1 The domination problem

`rides` SELECT's top-level operator is `OR`, so a new arm's safety is a question about
**domination**, not position:

```
(organizer_id = auth.uid())
OR ( NOT private.is_blocked(auth.uid(), organizer_id)
     AND ( (is_public AND (club_id IS NULL OR private.is_club_public(club_id)))
           OR (club_id IS NOT NULL AND private.is_club_member(club_id)) ) )
```

There are exactly two placements for a crew arm and they fail differently:

| Placement | Route (a): blocked crew member | Route (b): ex-club-member crew | Verdict |
|---|---|---|---|
| Top-level third disjunct | **Sees the ride again.** The arm is outside the `is_blocked` conjunct | Closed | **Breaks decision #2** — a blocked rider reappears in ride crews through a stale roster row |
| Inside the second disjunct, under `NOT is_blocked` | Still closed — correctly | Closed | **Half-fix that reads as complete.** Route (a) stays open because it *should*, and 055.6 could never flip; a session closing 055.6b would reasonably believe both were done |

The second row is the dangerous one. It is not wrong about anything a test would catch — it is
wrong about what got fixed, which is exactly what 055.6b's own assertion label was written to
prevent: *"a fan-out that only excluded riders blocked with the organizer would close 055.6 and
miss this one entirely."* The mirror-image mistake on the policy side has the same shape.

Note what this table says about the **fan-out** end by contrast: `can_read_ride` closes both
routes with one predicate, because it is not choosing a placement inside a disjunction — it *is*
the disjunction, evaluated for somebody else.

### D1.2 The collapse of two intersections

Two audiences in this schema are deliberately **narrower** than the crew, and both express that as
an intersection with an RLS-filtered `EXISTS` against `rides`:

```sql
-- 034, ride_messages SELECT / INSERT
exists (select 1 from public.rides r where r.id = ride_messages.ride_id)
and private.is_ride_crew(ride_id)

-- 041, postcards INSERT with check (the ride tag)
ride_id is null
or (exists (select 1 from public.rides r where r.id = ride_id)
    and private.is_ride_crew(ride_id))
```

`private.is_ride_crew` is `security definer`, so RLS does not apply inside it. The `EXISTS` is the
only half that sees the block conjunct and the private-club arm. **Give `rides` SELECT a crew arm
and the `EXISTS` becomes implied by the crew conjunct**, collapsing the intersection — to the crew
alone under the top-level placement, and to `crew ∧ ¬blocked` under the placement beneath the
block conjunct, since there the crew arm inherits that one conjunct and nothing else.

**Both placements return `034`'s named victim**, which is why the refusal does not depend on
choosing between them: the ex-club-member with no block anywhere satisfies `crew ∧ ¬blocked` just
as it satisfies `crew`. What the second placement preserves is the block half of the ride test and
nothing else — not the private-club arm, which is the half that made the ex-club-member's chat
private in the first place.

That is the leak `034` shipped in draft and fixed, restored from the other side, with **no diff on
`ride_messages` and no diff on `postcards`**. `034`'s own `comment on table` names the victim: an
ex-club-member reading a private ride's chat. `ride-chat`'s standing requirement — *"Chat
visibility SHALL be the intersection of ride visibility and crew membership, never crew membership
alone"* — would be false while its policy text was untouched and its assertions were green,
because both halves would still be present and one would have stopped meaning anything.

**This is the general hazard of widening a policy that other policies embed by `EXISTS`**, and it
is why the caller-set enumeration `grant-club-owner-member-reach` §D1 insists on — *"direct
closure is not total closure"* — applies here in its harder form: a grep for `rides` finds these
two, and a grep for the *reason* finds nothing at all.

## D2. Why `is_club_member_for` exists, rather than a second copy of `054`'s body

`can_read_ride` needs a candidate-relative club-membership test. Three ways to get one:

- **Call `private.is_club_member(club_id)` inside it.** Wrong, and it is the specific trap `036`
  trap (c) names: the helper reads `auth.uid()`, so inside a fan-out it answers *"is the actor a
  member"* — or, with no JWT, NULL — and applies that one answer to every candidate. The set
  becomes everybody or nobody and looks correct in a one-member test.
- **Inline `054`'s two arms into `can_read_ride`.** Two copies of one predicate, in two schemas'
  worth of reasoning, with nothing connecting them. `054` exists because ten policies disagreed
  about one concept; adding an eleventh definition of it in the same week is the identical
  mistake at a smaller scale.
- **One body, two entry points.** `is_club_member_for(candidate, club)` holds the arms;
  `is_club_member(club)` becomes `select private.is_club_member_for(auth.uid(), $1)`.

The third is chosen. What it buys, concretely: the day a third arm is added — an invitation state,
a suspended membership, an admin-only club — it lands in one body and the fan-outs and the ten
policies move together, in the same statement, with no possibility of one being missed. **The
drift this whole change repairs is precisely two definitions of one concept aging apart**, so
building the fix out of two more of them would be self-defeating.

**Why the wrapper keeps the name and the signature.** `054` §D2 already settled this for the same
function: a rename means recreating all ten calling policies for a naming gain. `create or
replace` preserves the OID and the privileges, so no policy is recreated and no grant moves. The
wrapper is a change to where the body lives; every caller's answer is identical, which is
assertable directly (N18).

**Why the wrapper is still `security definer`.** It reads nothing itself, but its callee does, and
the callee is revoked from client roles — inside a definer function `current_user` is the owner,
which holds `EXECUTE`. Making the wrapper `security invoker` would break all ten policies for
`authenticated` in one statement.

## D3. Why the readability filter goes after the union, in both fan-outs

`036` §7.6 paid for this lesson on `club_joined` and `055` restated it for `ride_joined`: **a
rider can qualify through more than one arm**, so a filter inside one arm leaves them in through
the other. The path is not hypothetical — the organizer's own RSVP makes them both
`rides.organizer_id` and a `ride_members` row.

It applies to the readability filter for the same structural reason and for one more. Consider
`ride_created_in_club` after the owner union: a rider can be `clubs.owner_id` **and** a
`club_members` row. Filter inside the membership arm only and the owner arm re-admits them
unfiltered; filter inside the owner arm only and the reverse. And for `ride_joined` the organizer
arm must **not** be pre-filtered on anything, because `can_read_ride` returns true for the
organizer by their own unconditional arm — a filter written per-arm invites someone to "optimise"
the organizer arm's filter away and then discover it was the only thing keeping N12 true.

So both fan-outs take the shape: build the candidate union, then a single outer `WHERE` carrying
the actor exclusion, the block test and `can_read_ride`, then `on conflict do nothing`.

**The `clubs.is_default` early return sits ahead of all of it**, not inside the `WHERE`. `059`
made it an early return deliberately, and adding the owner to the union without preserving that
position would restore an app-wide broadcast that any rider can fire at will — worse after this
change than before it, because the owner union adds one more recipient to a set that is already
every rider in the app.

## D4. Why `can_read_ride` and `is_club_member_for` are revoked from every client role

Both take a **candidate** as an argument, which is exactly what makes them useful to a fan-out and
exactly what makes them a probe in a rider's hands. `authenticated` holds no `USAGE` on `private`,
so the revoke is belt and braces — and `029`/`031` are the reason belt and braces is the house
rule here rather than a preference: a function that nothing could call shipped once already, and
the barrier that saved it was invisible to the suite.

The oracle, stated concretely so the risk is not abstract. With `EXECUTE`, a rider could call
`is_club_member_for(<any rider>, <any club>)` and read, one bit at a time, a membership fact that
`club_members` SELECT deliberately withholds for a private club; and `can_read_ride(<any rider>,
<any ride>)` returns a single boolean that is a function of that rider's **block state** with the
organizer. `blocks` discloses nothing to either party by design, and decision #2 requires blocking
be invisible — *"no gap, count or marker"*. A boolean is a marker.

**The assertion names the role rather than attempting the call.** `031`'s lesson: the suite runs as
the table owner, for whom neither the `private` USAGE barrier nor the revoke exists, so a test that
calls the function succeeds and proves nothing. `has_function_privilege('authenticated',
'private.can_read_ride(uuid,uuid)', 'execute')` is the shape.

## D5. The restatement is stale-able, and the mitigation is an assertion

`can_read_ride` is a second implementation of `rides` SELECT. `036` §3 argues against exactly this
— *"the conjunction is cheap and does not go stale; the derivation does"* — and that argument is
not answered here, it is **accepted and bounded**. `rides` SELECT has been rewritten by `017` and
by `022`, and `054` changed a function underneath it.

What makes it acceptable rather than reckless:

1. **The failure direction is closed.** A stale `can_read_ride` writes rows that the read policy
   discards, or fails to write rows it would have returned. Neither shows anything to anyone. The
   read policy is still the only thing that decides what a rider sees, so no staleness in this
   function can produce a leak — which is not true of the refused option, where staleness in a
   policy arm is a leak by construction.
2. **The pin is a test, not a comment.** `055.7` pins two structural properties of `rides` SELECT
   — that it leads with an unconditional organizer arm, and that it has no crew arm. Neither
   catches a rewrite of the *middle* of the policy. This change adds a **full `qual` text pin**,
   labelled with `private.can_read_ride`, so a rewrite fails the suite with the name of the
   function that has to move with it.

A text pin is brittle by design: it fails on a cosmetic reformat as well as on a semantic change.
That is the intended trade — a false failure costs one session five minutes and points at the
right file, and the alternative costs a silent behaviour change nobody can see. `055.7`'s
constraint-definition pin on `ride_members_status_check` is the same instrument, already in the
suite and already accepted.

## D6. Rollback

The rollback is the four current bodies, restored in one file. They are reproduced in the
migration's own header as a **copy taken at build time** from `pg_get_functiondef`, not
reconstructed from this document — `tasks.md` §1.1 and §1.3 take those copies before anything is
written, for the same reason `054` §D5 did.

Reverting is safe in both halves and needs no data change: reverting `ride_joined` restores the
two `KNOWN GAP` rows (unreadable, harmless), and reverting `ride_created_in_club` restores the
withheld owner notification. Neither leaves a row anyone can see that they could not see before.

**The revert is not a plain `drop function`.** `is_club_member` must be restored to `054`'s body
in the same statement, or the wrapper is left pointing at a function that no longer exists and
**every one of the ten calling policies fails at read time**. The rollback file therefore restores
`is_club_member` first and drops `is_club_member_for`, `can_read_ride` and `can_read_club` last.

## D8. Why `ride_created_in_club` needs a second predicate and `ride_joined` does not

A `ride_created_in_club` row sets **both** `ride_id` and `club_id` and renders both — the club's
name in the copy, the ride as the destination — and `036` §3's SELECT policy tests the two as
**independent `EXISTS` conjuncts**. So a recipient set filtered on `can_read_ride` alone is
asserting *ride-implies-club*, which `036` §3 forbids by name: *"Ride-implies-club is a derivation
from today's policy text and SHALL NOT be relied on to collapse the last row to one conjunct."*

**The derivation is true today and that is exactly why the conjunct is installed now.** Every
candidate is a `club_members` row or `clubs.owner_id`; both satisfy `clubs` SELECT
(`is_public OR owner_id = auth.uid() OR private.is_club_member(id)`), so `can_read_club` excludes
nobody. That is the same state `036` §7.5 was in when it was written — correct, and correct for a
reason nothing was holding still. `041` already names the change that falsifies it: a **block
predicate on `clubs` SELECT**. `clubs` is currently the one club-side policy with no block arm,
which `ride-chat`'s spec calls out in as many words. Add one, and a member blocked with the
**club owner** but not with the **ride organizer** passes `can_read_ride`, fails `clubs` SELECT,
and holds a permanently unreadable row — half 2's defect reintroduced through half 1's fix.

**`ride_joined` deliberately does not call it**, because that type leaves `club_id` NULL and the
club conjunct is therefore vacuous for it. Calling `can_read_club` there would be a filter against
a subject the row does not render — narrowing the recipient set for a reason the read policy does
not apply, which is the *first* half of this change's defect in miniature.

**The asymmetry is pinned in both directions**, and that is not belt-and-braces. An omission with
no assertion behind it is indistinguishable from an oversight, and this entire change exists
because two such omissions were read as decisions for three migrations. One assertion says the
club fan-out calls the club predicate; the other says the ride fan-out does not.

**Testing a conjunct that excludes nobody.** A recipient count cannot exercise `can_read_club` at
all — remove it and every count is identical. So the suite exercises the predicate's three arms
**directly** (§060.4b), which is the only shape that fails when a later edit deletes it. This is
the same reasoning `event-fanout-integrity` already applies to the `admin` arm nobody can reach:
*"omitting the assertion as untestable SHALL NOT be acceptable, because the arm ships the day
invitations do."*

## D9. Options considered

| Option | Closes (a) block | Closes (b) left club | Closes half 2 | Verdict |
|---|---|---|---|---|
| **Chosen — `can_read_ride` on both fan-outs, plus `can_read_club` on the two-subject one** | Yes | Yes | Yes | One instrument, both halves, no policy touched |
| `can_read_ride` alone on both fan-outs | Yes | Yes | Yes | Rejected in review: derives club-visibility from ride-visibility, which `036` §3 forbids. Latent today, opened by a block predicate on `clubs` SELECT — see §D8 |
| Crew arm on `rides` SELECT, top-level | Reverses it | Yes | No | **Breaks decision #2**; collapses `034` and `041` to the crew alone |
| Crew arm on `rides` SELECT, under the block conjunct | No | Yes | No | Half-fix that reads as complete; collapses `034` and `041` to `crew ∧ ¬blocked`, which still returns `034`'s named victim |
| Exclude candidates blocked with the organizer | Yes | **No** | No | The half-fix 055.6b's label already refuses by name |
| Wait for `enforce-creator-membership` to seed owner rows | No | No | Partly | Fixes half 2 only, by making the state unreachable rather than the predicate correct; leaves the predicate wrong for any owner row later removed |
| Do nothing; delete unreadable rows on a schedule | No | No | No | There is no scheduled job in this project, and a sweep treats the symptom |

The fifth row deserves its own line, because it is the one that looks like it makes this change
unnecessary. `enforce-creator-membership` guarantees every owner holds a membership row, which
would make half 2 invisible. It does not make it **correct**: the recipient set would still be
derived from a claim about another function's body, and the claim would still be false. An RLS
predicate — or a fan-out — should not depend on a data invariant enforced by a trigger elsewhere;
that is the same defence-in-depth posture `grant-club-owner-member-reach` took against the same
change, and neither is sequenced on the other.
