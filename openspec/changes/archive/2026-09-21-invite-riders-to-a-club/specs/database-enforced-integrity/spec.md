# database-enforced-integrity

## ADDED Requirements

### Requirement: A grant one rider can cause for another SHALL be re-derived at every use, never trusted from creation

Where a rider's action creates something that will later admit **another** rider — an invite, a
capability token — the authority behind it SHALL be evaluated again at the moment of use, against the
current state of the club and of the rider who created it. A policy check at creation SHALL NOT be
treated as evidence of authority at redemption.

**This is a new class of rule in this schema, and it exists because every other grant here is a fact
that is still true when it is read.** Ownership, membership and a block are all evaluated at read
time by construction. An invite is the first artefact that carries a *past* decision forward, and a
past decision by a rider who has since left, been demoted, or whose club has changed shape is not a
decision the club is still making.

`private.may_invite_to_club_for(candidate, club)` SHALL therefore be called by:

- the INSERT policy, through its caller-relative wrapper;
- `private.join_club_from_invite`, for the **inviter** or the link's **minter**, before the
  membership row is written;
- `private.club_invite_is_answerable_for` and `private.club_invite_link_reachable_by`, so a dead
  grant disappears from the surface rather than presenting a control that always fails.

`091`'s `expires_at` is the same rule in its narrow form — the ride's departure is re-read at every
use rather than trusted from the stored column — and this requirement generalises it from a
timestamp to an authority.

#### Scenario: An outstanding invite dies with its inviter's authority
- **WHEN** the inviter leaves the club or is demoted from `admin`, and the invitee then accepts
- **THEN** no membership row SHALL be written, and the refusal SHALL be the surface's single
  indistinguishable message

#### Scenario: A pointer does not become a grant when the club changes shape
- **WHEN** an ordinary member invites a rider to a **public** club and the club is then made private
- **THEN** the accept SHALL be refused, because `may_invite_to_club_for` is false for a member of a
  private club
- **AND** the same invite sent by an **admin** SHALL still be accepted

#### Scenario: The check is in the writer, not only in the policy
- **WHEN** `private.join_club_from_invite`'s body is read
- **THEN** it SHALL contain the authority test, the participation test and both block tests, because
  a `security definer` writer bypasses the policies and the trigger that would otherwise carry them

#### Scenario: A single raise site survives the extra checks
- **WHEN** any of those tests fails
- **THEN** the function SHALL return `false` rather than raising, so its caller keeps one observable
  failure and a block is not disclosed by a second error string or a different SQLSTATE

## MODIFIED Requirements

### Requirement: Onboarding completion SHALL gate participation, not only navigation

A rider whose `profiles.onboarding_completed_at` is NULL MUST NOT be able to create content or join
anything, and the refusal SHALL come from the database rather than from a redirect.

**The gate's scope SHALL be counted rather than enumerated.** The rule that does not go stale:
*every table into which a rider inserts content another rider can see carries the gate.* Both tables
this change adds do — `club_invites`, because inviting is participation, and `club_invite_links`,
because minting a bearer token into a club is participation — so the count moves by **+2**, and the
delta SHALL be asserted together with the two table names, never the absolute:

```sql
select count(*) from pg_trigger
 where tgname = 'enforce_participation_gate' and not tgisinternal;
```

**17 on DEV and 17 on PROD, measured 2026-08-31**, before the concurrent changes holding `092`,
`094` and `095` land. An absolute after-count is therefore meaningless in isolation, which is
exactly why the rule is stated as a delta plus two names.

**A table no rider can insert into at all is a third case and needs no gate**, because the gate
constrains *who may write* and there is nobody to constrain. `notifications` is the first of these:
`authenticated` holds no INSERT grant and the table carries no INSERT policy, so its only writer is
a `security definer` trigger. Adding the gate there would be worse than useless — inside a
`security definer` function `current_user` is the owner, so the gate's own
`WHEN (CURRENT_USER = 'authenticated')` clause is false and the trigger would never fire, which
reads as coverage and is not.

An un-onboarded rider also has a NULL `username`, which the `profiles` SELECT policy uses to
hide them from other riders — so their content would appear to everyone else with an
unresolvable author.

