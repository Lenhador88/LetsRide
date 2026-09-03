## Context

Three facts shape everything below, and all three were read rather than assumed.

**The database already permits every write this change unblocks.** Read live off DEV
(`fpmrimzxadewsaiwpsel`):

```
rides UPDATE  USING       auth.uid() = organizer_id
              WITH CHECK  auth.uid() = organizer_id
                          AND (club_id IS NULL OR private.is_club_member(club_id))
```

No `is_public` predicate anywhere. So the strand guard has always been client-side and always
been advisory, and relaxing it takes no migration.

**`083`'s fourth SELECT arm is live**, which is what retired the guard's stated reason:

```
rides SELECT  USING  organizer_id = auth.uid()
              OR ( NOT private.is_blocked(auth.uid(), organizer_id)
                   AND ( (is_public AND (club_id IS NULL OR private.is_club_public(club_id)))
                         OR (club_id IS NOT NULL AND private.is_club_member(club_id))
                         OR private.has_live_ride_invite(id) ) )
```

and `private.has_live_ride_invite_for` matches `status in ('pending', 'accepted')` — an
inequality was deliberately avoided so a fourth status grants nothing. The `ride_invites` INSERT
policy carries **no club and no `is_public` predicate**, so inviting into a clubless private ride
is permitted. "Riders you invite" is not vacuous.

**The form already holds what the new predicate needs.** `RideForEdit` carries `is_public` and
`club_id` (`src/types/index.ts:425-426`), and `getRideForEdit` already selects both. `updateRide`
already issues a `previous` read (`src/lib/actions/rides.ts:443-447`) for the map-tile logic. So
neither side needs a new query — the client needs no data change at all, and the action needs two
more columns on a `select` it was already making.

## Goals / Non-Goals

**Goals:**

- A ride created under PD-320's default is editable — every field, without publishing it.
- One refusal string, arguing from what is actually lost.
- The refusal fires on the *transition* and stays silent on the *shape*.
- The two audience hints stop being able to drift.
- No migration, no policy change, no new dependency.

**Non-Goals:**

- **Changing who can see a ride.** Not one predicate moves. If a diff for this change touches
  `supabase/`, something has gone wrong.
- **Giving the organizer a way to make an existing public clubless ride private.** That is the
  accepted cost of the Narrow reading — see D1 and Q1.
- **A crew-loss confirmation dialog.** The properly designed answer to "you are about to drop
  four riders" is a confirm step, and it is a different story (Q2).
- **Fixing `npm run walk`'s ride-edit phase as such.** PD-311 owns that; this change states what
  it must become and why the two are in one territory (D5).
- **Removing `description` handling, touching timezone logic, or any other tidying of
  `EditRideForm`.** The file is dense and the diff should be readable as a guard change.

## Decisions

### D1 — Narrow, and why it survives its strongest objection

**Assumption, not an owner decision** (proposal.md's opening callout says so, and so does the
report this change was handed back with). The build is Narrow: refuse the transition, permit the
shape.

The strongest argument against Narrow, stated in PD-338's own framing: *a rider refused the
transition can delete the ride and recreate it clubless and private through `createRide`, which
permits it — so the guard only adds friction.*

**It does not survive contact with what delete actually does.** `ride-lifecycle`'s deletion
requirement, read off the FKs: deleting takes every `ride_members` row, every `ride_messages` row
and every notification with it, unrecoverably, behind a two-tap confirmation that states the crew
count. So the "bypass" is not the same outcome reached more slowly — it is a *louder and more
destructive* outcome, taken deliberately, with the crew count on screen. A guard whose bypass is
"destroy the thing, with a confirmation that says what you are destroying" is not a guard being
routed around; it is a guard doing the only job left to it, which is making sure the crew is not
dropped **silently**.

