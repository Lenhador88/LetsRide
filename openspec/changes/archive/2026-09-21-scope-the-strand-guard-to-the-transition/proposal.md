# Scope the strand guard to the transition, so a ride created private can still be edited

> Linear **PD-338**. This file is the specification and the issue must not restate it
> (`CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*). **No migration.** The guard is client + action only; the database already permits
> every write this change unblocks, and nothing here widens a policy.

## ⚠ Read this first — one decision is a stated ASSUMPTION, not an owner answer

PD-338's body asks a question and its own comment says the answer *"is a proposal's to answer,
not a build's"*: is a clubless private ride with **no invites** still stranded — **Narrow** (scope
the guard to the transition) or **Wide** (drop it)?

**This proposal is written on the Narrow reading, and nobody answered.** It was produced in an
unattended scheduled run with no one available to ask, so per `CLAUDE.md` §Working With the
Product Owner — *ambiguity → assume and proceed, state the assumption in one line* — Narrow is
taken as the most sensible reading and stated here rather than presented as a decision:

- Narrow matches the requirement's own header (*"SHALL NOT be able to **produce**"*) and its
  scenario (*"WHEN an organizer sets `club_id` to NULL"*), and contradicts only the broader bullet.
- It fully closes the harm PD-338's title names — a ride created under PD-320's default becomes
  editable — and changes nothing else.
- Wide additionally changes **detach** behaviour, which is beyond the harm the issue reports, and
  it retires the last protection a rider's already-attached crew has.

**It is a strict improvement over today under either reading**, so shipping Narrow does not
foreclose Wide: Wide is Narrow minus one predicate, and §Open questions Q1 carries it with the
evidence a later decision needs. **If the owner wants Wide, say so before `/opsx:apply`** — the
delta is smaller, not larger.

## What is first-hand

Read live, not inferred: PD-338's body **and** its three comments (the territory comment, the
2026-08-28 owner confirmation, and PD-320's review comment); DEV (`fpmrimzxadewsaiwpsel`) for the
`rides`, `ride_members` and `ride_invites` policies, `private.has_live_ride_invite_for`'s body,
the trigger list on `rides` and the applied migration chain; and `EditRideForm.tsx`,
`CreateRideForm.tsx`, `src/lib/actions/rides.ts`, `src/lib/data/rides.ts`, `src/types/index.ts`
and `scripts/walk.mjs` in the tree. Nothing below is inferred and unmarked.

## Why

**PD-320 made "private, no club" the default output of the ride composer, and that is the exact
combination both edit paths refuse.** A rider who creates a ride outside a club — including every
rider who belongs to no club, who gets no picker at all — gets a ride they can never edit: not the
title, not the meeting point, not the time. `createRide` has never carried the guard, so the
composer produces a shape the editor rejects.

The sharpest statement is not "cannot edit", it is **"can only edit by publishing"**. The single
lever that clears `wouldStrand` for a rider with no clubs is ticking *Make this ride public*, and
the `role="alert"` beneath the checkbox tells them to do exactly that. Fixing a typo costs them
publication to every signed-in rider. That is a privacy-coercive edit path sitting on the story's
own default.

**The guard's stated reason has expired, and this was measured rather than assumed.** Its message
argues *"nobody but you could ever see it again"*. The live `rides` SELECT policy on DEV carries a
fourth arm — `private.has_live_ride_invite(id)` — added by `083` (`20260827233033
083_ride_invites`, PD-329), and the `ride_invites` INSERT policy is
`inviter_id = auth.uid() AND EXISTS (select 1 from rides r where r.id = ride_id and r.organizer_id
= auth.uid()) AND NOT private.is_blocked(auth.uid(), invitee_id)` — **no club predicate and no
`is_public` predicate**. So a private clubless ride is one the organizer can invite riders to, and
the refusal's premise is false. PD-320 shipped on exactly that basis.

**The false sentence is now rider-visible beside a true one, twelve lines apart** (PD-320's review
comment, which raised this issue's Urgency to 8): the audience hint says *"A private ride is
visible to its club, and to riders you invite"* — true — and the alert below it says *"nobody but
you could see it"* — false, attached to the disabled Save button, offering as its only exits the
two audience widenings the rider deliberately declined.

**And the refusal exists twice, in two copies that have already drifted**: `EditRideForm.tsx:308`
says *"nobody but you could see it"*, `rides.ts:428` says *"nobody but you could ever see it
again."* Both argue from the retired premise.

## What Changes

- **The strand guard becomes a rule about the *transition*, not about the *shape*.** An edit that
  would **reduce** a ride's standing audience to the organizer alone is refused; an edit to a ride
  **already** in that shape is permitted. Concretely, both `EditRideForm` and `updateRide` compare
  the ride's **stored** `club_id`/`is_public` against the submitted pair, instead of testing the
  submitted pair alone.
- **The two refusal messages are collapsed into ONE exported constant** used by the form and the
  action, and rewritten to argue from what is actually lost — the riders already in the crew —
  rather than from the retired "nobody but you" premise.
- **The alert renders only when the rider is attempting the refused transition.** Today it renders
  on any clubless private ride, including one that arrived that way, where it accuses the rider of
  something they have not done.
- **Save is no longer disabled on a ride that arrived in the shape.** The `disabled` prop follows
  the same transition predicate.
- **`createRide` deliberately does NOT gain the guard**, and the spec now says so. Creating in
  this shape narrows nothing — there is no prior audience and no crew — so the two write paths
  disagree **by design** rather than by omission, which is the state PD-338 found them in.
- **The audience hint at `EditRideForm.tsx:300` does not change one character**, and gains the
  thing that keeps it that way: it moves into a shared constant both ride forms render, so the
  pair that *"drifted once already and a read caught it, not a gate"* can no longer drift.
- **No migration, no policy change, no grant change, no new table or column, and no change to
  `src/lib/data/`.** `RideForEdit` already carries `is_public` and `club_id`, so the form has
  everything the new predicate needs.
- **`npm run walk`'s `refused edit` phase is touched**, because it flips `is_public` on a ride it
  did not choose the shape of — see §Impact and PD-311.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ride-lifecycle`: the requirement *Editing a ride SHALL NOT be able to strand its crew* is
  restated as a rule about the transition and its refusal message is rewritten; the adjacent
  ex-member requirement's *"detaching SHALL be offered only together with making the ride public"*
  sentence is re-derived from the new rule rather than left as a free-standing claim.

> **Read this delta against `add-ride-club-edit-delete`, not against `openspec/specs/`.** The
> `ride-lifecycle` capability is added by PD-101's change, which is still active and unarchived,
> so the base text these requirements modify lives in
> `openspec/changes/add-ride-club-edit-delete/specs/ride-lifecycle/spec.md`. Archive that change
> before this one, or the delta has nothing to attach to. Same shape as
> `share-a-ride-invite-link`'s delta against `invite-riders-to-a-ride`.

## Impact

| Touched | What |
|---|---|
| `src/components/rides/EditRideForm.tsx` | `wouldStrand` → a transition predicate; the alert's condition and text; `disabled` |
| `src/lib/actions/rides.ts` | `updateRide`'s guard moves after the `previous` read and compares against it; `createRide` unchanged |
| a new shared copy module | the one refusal string, and the audience hint both ride forms render |
| `src/components/rides/CreateRideForm.tsx` | renders the shared hint constant; **the rendered sentence is byte-identical** |
| `src/components/rides/__tests__/` | a new `EditRideForm.test.tsx`; the hint-pair assertion PD-320's review deferred to here |
| `scripts/walk.mjs` | the `refused edit` phase, which the guard's new shape changes — PD-311 |
| `supabase/**` | **nothing.** No migration; the RLS suite gains no assertion because no policy moves |

**What this change explicitly does NOT do**, because a relaxed client guard reads like a widened
policy to anyone skimming the diff: the `rides` UPDATE policy stays exactly as measured —
`USING (auth.uid() = organizer_id)`, `WITH CHECK (auth.uid() = organizer_id AND (club_id IS NULL
OR private.is_club_member(club_id)))`. No role gains any reach. Every negative case in the delta
that names a non-organizer is unchanged behaviour, restated so the next reader can see it was
checked rather than assumed.