**What completion requires is `username` + consent, and NOT a location (PD-286).** The location
arm was part of this invariant from `003` §6a until `075`, and it was written down in three places
that had to agree: `complete_onboarding`'s own restatement, `enforce_onboarding_completion`'s
INSERT arm, and its UPDATE arm. The requirement is unchanged in *shape* — completion is still a
one-way stamp the client cannot forge, still refused without a username, still refused without
consent — and one conjunct narrower. `profiles.location` survives as an ordinary rider-editable
column with `018`'s length CHECK; what stops existing is the claim that a rider must fill it in
before they may participate.

**A `security definer` writer SHALL restate the gate in its own body and SHALL NOT be given a
compensating trigger.** `private.join_club_from_invite` writes a `club_members` row as the owner, and
the gate trigger on `club_members` carries `when (current_user = 'authenticated')`, which can never
be true inside it. It therefore calls `private.may_participate_for(rider)` — the **subject-taking**
form, never `private.may_participate()`, which is caller-relative and on the claim path would answer
for the wrong rider entirely. Adding a trigger to compensate would raise the gate count while gating
nothing, which is what `078.9` asserts the absence of.

#### Scenario: An un-onboarded rider cannot create content
- **WHEN** a rider whose `onboarding_completed_at` is NULL inserts into any table carrying
  `enforce_participation_gate`
- **THEN** the database SHALL reject the write
- **AND** the set of such tables SHALL be verified by counting the trigger rather than by reading a
  list, because a table added without one is indistinguishable from a correct list

#### Scenario: Per-viewer tables are deliberately excluded
- **WHEN** an un-onboarded rider inserts into `blocks`, `postcard_hides`, `feed_reads`,
  `profile_countries` or their own `profiles` row
- **THEN** the write SHALL succeed, because none of these produces content another rider can
  see and `profiles` is the row the wizard itself writes
- **AND** the exclusion SHALL be stated in the migration rather than left as silence

#### Scenario: A table with no INSERT grant is a third category and carries no gate
- **WHEN** a table exists into which no client role may insert — `notifications` is the first
- **THEN** it SHALL carry no participation gate
- **AND** the absence SHALL be recorded as deliberate in its migration, because the gate's
  `WHEN (CURRENT_USER = 'authenticated')` clause is false inside a `security definer` writer and a
  gate that never fires reads as coverage
- **AND** the enforcement SHALL instead be that the gate on the **parent** table already refused
  the event, so no un-onboarded rider's action can reach the fan-out at all

#### Scenario: An un-onboarded rider cannot file moderation records
- **WHEN** a rider who has not completed onboarding reports a postcard
- **THEN** the write SHALL be refused
- **AND** this SHALL hold regardless of whether an address is verified, because the gate is the
  onboarding stamp and never the address. The requirement previously justified itself by
  "email confirmation is off (decision #6)"; that premise was measured false on 2026-08-06
  (`mailer_autoconfirm: false` — confirmation is required). The rule is unchanged and its
  justification is stronger without the premise: a verified address is not evidence of
  onboarding, and no admin role exists to triage reports either way

#### Scenario: Completing onboarding is still the only way through
- **WHEN** the same rider sets a username, has a consent stamp, and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way, SHALL remain refused while `username` is NULL, and SHALL
  remain refused while `terms_accepted_at` is NULL — unchanged from `003` §6b and `023` §1.13
- **AND** it SHALL NOT be refused for a NULL `location` (PD-286), which is the one conjunct `075`
  removes

#### Scenario: Reading is unaffected
- **WHEN** an un-onboarded rider reads any table
- **THEN** the existing policies SHALL apply unchanged, so this requirement adds no new read
  restriction and cannot strand a rider mid-wizard

#### Scenario: A revoked consent stops a sitting crew member writing
- **WHEN** `private.may_participate()` is extended to require the current terms version, and a
  rider who is already on a ride's crew has consented only to an earlier one
- **THEN** their next message insert SHALL be refused with `check_violation`
- **AND** their read of the thread SHALL be unaffected, because the gate is on writes only
- **AND** this is the case in which the gate on `ride_messages` stops being defence in depth,
  which is why the trigger ships before the case exists

#### Scenario: An un-onboarded rider cannot invite or mint
- **WHEN** a rider whose `onboarding_completed_at` or `terms_accepted_at` is NULL inserts into
  `club_invites` or `club_invite_links`
