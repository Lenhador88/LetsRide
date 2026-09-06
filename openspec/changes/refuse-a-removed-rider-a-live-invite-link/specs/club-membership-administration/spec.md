# club-membership-administration

> **Read this delta against the active change, not against `openspec/specs/`.** The
> `club-membership-administration` capability is added by `manage-club-riders` (PD-326) and **is not
> archived**, so the base text these requirements modify lives in
> `openspec/changes/manage-club-riders/specs/club-membership-administration/spec.md`. Archive that
> change before this one, or the delta has nothing to attach to.

## MODIFIED Requirements

### Requirement: What a removed rider keeps SHALL be stated per resource, not summarised

Removal SHALL cascade nothing — **no foreign key references `club_members`** and none SHALL be
added. Everything that changes SHALL change because a policy stopped returning true, and each SHALL
be asserted rather than reasoned about.

**One line of this table is now not about a policy**, and it is called out rather than folded in: an
invite link stops working for the removed rider because a record was written, not because a
predicate about them changed. It is the only entry here with a row behind it.

| Resource | After removal |
|---|---|
| their postcards in the club | rows survive; the club still sees them; the author still **reads** and **deletes** them; the author may **no longer edit** them |
| their club threads and messages | survive, visible to the club, invisible to them |
| deleting their own club **message** | still possible — `delete_own_club_message` gates on authorship alone |
| deleting their own **thread** | no longer possible — the DELETE policy conjuncts membership |
| a ride they organised in the club | untouched, still in the club |
| a private-club ride they are only **crew** on | the `ride_members` row survives and the ride, its roster and its chat become unreadable to them |
| their `feed_reads` and `club_thread_reads` rows | survive, frozen — both write predicates conjunct membership |
| notifications naming the club | evicted from the list **and** the count together, for a private club |
| the admins' "X joined club" notification about them | **survives** — `036` §7.6 decided that a notification records an event at an instant |
| **a live invite link into the club, in their hands** | **no longer claimable by them** — and by them alone; every other holder is unaffected |
| **a pending in-app invite to the club, in their hands** | **still acceptable** — the narrow reading refuses links only, and this is recorded as an open question rather than closed silently |
| **a join request for the club** | still theirs to make; an admin may still approve it, and approval clears the removal record |

#### Scenario: The author keeps their postcard and loses the ability to edit it
- **WHEN** a removed rider reads, deletes and attempts to edit their own postcard in the club
- **THEN** the read SHALL succeed through `postcards` SELECT's first arm, the delete SHALL succeed,
  and the edit SHALL be refused by the UPDATE policy's membership conjunct
- **AND** a remaining member SHALL still see the postcard

#### Scenario: The crew row outlives the ride's readability, and that is recorded rather than repaired
- **WHEN** a removed rider held a `ride_members` row for a private club's ride they did not organise
- **THEN** the row SHALL survive and the ride, its crew and its chat SHALL be unreadable to them
- **AND** this SHALL be recorded as an accepted consequence: evicting them would destroy an
  organizer's crew as a side effect of a club decision, which is the shape `043` refused when it
  declined to widen the `rides` DELETE policy

#### Scenario: The notification count falls with the list, in the same instant
- **WHEN** a rider is removed from a **private** club they held notifications about
- **THEN** those rows SHALL stop being returned by `036` §3's policy **and** SHALL stop being
  counted by `unread_notification_count()`, because that function is `security invoker` and reads
  the same predicate

#### Scenario: The link dies for one rider and for nobody else
- **WHEN** a rider is removed from a club with a live invite link that several riders hold
- **THEN** only that rider's claim SHALL be refused, and the link SHALL remain live, listed and
  revocable exactly as before

## REMOVED Requirements

### Requirement: Removal SHALL be indistinguishable from leaving, to everyone

**Reason**: Two of its clauses become false. It required that **no tombstone row SHALL be created**,
and this change creates one; and it asserted that a removed rider's every observable outcome matches
a rider who left, which stops being true on exactly one path — the invite-link claim. Keeping it
would leave two normative SHALLs asserting the behaviour PD-361 removes.

**Migration**: Replaced in this same delta by *Removal SHALL be indistinguishable from leaving in
every message, and SHALL differ only in what a link does*, below. Everything else the requirement
said is carried over verbatim: no notification, nothing recording who removed whom, the product
reason for the silence, and the public-club consequence.

## ADDED Requirements

### Requirement: Removal SHALL be indistinguishable from leaving in every message, and SHALL differ only in what a link does

No notification SHALL be written on removal, **nothing SHALL record who removed whom**, and no
message anywhere SHALL tell a rider they were removed.

**A row IS now written, and it is the one thing this requirement gives up.** A removal writes a
record keyed on the club and the rider so that a link minted before it cannot undo it. The three
properties that keep the rest of this requirement true SHALL all hold:

- **it names no actor** — there is no `removed_by` column and no equivalent, so *who removed whom*
  is still recorded nowhere;
- **it is readable by no client role at all**, including the rider it names and the admins of the
  club, so it is not a channel through which anybody learns anything;
- **it produces no message**: a refused claim reaches the invite link capability's single generic
  dead-token answer, identical to expiry, revocation and a guessed token.

**The reason for keeping the rest is a product rule and SHALL be stated as one**, because the
mechanism would in fact work: a row addressed to the removed rider with the club as subject is
readable for a public club through `036` §3's ordinary conjunct and for a private one through the
type-scoped disjunct. Telling a rider they were removed is a moderation statement addressed to the
person moderated, in an app with no appeal surface, and `085` already settled the principle — *a
club refuses as a club*.

**What is now distinguishable SHALL be stated honestly rather than claimed away.** A removed rider's
link claim fails where a rider who left voluntarily succeeds, so the two are no longer identical in
*behaviour* even though they remain identical in *what the app says*. The rider can infer the
difference by comparing with another holder of the same token. That is inherent to a removal that
holds, and it is accepted.

The honest consequence SHALL still be carried into the product rather than hidden: **on a public
club, removal is undone by the rider in one tap**, because the membership INSERT policy admits any
signed-in rider. The tool for keeping somebody out of everything is `blocks`, which is symmetric and
already enforced in every policy.

#### Scenario: Nothing is written to any surface the rider can see
- **WHEN** a removal completes
- **THEN** **zero** `notifications` rows SHALL be written
- **AND** the existing `club_joined` rows the club's admins hold about that rider SHALL survive
  unchanged
- **AND** the one row that is written SHALL be readable by no client role

#### Scenario: A removed rider's view is identical to a rider who left
- **WHEN** the removed rider's reads of the club, its roster, its rides and its threads are compared
  against the same reads by a rider who left voluntarily
- **THEN** they SHALL be identical, with no marker, gap or count distinguishing the two

#### Scenario: The one difference is the link, and it says nothing
- **WHEN** a removed rider and a rider who left voluntarily each claim a live link into that club
- **THEN** the first SHALL be refused and the second admitted
- **AND** the refusal's message SHALL be the same generic string every other dead token produces

#### Scenario: The public club's Join button is untouched
- **WHEN** a rider removed from a **public** club presses Join
- **THEN** they SHALL be admitted, and the removal record SHALL be cleared by that admission
