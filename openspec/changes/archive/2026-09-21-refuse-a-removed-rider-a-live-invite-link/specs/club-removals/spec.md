# club-removals

## Purpose

A record that a club removed a rider, held so that an admission grant minted *before* the removal
cannot undo it. It bars exactly one door — the invite-link claim path — and it is deliberately not
a ban: every route where the club decides per rider stays open, and the record is erased the moment
the club uses one of them.

## ADDED Requirements

### Requirement: A removal SHALL be recorded as state keyed on the pair, and SHALL hold no actor

`public.club_removals` SHALL hold `club_id`, `user_id` and `removed_at`, with the primary key
`(club_id, user_id)`. At most one row SHALL exist per pair at any time.

**It SHALL carry no `removed_by` or any other actor column.** `manage-club-riders` requires that
nothing anywhere records who removed whom, and this change keeps that true: an actor column would
be an audit trail with no reader, on the most sensitive fact in the table.

**It SHALL be state and not history.** A row means *this rider may not claim a link into this club
right now*, never *this rider was once removed*. Anything wanting the second meaning is a different
table with its own retention answer.

**Writing one SHALL be idempotent.** A second removal of the same rider from the same club SHALL
succeed and leave one row, so a re-removal after a re-admission cannot raise inside
`remove_club_member` and take an admin's removal down with it.

#### Scenario: The pair is the key
- **WHEN** the same rider is removed from the same club twice, with a re-admission between
- **THEN** exactly one row SHALL exist for that pair afterwards, and neither removal SHALL raise

#### Scenario: No actor is recorded
- **WHEN** the table's columns are read from the catalogue
- **THEN** no column SHALL identify the admin who performed the removal, in any form

#### Scenario: A removal of one rider does not touch another
- **WHEN** rider A is removed from club X
- **THEN** no row SHALL exist for rider B in club X, nor for rider A in club Y

### Requirement: A removal row SHALL be readable by no client role, including the rider it names

`public.club_removals` SHALL have RLS enabled, SHALL carry **no policy of any kind**, and SHALL
grant nothing to `anon`, to `authenticated`, or to any other client role. Every read and write SHALL
come from a `security definer` function.

Stated per role, because an unstated negative is how this project's access-control bugs happen:

| Role | May read a removal row | May write one | May delete one |
|---|---|---|---|
| the club's owner | **no** | no — only through `remove_club_member` | no — only by readmitting |
| a club admin | **no** | no — only through `remove_club_member` | no — only by readmitting |
| an ordinary member | **no** | **no** | **no** |
| the removed rider | **no** | **no** | **no** |
| any other signed-in rider | **no** | **no** | **no** |
| a rider blocked with anyone involved | **no** | **no** | **no** |
| a signed-out visitor | **no** — no session reaches any table | **no** | **no** |

**Nobody may enumerate the clubs that bar them, and nobody may enumerate the riders a club bars.**
The first would let a rider discover that private clubs exist and that they were removed from one;
the second is a moderation list with no screen behind it.

This SHALL produce one `rls_enabled_no_policy` INFO security advisor, which is expected and matches
the existing tables whose grants were revoked outright. An
`authenticated_security_definer_function_executable` WARN appearing with this change SHALL be
treated as a defect: it means a function was created in `public` that belongs in `private`.

#### Scenario: An admin cannot read the removals of their own club
- **WHEN** the owner or an admin of a club selects from `club_removals`, with or without a filter
- **THEN** the read SHALL be refused by the absent grant, not merely return zero rows

#### Scenario: The removed rider cannot detect the row
- **WHEN** the removed rider selects from `club_removals` for their own `user_id`
- **THEN** the read SHALL be refused, so the row is not a channel telling them they were removed

#### Scenario: No client role holds any grant
- **WHEN** `information_schema.role_table_grants` is read for `club_removals`, scoped to `anon` and
  `authenticated`
