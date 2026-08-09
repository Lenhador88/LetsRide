## ADDED Requirements

### Requirement: A `security definer` function reached by a client SHALL re-check authorization internally

`public.delete_owned_club` is the first function in this repo that a **client** calls with
elevated rights. Every existing `security definer` function is either own-row by construction
(`accept_terms`, `complete_onboarding`, `my_onboarding_state`), narrow by construction
(`moderate_comment` deletes one comment on a postcard the caller authored), a policy helper
(`private.is_*`), or `service_role`-only (`private.transfer_owned_clubs`). This one takes an
arbitrary id from the client and destroys rows.

Therefore any `security definer` function granted to `authenticated` SHALL:

- **Re-state the authorization predicate its caller's RLS would have applied.** `security
  definer` runs with the owner's rights, so the `clubs` DELETE policy does not protect the rows
  the function touches. The ownership test is the function's own job and its absence is not
  visible in any policy listing.
- **Pin `SET search_path`**, so a client-controlled `search_path` cannot redirect a table
  reference inside a definer-rights body.
- **Be asserted by naming the role**, `has_function_privilege('authenticated', …, 'EXECUTE')`,
  rather than by calling it. The RLS suite runs as the table owner, for whom the `EXECUTE`
  barrier does not exist — `031` shipped a function nothing could call because the suite could
  call it fine.
- **Be asserted for refusal by a non-owner**, not only for success by an owner. A definer
  function that has lost its ownership check passes every positive test.
- **Be recorded in `CLAUDE.md`'s security-advisor table.** It raises
  `authenticated_security_definer_function_executable`, taking the count from six to seven and
  the total from eight to nine. An advisor absent from that table reads as a regression; a
  deliberate one that was never added there reads as a regression for ever.

#### Scenario: The ownership check is removed from the function body

- **WHEN** `delete_owned_club` is altered so it no longer compares `owner_id` to `auth.uid()`
- **THEN** the RLS suite SHALL fail on the non-owner refusal assertion

### Requirement: A cascade whose blast radius crosses an ownership boundary SHALL be disclosed at the point of action

`postcards.club_id → clubs` is `ON DELETE CASCADE`, so deleting a club destroys postcards authored
by riders who are not the actor. The cascade itself is settled (`009`, for a club deleted by its
owner) and is not reopened. What this requirement adds is that **the database's blast radius SHALL
be surfaced to whoever triggers it**, with live counts read under the actor's own RLS, before the
irreversible step.

This generalises past the club case on purpose: the next `ON DELETE CASCADE` that crosses from one
rider's row to another rider's content inherits it.

#### Scenario: A destructive action's counts cannot be read

- **WHEN** the counts behind a cross-ownership cascade cannot be fetched
- **THEN** the destructive action SHALL be refused rather than offered with a blank or zero count

### Requirement: A trigger that rewrites rows a client did not name SHALL be disclosed before the write

`propagate_club_privacy_to_rides` fires on a club's `is_public` update and rewrites `rides` rows
the client never mentioned, one-directionally. A rider toggling one switch cannot infer that from
any screen.

Any trigger that mutates rows outside the client's own statement SHALL be surfaced in the UI that
triggers it, including whether the effect reverses. Silent fan-out that is *additive* — the `036`
notification triggers — is exempt; this requirement is about fan-out that **destroys or
downgrades** existing state.

#### Scenario: A club is made private

- **WHEN** the owner submits `is_public = false`
- **THEN** the screen SHALL have stated beforehand that the club's public rides become private and
  are not restored by making the club public again

## MODIFIED Requirements

### Requirement: An integrity rule SHALL live in the database, and a rule that reaches only TypeScript SHALL be labelled advisory

The standing rule is unchanged: a rule about *what a value may be* must end up as a CHECK, trigger
or policy, because the client owns the mutation path.

**This change adds the case the rule did not previously cover: a rule about *which columns a write
may touch*.** `authenticated` holds table-level UPDATE on every column of `rides` and `clubs`,
including `id`, `created_at`, `organizer_id` and `owner_id`. The `WITH CHECK` clauses stop
`organizer_id` and `owner_id` from moving, but nothing stops `created_at` being rewritten by any
organizer or owner.

`updateRide` and `updateClub` SHALL construct their payloads from an explicit field list. That is
a TypeScript rule with no constraint behind it, so it SHALL be **labelled advisory** wherever it
is written down, and the column-grant narrowing that would make it real SHALL be recorded as an
open follow-up rather than left implied. `ride_messages` narrowed its INSERT grant per column at
birth for exactly this reason; `rides` and `clubs` predate that practice.

#### Scenario: An update action spreads a parsed object

- **WHEN** an update action passes a spread of parsed form data to `.update()`
- **THEN** review SHALL reject it in favour of an explicit field list
- **AND** the spec SHALL NOT claim the database prevents the extra column