**What Narrow protects, restated honestly.** It is no longer "nobody could ever see it" — `083`
killed that. It is: *riders already holding a `ride_members` row lose the ride, and its chat with
it (`ride_messages`' audience is an intersection), with no notification, because this change sends
none.* That harm is real and survives `083` intact, because crew and invitees are different sets.

**Where Narrow is genuinely less tidy, said plainly rather than argued away.** The base spec
already blesses one audience narrowing that drops the crew — a public ride moved into a private
club — calling it *"the policy working, not a defect"*. So Narrow refuses one crew-dropping edit
and permits another. The line it actually draws is *standing audience falls to nobody* versus
*standing audience becomes a different group*, which is coherent and is now written into the
requirement as a table. It is not the only coherent line available, and Q1 is where a different
one gets chosen.

**Narrow is a strict improvement under either reading**, which is what makes shipping it on an
assumption safe: every save it permits is one that is refused today, and it permits nothing
`createRide` did not already permit. Wide is Narrow minus one predicate.

### D2 — The rule stays advisory, and the spec says so

`CLAUDE.md` §Technology Decisions: *"No new integrity rule may live only in a Zod schema. Anything
not expressed as a CHECK, trigger or policy is advisory, because a rider can simply not run your
validation."* A `BEFORE UPDATE` trigger comparing OLD to NEW **could** express this exactly. It is deliberately
not built, for three reasons:

1. **This is not an integrity rule and not an access-control rule.** Nothing leaks and nothing is
   corrupted when an organizer narrows their own ride's audience. The party inconvenienced is the
   crew, and the organizer is entitled to make that call — they can already delete the ride
   outright. A database invariant here would constrain a rider's authority over their own row in
   the name of someone else's convenience.
2. **`CLAUDE.md`'s hand-exercise rule would apply and is expensive.** *"A migration that hangs
   triggers off an already-shipped write path needs a hand-exercise gate before it applies"* —
   and every ride edit runs through this path, so a trigger that raises takes ride editing down
   inside the rider's own transaction. That is a large blast radius for a courtesy rule.
3. **It would be a third copy.** Two copies already drifted (that is finding #2 on PD-338). The
   fix in this change collapses them to one; adding a third in SQL walks straight back.

The requirement therefore carries an explicit *"this rule is advisory"* bullet. A spec that
claimed the database refuses this would be false, and false-in-the-spec is how the next migration
author gets it wrong.

### D3 — Where the predicate lives, and what it is computed from

**One helper, two callers.** A pure function, so it is unit-testable without a DOM or a database:

```
narrowsToNobody(stored: {club_id, is_public}, submitted: {club_id, is_public}): boolean
```

true iff the submitted pair is clubless-and-private **and** the stored pair is not.

- **`EditRideForm`** computes it against the `ride` prop it already has. `wouldStrand` becomes
  `wouldNarrow`; both the `role="alert"` render condition and the Save `disabled` prop read it.
  Rename rather than re-point: `wouldStrand` names the retired premise.
- **`updateRide`** computes it against the `previous` row, which gains `is_public, club_id` on its
  existing `select`. **The guard therefore moves down**, past `resolveSupabase`, `getUser` and the
  `previous` read — today it sits above all three. Zod parsing stays first, so a malformed payload
  is still refused before any round trip.
- **The stored pair is never taken from the form.** A hidden input naming the prior shape would be
  a claim the client controls, and the whole point of the action-side copy is that it holds when
  the client is bypassed.
- **`previous` is `.maybeSingle()` and can be null.** When it is, the action proceeds — see the
  spec scenario. Inventing a refusal there would report a guard failure for a ride that is simply
  gone; inventing a permission is harmless because RLS matches zero rows anyway, and the
  not-found path already reports that.

**Last-write-wins is unchanged** (base `design.md` §D3). Two tabs on the same ride can therefore
show an enabled Save that the action then refuses, because the action's fresh read is
authoritative. That refusal must keep the entered values, which `EditRideForm`'s controlled state
and `retaining` already guarantee.

### D4 — The copy, written out so the build session does not have to invent it

**One exported constant, rendered by the form and returned by the action.** Suggested home:
`src/components/rides/audienceCopy.ts` (a plain module, no component), or beside `RECENT_STARTS`
if the build session prefers to keep ride copy together. Names are the build's to choose; the
strings are not.

**The refusal — replaces `EditRideForm.tsx:308-309` and `rides.ts:427-429`, one string for both:**

> Riders already in this ride's crew would lose sight of it. With no club and not public, only you
> and the riders you invite can see a ride. Pick a club, or make it public.

Three properties it was written for, each of which the old sentence failed:

- It is **true after `083`** — it states the invite path rather than denying it.
- It names **who loses what**, which is the actual harm, instead of an absolute nobody-can-see-it
  claim the rider can disprove by opening their own ride.
- It reads correctly for **both** refused transitions — detaching, and un-publishing — so one
  string covers both and there is nothing to drift.

**The audience hint at `EditRideForm.tsx:300-303` does not change one character:**

> Anyone signed in can see and join a public ride. A private ride is visible to its club, and to
> riders you invite.

It is already true, it is already word-for-word `CreateRideForm.tsx:353-356`, and PD-320's review
comment asked only that something start *enforcing* the match. **Both forms render it from one
shared constant.** A shared constant beats an equality assertion between two literals: the
assertion detects drift after it is written, the constant makes it unwritable. The counter-argument
is real and accepted — a constant couples two components' copy, so a future design that wants the
two screens to say different things has to split it deliberately, which is exactly the review this
pair has needed twice.

**The comment block at `EditRideForm.tsx:285-299` is rewritten, not deleted.** It currently says
PD-338 owns those sentences and that the alert argues from a retired premise — both become false
the moment this ships, and `CLAUDE.md` §Working Principles says to replace a wrong claim rather
than narrate it. What survives is the one durable line: why the hint is shared, in one sentence.

### D5 — The walk, and the PD-311 boundary

`checkEditRetention` (`scripts/walk.mjs:1922`) picks a ride the walking rider owns, **flips
`is_public` in whichever direction the ride happens to sit**, and then submits a whitespace-only
required field to get a refusal it can measure retention against. Its own comment already records
that it must read `role="status"` and never `role="alert"`, because both edit forms draw a live
alert when the box is unticked.

The interaction is exact and it is why the two issues share a territory:

| Fixture ride | Flip | Today | After this change |
|---|---|---|---|
| clubless, private | → public | fine | fine |
| clubless, public | → private | **Save disabled, no submit, phase fails** | **still disabled — Narrow refuses this transition** |
| in a club | either | fine | fine |

So **Narrow does not fix PD-311**, and this change must not pretend it does. What it does is make
the trap describable: the phase needs a ride whose flip does not cross the guard, or it needs to
assert the disabled-Save state deliberately instead of tripping over it. The requirement above
pins the two ARIA roles so whatever PD-311 does, it keeps reading the action's error rather than
the live warning. Building the walk fix is PD-311's; this change's task list only records what
PD-311 must be told.

### D6 — Every state of the edit screen, re-walked against the new predicate

Only the rows that move are argued; the rest are the base spec's and unchanged.

| State | Answer |
|---|---|
| **Empty** | Not applicable — the edit form always has a ride. The empty case is `clubOptions` being empty (a rider in no clubs), which is D1's headline: Save enabled, no alert, "No club" is a legitimate resting state rather than an error. |
| **Loading** | Unchanged: gate on the ride data, never on `isLoading`. `clubs === undefined` is treated as an empty array; the new predicate reads `ride`, which is present by then. |
| **Error** | Unchanged: keep the entered values, offer a retry. The action's refusal is `role="status"`. |
| **Offline** | Unchanged: fail visibly, never queue. **The guard is client-side and therefore still fires offline** — which is correct, and worth stating: the rider is told why before a request that could not have gone anyway. |
| **Permission denied** | Unchanged and deliberately untouched: a ride that loads but is not the caller's says "only the organizer can edit this ride"; a ride that does not load is not-found. The new predicate runs after that fork, so nothing about it can turn a permission problem into an audience message. |
| **Partial** | **Moves.** `clubs === null` on a ride already clubless-private is today an absolute dead end — the picker is a disabled `<div>`, so the checkbox is the only control, and Save is disabled until it is ticked. After this change Save is enabled, because nothing is being narrowed. This is the state-checklist row that turns out to matter most. |
| **Stale** | Last-write-wins, unchanged (D3): the action's fresh read can refuse a Save the form enabled. |

## Risks / Trade-offs

- **The accepted cost, named once so it is not discovered later: an organizer cannot make an
  existing clubless public ride private.** Their exits are to keep it public, put it in a club, or
  delete it. This is today's behaviour, unchanged by this proposal — but today it is an accident
  and after this it is a decision, so it needs Q1 rather than silence.
- **A relaxed guard reads like a widened policy.** The mitigation is in the spec: an explicit
  negative-case scenario stating that no role gains reach and that the diff touches no
  `supabase/` file. `reviewer` should check that claim against the diff rather than the prose.
- **The shared hint constant couples two components.** Accepted deliberately — see D4.
- **The action's guard now runs after two awaits** (`getUser`, the `previous` read), so the
  refused case costs a round trip it did not cost before. Irrelevant in practice: the form refuses
  first, and the action's copy exists for the bypassed client, which is not a latency-sensitive
  path.
- **This change ships no notification to a crew that loses a ride.** It is out of scope here and
  out of scope in the base spec (PD-124), and it is the reason the guard is worth keeping at all
  in its narrowed form.

## Open questions

Each carries a recommended default, so a build can proceed without an answer, and says who can
answer it. **None of the three blocks `/opsx:apply`.**

**Q1 — Narrow or Wide?** *(Non-blocking. Product owner only — it is a product decision about
whether an organizer may narrow their own ride's audience, and PD-338's comment says explicitly
that this is the proposal's question, not a build's.)*

**Recommended default: Narrow, as built here.** It closes the reported harm completely, keeps the
crew protection the base spec's deletion and detach rules assume, and leaves Wide available as a
one-predicate follow-up. Should the owner prefer Wide, the delta shrinks: delete the transition
predicate and the refusal string, keep the copy fix and the shared hint constant, and amend the
ex-member requirement to offer a third exit (detach and stay private, then invite).

**Q2 — Should the refused transition become a confirmation instead of a refusal?** *(Non-blocking.
Product owner, with `rider-ux`.)* "This will drop the 4 riders already in the crew — continue?" is
the properly designed answer to both refused transitions and would make Q1 moot, because it lets
the organizer narrow the audience while making the cost explicit.

**Recommended default: not in this change.** It needs a crew count on the edit screen, a
confirmation component and a design decision about wording, and PD-338's scope is a guard that
refuses the wrong thing. File it as its own story if Q1 keeps coming back.

**Q3 — Should the refusal be skipped when the ride has no crew but the organizer?** *(Non-blocking.
This session's author raises it; `reviewer` or the owner can settle it.)* The base requirement's own
words are *"while `ride_members` rows survive"*, so a literal reading would permit the transition on
a ride nobody has joined — which would let a rider un-publish a ride they published by mistake.

**Recommended default: no, not in this change.** It needs a crew count the edit read does not
carry, the count is filtered by the block predicate so the client can only under-count it, and it
widens the diff past the harm PD-338 reports. Recorded here because it is the cheapest route to
closing the §Risks cost above if it turns out to bite.