- **THEN** neither role SHALL hold SELECT, INSERT, UPDATE or DELETE
- **AND** the assertion SHALL be scoped to those grantees, because `postgres` and `service_role`
  hold everything by Supabase default

### Requirement: Only the removal RPC SHALL write a removal, so leaving voluntarily SHALL NOT record one

The row SHALL be written **inside `public.remove_club_member`'s body**, after its existing authority
checks and beside its existing deletes. No trigger on `club_members` DELETE SHALL write it.

**This is what distinguishes a removal from a departure, and both end as an absent `club_members`
row**, so the distinction cannot be recovered from the table afterwards — it has to be captured at
the moment of the act. `remove_club_member` is the only path that carries an authority check, so
the record is exactly co-extensive with *an admin decided this*.

A DELETE trigger SHALL NOT be used even though it could branch on `current_user`: it would also
fire for a cascade — the club being deleted, the rider's account being deleted, and any future
bulk path — recording removals nobody performed.

Consequently, **none** of the following SHALL write a removal row: a rider leaving through
`club_members`' own DELETE policy, a club being deleted, an account being deleted, or any cascade.

#### Scenario: A rider who leaves keeps their links
- **WHEN** a rider leaves a private club voluntarily and then claims a live invite link to it
- **THEN** no removal row SHALL exist for the pair and the claim SHALL admit them

#### Scenario: A removal writes the row in the same transaction as the delete
- **WHEN** an admin removes a rider
- **THEN** the removal row and the absence of the membership row SHALL be visible together, and a
  failure of either SHALL roll back both

#### Scenario: An unauthorised removal attempt records nothing
- **WHEN** a member, an outsider, or an admin attempting to remove a peer admin calls
  `remove_club_member`
- **THEN** it SHALL reach its existing single raise site and **zero** removal rows SHALL be written

#### Scenario: Deleting a club writes no removals
- **WHEN** a club with members is deleted
- **THEN** no removal row SHALL be written for any of them

### Requirement: A removal SHALL bar the invite-link claim path and SHALL bar nothing else

The record SHALL be consulted by exactly one predicate, in the single definition of *this caller may
use this token*, so that the preview and the claim answer identically and neither public RPC body
restates it.

**Every other admission path SHALL be unaffected, and this SHALL be asserted rather than assumed**,
because it is the whole content of the narrow reading:

| Path | A removed rider |
|---|---|
| claiming an invite link into that club | **refused** |
| requesting to join that club again | permitted, and an admin may approve it |
| accepting an in-app invite to that club | permitted |
| pressing Join on that club while it is **public** | permitted |
| claiming an invite link into a **different** club | permitted |
| everything outside that club | unchanged in every respect |

**On a public club the bar is nearly decorative, and that is a stated limit rather than an
oversight.** A removed rider may press Join, because `club_members`' INSERT policy admits any
signed-in rider to a public club, and narrowing that policy is the club-level ban this change
deliberately is not.

#### Scenario: The same link, after removal
- **WHEN** a removed rider re-opens the very link that admitted them
- **THEN** the preview SHALL return zero rows and the claim SHALL reach its single raise site

#### Scenario: A newer link to the same club, minted after the removal
- **WHEN** an admin mints a fresh link and the removed rider claims it
- **THEN** it SHALL also be refused, because the bar is keyed on the pair and not on the link
- **AND** this SHALL be recorded as the deliberate consequence it is: an admin cannot re-invite a
  removed rider **by link**, and their remedy is an in-app invite or approving a request

#### Scenario: A link to a different club still works
- **WHEN** a rider removed from club X claims a live link into club Y
- **THEN** they SHALL be admitted to Y, with the removal row for X untouched

#### Scenario: Another rider's claim of the same token is unaffected
- **WHEN** a second rider, not removed, claims the same token after the removal
- **THEN** they SHALL be admitted