- **THEN** the write SHALL be refused with `check_violation` by the gate

#### Scenario: An un-onboarded rider cannot be admitted by anybody else's action
- **WHEN** an onboarded admin's invite is accepted by an un-onboarded rider, or such a rider claims a
  live token
- **THEN** no `club_members` row SHALL be written, and the refusal SHALL come from
  `private.may_participate_for` inside the writer rather than from a trigger

#### Scenario: The gate is not reachable through the read path either
- **WHEN** an un-onboarded rider calls `club_invite_link_preview` or `my_live_club_invites`
- **THEN** both SHALL return zero rows, because a `security definer` read has no policy beneath it
  and a check absent from the body is absent everywhere

#### Scenario: The count is asserted as a delta with names
- **WHEN** the suite checks the gate after `093`
- **THEN** it SHALL assert the trigger is present **by table name** on both new tables **and** that
  the flat count rose by exactly two, because a count alone cannot tell a new gate from a moved one

### Requirement: A table with no designed edit SHALL carry no UPDATE grant

A table whose rows have no rider-editable column SHALL hold no UPDATE grant and no UPDATE policy for
any client role. **The absence is the enforcement**: with RLS on, a command with no policy is refused
for every row.

Both tables this change adds are in that class, and each has one column a client would otherwise be
able to write to its own advantage:

- **`club_invites`** — `status` and `responded_at` are written by `accept_club_invite` and
  `decline_club_invite` alone. A grant here would let an invitee answer on the inviter's behalf, or
  an inviter mark their own invite accepted.
- **`club_invite_links`** — `revoked_at` is written by `revoke_club_invite_link` alone. A grant on
  that column would let a client **un-revoke** by writing NULL back, which is worse than the edit it
  appears to allow.

**Editing is a design problem, not a permission one.** It means deciding whether "edited" is
disclosed, from when, and what the record of a conversation means once it can be rewritten. None
of that exists for any table in this schema.

**One designed mutation is the same answer, not an exception — `091`.** Where a table has exactly
one, that mutation SHALL be a `security definer` RPC and the table SHALL still carry no UPDATE
grant and no UPDATE policy for any client role. `public.ride_invite_links` has exactly one: revoke.
A column grant on `(revoked_at)` would let a client write NULL and **un-revoke** a link the
organizer killed, and would let them write a future timestamp.
`public.revoke_ride_invite_link` is therefore the only path, with one raise site so a caller learns
nothing about a link that is not theirs.

#### Scenario: Revoke is not reversible by a client
- **WHEN** any rider attempts to UPDATE `ride_invite_links` by any route
- **THEN** it SHALL be refused, asserted per grantee with `has_table_privilege` rather than by a
  grant-row count, since `postgres` and `service_role` hold everything by Supabase default

#### Scenario: Nobody can update a ride message
- **WHEN** any rider — including its author and the ride's organizer — attempts to UPDATE
  `ride_messages`
- **THEN** the write SHALL be refused
- **AND** both the absent policy and the absent grant SHALL be asserted, because either alone
  would be undone by a single future line

#### Scenario: An upsert against such a table uses do-nothing, not do-update
- **WHEN** a caller writes an upsert against a table with no UPDATE grant
- **THEN** it SHALL use `on conflict do nothing`
- **AND** `on conflict do update` SHALL be refused with `42501` rather than silently affecting
  nothing

#### Scenario: The absence is a recorded gap, not an accident
- **WHEN** a table is created with no UPDATE path
- **THEN** the migration SHALL say so explicitly
- **AND** the day editing is designed, adding the grant SHALL be understood as a deliberate
  widening rather than a one-line fix

#### Scenario: Neither table takes an UPDATE
- **WHEN** `has_table_privilege` is asked for `authenticated` and for `anon`, for UPDATE, on both
  tables
- **THEN** all four answers SHALL be false, asserted per grantee — a table-wide count reads 2 against
  a correct database, because `postgres` and `service_role` hold everything by Supabase default
- **AND** `pg_policies` SHALL show no UPDATE policy on either

#### Scenario: The CRUD set is deliberately incomplete
- **WHEN** a later change adds an UPDATE policy to either table
- **THEN** it SHALL state which RPC it replaces and why, because completing the set is how the
  un-revoke and the answer-your-own-invite paths arrive
