## MODIFIED Requirements

### Requirement: Club membership role SHALL NOT be self-assignable

`club_members.role` SHALL admit `'member'` from any rider joining a club they may join, and
`'owner'` only for the club's own `clubs.owner_id`. **`'admin'` SHALL be claimable by no client, by
any verb, on any table.**

`019` enforced that through the INSERT policy's WITH CHECK plus the **absence of any UPDATE policy**,
and `036` §7.6 rests on the second half. Both SHALL survive this change: `088` adds no UPDATE policy
and revokes `048`'s dead per-column UPDATE grant with nothing re-granted, so the absence becomes an
absence of privilege as well as of policy.

**`admin` becomes writable for the first time, and only through a `security definer` RPC that takes
no role argument.** `public.promote_club_member(target_club, rider)` writes the literal `'admin'`
and `public.demote_club_admin(target_club, rider)` writes the literal `'member'`; neither accepts a
role parameter, so — as with `085`'s `private.join_club_from_request` — there is no input by which a
caller could attempt a value the design does not offer. Both are gated on `clubs.owner_id =
auth.uid()` inside their own bodies, because RLS does not apply inside a definer function and that
check is therefore the entire access control.

#### Scenario: No client role can write `admin` by any verb
- **WHEN** a rider attempts to insert a `club_members` row with `role = 'admin'`, or to update an
  existing row to `'admin'`, on a public club, a private club, and a club they own
- **THEN** every attempt SHALL be refused
- **AND** the UPDATE half SHALL be refused **twice over** — by the absent grant and by the absent
  policy — and both SHALL be asserted, because removing either alone would look like a passing test

#### Scenario: The RPCs take no role argument
- **WHEN** the two functions' signatures are read from `pg_proc`
- **THEN** neither SHALL accept a `text` role parameter, and each SHALL write its value as a literal
  in `prosrc`

#### Scenario: An admin cannot make another admin
- **WHEN** an admin calls `promote_club_member`
- **THEN** it SHALL raise `insufficient_privilege`, so the admin set cannot become self-replicating

#### Scenario: The owner's roster row is unreachable by either RPC
- **WHEN** either RPC targets `clubs.owner_id`
- **THEN** it SHALL raise, whether or not that rider holds a roster row and whatever role it carries

## ADDED Requirements

### Requirement: A privileged operation on a shipped table SHALL restate the authority the table's policies would have carried

`security definer` runs with RLS bypassed — measured on Postgres 16 for `021` §3 and relied on
again — so a definer function that writes `club_members` inherits **none** of `008`'s, `019`'s or
`048`'s protections. Each of the three new RPCs SHALL therefore restate, in its own body:

- **who the caller must be**, read from `clubs.owner_id` and `club_members.role` rather than from
  any caller-relative helper's convenience;
- **who the target may be**, including the explicit `rider <> clubs.owner_id` conjunct that a
  role-only predicate does not supply for `054`'s ownerless owner;
- **that the caller is not the target.**

Each SHALL have exactly one raise site, and each SHALL be `set search_path = ''` with
`#variable_conflict error` — `043`'s shape, and `043`'s stated reason for the pragma: the guarantee
becomes local to the function rather than depending on a cluster GUC an operator can set to
`use_column`.

#### Scenario: The definer marking and the search path survived the apply
- **WHEN** `prosecdef` and `proconfig` are read for all three functions
- **THEN** each SHALL be `t` and `{search_path=""}`
- **AND** each SHALL be asserted individually rather than counted, because a function created
  without `security definer` is otherwise a code review rather than a red test

#### Scenario: Reachability is asserted by naming the role
- **WHEN** the three functions' grants are checked
- **THEN** `has_function_privilege('authenticated', …)` SHALL be true and
  `has_function_privilege('anon', …)` SHALL be false for each
- **AND** PUBLIC's default EXECUTE grant SHALL be gone for each
- **AND** none SHALL be asserted by attempting the call, because the suite runs as the table owner
  for whom no barrier exists — `031`'s lesson

### Requirement: A private club's avatar object SHALL be readable by exactly the audience that can already read its name, and its cover SHALL NOT

`016`'s `"Club avatars are readable with the club"` policy SHALL gain a third disjunct admitting a
rider for whom `private.club_takes_join_requests(c.id)` is true. `"Club covers are readable with the
club"` SHALL be untouched: an avatar is the club's identity and a cover is its content.

**The disjunct SHALL use the ONE-argument caller-relative wrapper.** The two-argument
`private.club_takes_join_requests_for(uuid, uuid)` is revoked from `authenticated` by `085`, a
`storage.objects` policy is evaluated as the querying role, and the two-argument form would raise
`42501` on every club-avatar read for every rider — a worse failure than the initials it replaces,
and invisible to any test that only inspects the policy text.

The `(storage.foldername(name))[2] = c.owner_id::text` binding SHALL be carried into the new
disjunct verbatim. It is `010` §2's line and `016`'s second of two independent locks: without it,
attaching another rider's object path to a club you own makes that object readable to the club's
audience.

The accepted cost SHALL be stated rather than implied: **every private club's avatar image becomes
readable to every signed-in rider not blocked with that club's owner** — the same audience
`public.discoverable_private_clubs` already gives the club's name, town and member count to.

#### Scenario: A discoverer reads the avatar and not the cover
- **WHEN** a rider who may request to join a private club reads `storage.objects` for that club's
  `avatar_path` and for its `cover_image_path`
- **THEN** the avatar SHALL return one row and the cover SHALL return **zero**
- **AND** `085.6`'s cover half SHALL be reproduced unchanged, so the assertion that a non-member
  reads no cover survives this change verbatim

#### Scenario: A blocked rider reads neither
- **WHEN** a `blocks` row exists in either direction with the club's owner
- **THEN** `private.club_takes_join_requests` SHALL be false and the avatar SHALL return zero rows

#### Scenario: The policy is callable by the role that evaluates it
- **WHEN** the new disjunct is read from `pg_policies`
- **THEN** it SHALL name the one-argument form, and
  `has_function_privilege('authenticated','private.club_takes_join_requests(uuid)','execute')` SHALL
  be true
- **AND** the two-argument form SHALL remain revoked from `authenticated`, asserted separately

#### Scenario: A member's and an owner's reads are unchanged
- **WHEN** the club's own members and owner read both objects
- **THEN** both SHALL resolve exactly as they do today, through the two disjuncts `016` already
  carries