#### Scenario: The join-request path is measurably untouched
- **WHEN** a removed rider requests to join the private club again and an admin approves it
- **THEN** the request SHALL be created and the approval SHALL admit them
- **AND** no predicate, policy or function of the join-request path SHALL reference `club_removals`

#### Scenario: The in-app invite path is measurably untouched
- **WHEN** an admin invites a removed rider to the same private club and the rider accepts
- **THEN** they SHALL be admitted
- **AND** the invite path's admissibility helpers SHALL not reference `club_removals`

### Requirement: A removal SHALL be cleared by any readmission, by any route

An `after insert on public.club_members` trigger SHALL delete the removal row for the pair that has
just become a member.

**This is what stops the bar becoming a permanent ban**, which is the reason the narrow reading was
chosen. Without it, a rider removed in January and readmitted in February is still barred from a
link in July — invisibly, with no row anybody can read and no message that says so.

It SHALL be route-agnostic: an approved join request, an accepted in-app invite, a public club's
Join button and any future admission path SHALL all clear it, because the trigger observes the
membership row rather than the route that wrote it.

It SHALL NOT raise. It runs inside every club join in the app, alongside the existing join
notification trigger, and a raise there takes a rider's join down with it.

**It SHALL be `security definer` with `set search_path = ''`, and that is not a style choice — it
is the difference between this change working and every club join in the app failing.** A Postgres
trigger function is `security invoker` by default, so its `delete from public.club_removals` would
execute as the *invoking* role. `club_removals` grants nothing to `authenticated` and carries no
policy, so a signed-in rider pressing **Join** on a public club would raise `42501 permission
denied for table club_removals`, and the `club_members` INSERT would roll back with it. All three
triggers already on `public.club_members` — `enforce_participation_gate`, `notify_club_joined` and
`protect_club_owner_membership` — are `security definer` with `set search_path = ''` for the same
reason; copying the shape of the one beside it means copying its privilege mode, not only its
absent `WHEN` clause.

**The failure is decided by the writer's role and not by whether a removal row exists**, because
Postgres checks table privileges at executor start rather than per row. So the one client-direct
join path fails on every attempt that inserts a row, while **every other admission path — both
invite paths, the approved join request, the default-club join and the creator trigger — is already
`security definer`** and inherits the owner's rights, succeeding silently. That is why the
assertion below reads the catalogue rather than trusting a join that worked.

#### Scenario: Readmission clears the bar
- **WHEN** a removed rider is readmitted by any route and later leaves voluntarily, then claims a
  live link
- **THEN** no removal row SHALL exist and the claim SHALL admit them

#### Scenario: Clearing is scoped to the pair
- **WHEN** a rider removed from clubs X and Y is readmitted to X
- **THEN** the row for Y SHALL survive untouched

#### Scenario: The join path still works, unchanged
- **WHEN** a rider with no removal row joins a club by every available route
- **THEN** each join SHALL succeed, and the existing join notification fan-out SHALL be unchanged in
  recipients and row count

### Requirement: The refusal SHALL be one more dead-token outcome, disclosing nothing

A removed rider SHALL see the existing generic dead-link message and SHALL NOT be told that they
were removed, that the club exists, or that the token was ever valid.

**Removal stays indistinguishable from leaving in every message the app writes**, which is the
existing requirement this change must not reverse through a side channel. A distinct message would
be a moderation statement addressed to the person moderated, delivered at a moment they chose
rather than a moment anybody decided.

**The behavioural difference is accepted and named.** A removed rider's claim fails where another
rider's claim of the same token succeeds, so a rider comparing notes can infer that they are the
odd one out. That is inherent to any fix that works, and it discloses a fact about the rider to the
rider.

**No notification SHALL be written**, to the removed rider or to the club, by the removal or by the
refused claim.

#### Scenario: The message is identical to expiry
- **WHEN** a removed rider claims a live link, and the same rider claims an expired one
- **THEN** the two SHALL be indistinguishable in message, SQLSTATE and rendered copy

