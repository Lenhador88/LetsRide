## ADDED Requirements

### Requirement: A username SHALL NOT be removable once set

`public.profiles.username` SHALL be durable from the moment it first holds a value. Once
`username` is non-NULL, no write issued by the `authenticated` role SHALL be able to return it to
NULL, and the refusal SHALL come from the database rather than from the absence of a screen that
offers it.

**This is a live defect, not a risk this change introduces.** Reproduced on `letsride-dev`
2026-08-08 as `authenticated` with `request.jwt.claims.sub` set to the row's own id, inside a
transaction that was rolled back: `update public.profiles set username = null` succeeded and the
stored value became NULL. On production, `authenticated` holds column-level UPDATE on `username`
(`025` re-granted it per column), both CHECK constraints admit NULL by construction, and
`enforce_onboarding_completion` guards `terms_accepted_at` and `onboarding_completed_at` only.

**Why this is a visibility rule and not a data-hygiene one.** The `profiles` SELECT policy is
`(auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))`, so
username-nullness is the predicate that hides an unfinished signup from every other rider. A rider
who nulls their own username therefore removes their row from every other rider's read — bylines,
comment authors, member lists, ride crews and the availability check — while continuing to see it
themselves. `003` makes `onboarding_completed_at` one-way and requires a username to reach it, so
the resulting row is in a state onboarding declares impossible, and the route guard reads the
surviving completion stamp and sends the rider to `/postcards` rather than back into the wizard.
Decision #7 makes the username the only display name there is; there is no `full_name` to fall
back to.

The rule is **"once set, never unset"**, keyed on the username's own prior value rather than on
onboarding completion, so it also covers a rider who chose a name at step 1 and has not yet
finished step 2.

**The invariant is the stored value**: after any such write, `username` SHALL hold what it held
before. Whether the attempt is refused with an error or absorbed silently is an error-surface
choice, not part of this contract — `design.md` §D2 makes it and owns it.

#### Scenario: An onboarded rider cannot null their own username

- **WHEN** a rider whose `onboarding_completed_at` is set updates their own `profiles` row with
  `username` set to NULL, by any route including a direct PostgREST request
- **THEN** the stored `username` SHALL be unchanged
- **AND** the rider SHALL remain visible to every other signed-in, non-blocked rider, in
  postcard bylines, comment authors, club member lists and ride crews

#### Scenario: A rider mid-onboarding cannot null a username they have already chosen

- **WHEN** a rider whose `onboarding_completed_at` is NULL, and whose `username` is already set,
  updates their own row with `username` set to NULL
- **THEN** the stored `username` SHALL be unchanged
- **AND** the name SHALL remain unavailable to any other rider attempting to take it, enforced by
  the `profiles_username_lower_key` unique index rather than by what the availability check
  reports — so a name cannot be freed and re-taken by this route

#### Scenario: An upsert is not a second route into the column

- **WHEN** a rider issues a PostgREST upsert against their own row —
  `Prefer: resolution=merge-duplicates`, which compiles to `INSERT … ON CONFLICT DO UPDATE` —
  carrying `username` as NULL
- **THEN** the stored `username` SHALL be unchanged
- **AND** this SHALL be asserted rather than derived: `authenticated` holds INSERT on `username`
  and an INSERT policy exists, so the upsert is a genuine second client route into the column, and
  "the BEFORE UPDATE trigger fires for the DO UPDATE arm" is a two-step derivation that no test
  currently pins

#### Scenario: The legitimate first write is unaffected

- **WHEN** a rider whose `username` is NULL sets it to a valid value
- **THEN** the write SHALL succeed, unchanged from today
- **AND** onboarding step 1 SHALL remain an ordinary UPDATE against a column `authenticated`
  still holds, so no new function, grant or client change is required to complete it

#### Scenario: Completing onboarding still works

- **WHEN** a rider who has set a username calls `complete_onboarding(location)`
- **THEN** the stamp SHALL be written exactly as before
- **AND** the function's own username guard SHALL remain the thing that enforces "no completion
  without a username", because a `security definer` function runs as the owner and the trigger's
  `current_user <> 'authenticated'` gate short-circuits for it

#### Scenario: A security definer function is not covered and the gap is stated, not assumed

- **WHEN** any `security definer` function updates `profiles.username`
- **THEN** this requirement SHALL NOT be relied upon to stop it, because `current_user` inside
  such a function is the function's owner and the trigger returns early for any role that is not
  `authenticated`
- **AND** **six** functions reference `public.profiles` and every one of them is
  `security definer` — `private.may_participate`, `private.transfer_owned_clubs`,
  `public.accept_terms`, `public.complete_onboarding`, `public.handle_new_user`,
  `public.my_onboarding_state`. **Three of them write it** (`accept_terms`,
  `complete_onboarding`, `handle_new_user`); none writes `username`, which is why the gap is
  empty today rather than merely unexplored
