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

**A `security definer` writer SHALL restate the gate in its own body and SHALL NOT be given a
compensating trigger.** `private.join_club_from_invite` writes a `club_members` row as the owner, and
the gate trigger on `club_members` carries `when (current_user = 'authenticated')`, which can never
be true inside it. It therefore calls `private.may_participate_for(rider)` — the **subject-taking**
form, never `private.may_participate()`, which is caller-relative and on the claim path would answer
for the wrong rider entirely. Adding a trigger to compensate would raise the gate count while gating
nothing, which is what `078.9` asserts the absence of.

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