#### Scenario: No copy anywhere names a removal
- **WHEN** the landing screen's failure states are read
- **THEN** none SHALL mention removal, and the existing string SHALL be unchanged

#### Scenario: The refusal writes nothing
- **WHEN** a refused claim completes
- **THEN** zero `notifications` rows, zero `club_members` rows and zero `club_removals` rows SHALL
  be written

### Requirement: A removal SHALL have a stated retention window and SHALL cascade from both ends

A removal row is personal data — it names one rider and one club — so its window is stated at
creation rather than left open:

**A removal row SHALL live until the first of: the rider is readmitted to that club, the club is
deleted, or the rider's account is deleted.** There SHALL be no expiry on a timer, because a
removal is a decision a club made and nothing else in this app decays a decision on a clock.

`club_id` SHALL cascade from `clubs` and `user_id` SHALL cascade from the rider's profile, so both
deletions erase the row without a sweep, a job or an Edge Function.

**Account deletion SHALL therefore need no new step.** The existing deletion path removes the
rider's profile row and the cascade takes every removal naming them, in the same transaction.

#### Scenario: Deleting the club erases its removals
- **WHEN** a club holding removal rows is deleted
- **THEN** every removal row for that club SHALL be gone

#### Scenario: Deleting the account erases the rider's removals
- **WHEN** a rider with removal rows in several clubs deletes their account
- **THEN** every removal row naming them SHALL be gone, with no step added to the deletion path

#### Scenario: A dead club's token is doubly refused
- **WHEN** a removed rider claims a token whose club has since been deleted
- **THEN** the link row SHALL already have been cascaded away, and the outcome SHALL be the same
  single dead-token answer

### Requirement: The owner and the default club SHALL be unreachable by this record

No removal row SHALL ever name a club's owner, and none SHALL be written for a rider removing
themselves, because `remove_club_member` already refuses both and this change adds no argument and
no arm with which to try.

The default club SHALL be unaffected in every direction: no invite link into it can exist, and the
removal RPC's existing refusals are unchanged.

**Nothing new about who may remove whom SHALL be implied.** An admin still may not remove a peer
admin, only the owner may remove an admin, and nobody removes the owner.

#### Scenario: The owner cannot be barred
- **WHEN** any caller attempts to remove the club's owner
- **THEN** the existing refusal SHALL fire and no removal row SHALL be written

#### Scenario: Self-removal still refuses and records nothing
- **WHEN** an admin calls the removal RPC naming themselves
- **THEN** it SHALL refuse, and leaving SHALL remain the membership table's own DELETE policy

#### Scenario: The permission table is unchanged
- **WHEN** every combination of actor role and target role is exercised against the removal RPC
- **THEN** the outcomes SHALL match the existing table exactly, with the removal row appearing only
  where a removal already succeeded

### Requirement: A removal SHALL NOT serialise against a claim already in flight

The claim path takes a share lock on the **link** row, not on the removal record, so a claim that
has already resolved reachability MAY commit after a removal commits.

**The window SHALL be documented rather than closed.** Closing it means locking a row that does not
exist yet, on a path where the two actors are not contending for the same object. The remedy is
that a second removal is idempotent and available immediately.

**The state the club is left in SHALL be stated exactly, because it is not the obvious one**: the
winning claim writes a membership row, which fires the clearing trigger, so the club is left with
the rider as a member and **no** removal record — the same state as if the removal had never
happened. It is not a half-applied removal, and nothing is left for a later path to trip over.

#### Scenario: The race is bounded by re-removal
- **WHEN** a claim commits immediately after a removal of the same rider from the same club
- **THEN** the rider SHALL be a member and the removal row SHALL have been cleared by the trigger
- **AND** a second `remove_club_member` call SHALL succeed, remove the membership, and leave exactly
  one removal row