- **AND** `public.handle_new_user` is the one to watch: it INSERTs the profile row at signup and
  deliberately leaves `username` NULL. Seeding a username there from OAuth or `user_metadata`
  would be a write this requirement does not reach, so that change SHALL carry the rule in its
  own body
- **AND** any future one SHALL restate the rule in its own body, the way `complete_onboarding`
  already restates `003`'s and `023`'s guards for the same reason

#### Scenario: Operator and service paths keep their escape hatch

- **WHEN** `service_role`, `postgres`, the seed, or the signup trigger writes `profiles.username`,
  including writing NULL
- **THEN** the write SHALL proceed, because the trigger's existing `current_user <> 'authenticated'`
  gate is preserved rather than narrowed
- **AND** this SHALL be deliberate: it is what keeps a rider stranded by any future defect
  repairable from the dashboard, and it is why this rule is not expressed as a CHECK constraint,
  which no role can pass

#### Scenario: Account deletion and club transfer are unaffected

- **WHEN** the account-deletion path runs — the `delete-account` Edge Function as `service_role`,
  and `private.transfer_owned_clubs` behind `031`'s wrapper
- **THEN** it SHALL behave exactly as `029`–`032` specify
- **AND** deletion SHALL remain a hard delete of the `auth.users` row cascading to `profiles`,
  not an anonymisation that blanks the username, so nothing in that path writes `username` at all

#### Scenario: An empty or whitespace-only username is already refused and stays refused

- **WHEN** a rider writes `''`, `'  '`, a two-character name, or a value containing a newline into
  `profiles.username`
- **THEN** the database SHALL reject the write with `23514`, unchanged from `003`
- **AND** this SHALL be enforced by `profiles_username_format`
  (`username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'`), which admits neither the empty string
  nor whitespace nor an embedded newline — verified against the live constraint rather than
  assumed, because "NULL is the only hole" is only true if the empty string is genuinely closed

#### Scenario: Deleting the profile row is not an alternative route to invisibility

- **WHEN** a signed-in rider deletes their own `public.profiles` row
- **THEN** zero rows SHALL be deleted, because no DELETE policy on `profiles` exists
- **AND** this SHALL be asserted rather than assumed: `authenticated` holds a table-level DELETE
  **grant** (measured `true`), so the refusal today rests entirely on the absence of a policy, and
  an assertion is what stops a future permissive policy from reopening the hole this requirement
  closes

### Requirement: Every role's reach into a rider's identity SHALL be stated

The rule above changes what one role may write. Each role that can reach `profiles.username` at
all SHALL have its access stated so that each line maps onto an assertion, because an unstated
negative silently becomes whatever the migration author assumed.

#### Scenario: The rider themselves

- **WHEN** a rider reads or writes their own `profiles` row
- **THEN** they SHALL read every column their grants permit, SHALL set `username` while it is
  NULL, SHALL change it to another valid value while Q1 remains unanswered, and SHALL NOT return
  it to NULL

#### Scenario: Any other signed-in rider

- **WHEN** a signed-in rider updates a `profiles` row that is not their own, setting `username` to
  NULL or to anything else
- **THEN** zero rows SHALL be affected, because the UPDATE policy is `auth.uid() = id`
- **AND** this SHALL hold irrespective of the new rule, which never widens who may write

#### Scenario: A blocked rider

- **WHEN** rider A blocks rider B, and B reads A's `profiles` row by any route
- **THEN** zero rows SHALL be returned, unchanged, and the same SHALL hold with A and B exchanged
- **AND** this change SHALL open no new inference channel. **One pre-existing channel is stated
  rather than denied**: `profiles_username_lower_key` is a plain unique index, so B attempting to
  take A's name gets `23505` and learns it exists, while `isUsernameTaken` reads under the
  block-aware SELECT policy and reports it free. That asymmetry predates this change, is unaltered
  by it, and is the reason the mid-onboarding scenario above is worded against the index rather
  than against the availability check

#### Scenario: Club owner, admin, member and non-member

- **WHEN** a rider holding any `club_members.role` — `owner`, `admin` or `member` — or holding no
  membership at all, reaches another rider's profile through a club roster, a ride crew, a
  postcard byline or Explore
- **THEN** they SHALL read exactly the columns the `profiles` SELECT policy already admits and
  SHALL write nothing
- **AND** no role SHALL gain the ability to clear, set or edit another rider's username; club role
  confers no authority over another rider's identity, and `club_members` has no UPDATE policy to
  change a role with in any case

#### Scenario: Signed-out visitor

- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned and zero rows written, because `anon` holds no grant on
  `profiles` — measured, `has_table_privilege('anon','public.profiles','SELECT')` is `false`
- **AND** no rule in this change SHALL be expressed in a way that admits `anon`, per decision #1

#### Scenario: The route guard is not the enforcement

- **WHEN** a rider defeats or bypasses the client-side route guard
- **THEN** the durability of their username SHALL be unaffected, because the guard is a UX
  affordance and this rule lives in the database
- **AND** conversely the guard SHALL NOT be modified to compensate for this defect, since a
  client-side check cannot constrain a request the client itself composes
