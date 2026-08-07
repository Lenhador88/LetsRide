# database-enforced-integrity (delta)

> **⚠ COORDINATION — `add-account-deletion` also modifies `Onboarding completion SHALL gate
> participation, not only navigation`, and OpenSpec will not warn you.** Archiving folds a delta
> into `openspec/specs/database-enforced-integrity/spec.md` by replacing the requirement
> **wholesale**, so whichever change archives second silently discards the first one's edit.
> This is the same hazard `enforce-creator-membership`'s delta records for
> `Club membership role SHALL NOT be self-assignable` — three requirements in this one file now
> have more than one active editor.
>
> The two edits are reconcilable in substance, and this is the merged text both should converge
> on:
>
> - The gate covers **nine** tables, not eight: `postcards`, `clubs`, `rides`, `club_members`,
>   `ride_members`, `postcard_comments`, `postcard_likes`, `postcard_reports` **and
>   `ride_messages`**. Fourteen tables carry an INSERT policy and the gate names nine of them.
> - The ungated five are unchanged: `blocks`, `postcard_hides`, `feed_reads`,
>   `profile_countries`, `profiles`.
> - `add-account-deletion`'s **second population** — a caller holding a valid access token whose
>   `profiles` row has been deleted — applies to all nine, and its "refused by foreign key on the
>   ungated five" scenarios are unaffected by this change.
>
> Before archiving whichever of the two goes second: re-read
> `openspec/specs/database-enforced-integrity/spec.md` as the first one left it, and rewrite this
> delta against *that* text rather than against the version drafted here.

## ADDED Requirements

### Requirement: A child table whose audience is NARROWER than its parent's SHALL enforce that by composition, never by a privileged helper alone

Where a table's audience is narrower than the audience of the row it hangs off, its SELECT policy
SHALL contain **both** an `EXISTS` against the parent evaluated under the caller's own row
security **and** the narrowing predicate. A `security definer` helper SHALL NOT be the only
condition.

**Every child table in this schema until now inherits its parent's audience exactly** —
`postcard_comments`, `postcard_likes`, `postcard_reports` and the `storage.objects` read policy
all express it as a bare `EXISTS` and restate nothing, which is deliberate and correct for them.
A ride's chat is the first table that is narrower, and the two obvious implementations are both
wrong in opposite directions: the bare `EXISTS` alone admits every rider who can see the ride,
and the narrowing helper alone **bypasses the parent's policy entirely**, because a
`security definer` function does not run under RLS.

That second failure is not hypothetical here. `rides` SELECT carries
`NOT private.is_blocked(auth.uid(), organizer_id)` and a private-club predicate; a `ride_members`
row survives blocking the organizer, leaving the club, and the club turning private. So "holds a
crew row" and "can see the ride" are independent conditions, and only their conjunction is the
audience. `private.is_club_member` has the identical shape and no such gap only because `clubs`
deliberately carries no block predicate — which makes copying that shape verbatim the specific
trap this requirement closes.

#### Scenario: The parent-visibility conjunct is present and is not redundant
- **WHEN** a policy on a table whose audience is narrower than its parent's is written or
  reviewed
- **THEN** it SHALL contain an `EXISTS` against the parent evaluated under the caller's own row
  security
- **AND** that conjunct SHALL NOT be removed on the grounds that the narrowing predicate already
  implies it

#### Scenario: A blocked rider cannot reach a child row through a definer helper
- **WHEN** a rider who has blocked, or been blocked by, a parent row's owner still satisfies the
  narrowing predicate
- **THEN** zero child rows SHALL be returned
- **AND** the refusal SHALL be attributable to the parent-visibility conjunct, asserted in
  isolation from the narrowing one

#### Scenario: Each conjunct is asserted alone
- **WHEN** assertions are written for such a policy
- **THEN** at least one case SHALL fail if the parent-visibility conjunct is removed, and at
  least one different case SHALL fail if the narrowing conjunct is removed
- **AND** a single case that both conjuncts happen to hide SHALL NOT be accepted as coverage,
  because it cannot say which one did the work

#### Scenario: The privileged helper is not published
- **WHEN** the narrowing predicate is a `security definer` function
- **THEN** it SHALL live in the `private` schema so PostgREST cannot publish it
- **AND** `authenticated` SHALL hold EXECUTE on it, because an RLS expression is evaluated as the
  querying role, and that grant SHALL be asserted by naming the role rather than by calling the
  function — the suite runs as the table owner, for whom no barrier exists

### Requirement: A column the server owns SHALL NOT be writable by a client that can insert the row

Where a column's value must come from the server — a timestamp that orders a conversation, a
stamp that records an act — a DEFAULT SHALL NOT be treated as the enforcement. The value SHALL be
imposed by a trigger, or the column grant SHALL be withheld.

A DEFAULT applies only when the column is **omitted**. `authenticated` holds INSERT on every
content table and PostgREST lets a client name any column in the insert body, so a DEFAULT is a
convention the database does not enforce — the same class of claim as `joinClub` relying on
`club_members.role`'s default, which `019` exists to close.

It has never mattered for `postcard_comments.created_at`, because a comment thread is short and
nobody has an incentive to forge a position in it. It matters the moment a column decides the
order of a conversation: a message stamped with a far-future time pins itself to the top of every
participant's thread permanently, and the only remedy is a delete.

#### Scenario: A client-supplied value is overwritten rather than ignored
- **WHEN** a rider inserts a row naming a server-owned column with any value
- **THEN** the stored value SHALL be the server's
- **AND** the enforcement SHALL be a trigger or a withheld column grant, never the client
  omitting the column

#### Scenario: The trigger takes no caller input and is not callable
- **WHEN** the value is imposed by a trigger function
- **THEN** that function SHALL take no argument, SHALL derive the value from the server alone,
  and SHALL have EXECUTE revoked from `public`, `anon` and `authenticated`
- **AND** it SHALL therefore add no `authenticated_security_definer_function_executable` advisor
  finding

#### Scenario: Trigger firing order is stated rather than relied on by luck
- **WHEN** a table carries more than one `BEFORE INSERT` row trigger
- **THEN** the migration SHALL state that Postgres fires them in name order and SHALL say whether
  anything depends on it
- **AND** where nothing depends on it, that SHALL be written down rather than left as an
  unexamined coincidence

#### Scenario: An ordering column alone is not a total order
- **WHEN** rows are ordered by a timestamp
- **THEN** a deterministic tiebreak SHALL be part of the ordering, the index and any pagination
  cursor
- **AND** the three SHALL agree, so that a row cannot appear twice or vanish between pages

### Requirement: A table with no designed edit SHALL carry no UPDATE grant

Where editing a row has not been designed, the table SHALL have no UPDATE policy **and** no
UPDATE grant to `authenticated`.

The grant is the second, independent layer — the one that still holds if a future policy is
written too permissively. `009` applied this to `postcard_likes` and `blocks`, `011` to
`postcard_comments`, `postcard_hides` and `postcard_reports`, and each stated the same reason: a
table with no mutable column has nothing to grant UPDATE for. It is stated here as a rule rather
than repeated a sixth time in a migration comment.

**Editing is a design problem, not a permission one.** It means deciding whether "edited" is
disclosed, from when, and what the record of a conversation means once it can be rewritten. None
of that exists for any table in this schema.

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

## MODIFIED Requirements

### Requirement: Onboarding completion SHALL gate participation, not only navigation

A rider whose `profiles.onboarding_completed_at` is NULL MUST NOT be able to create content or
join anything, and the refusal SHALL come from the database rather than from a redirect.

Decision #5 states onboarding is required and not skippable. This requirement is **met**:
`023`'s `enforce_participation_gate` is the enforcement, applied 2026-08-05, and the route
guard is only a UX affordance on top of it.

The argument that produced it, kept because it is why the gate exists: before `023`, `proxy.ts`
was the *only* thing holding decision #5 — no policy prevented a rider whose
`onboarding_completed_at` was NULL from inserting a postcard, creating a club or a ride, or
joining anything, because `003`'s trigger guards the *stamp*, not the participation. Demoting
the route guard to a client component would have removed the only thing holding it.

**The gate is narrower than the requirement above reads**, and that is worth carrying: it is on
**nine** tables — `postcards`, `clubs`, `rides`, `club_members`, `ride_members`,
`postcard_comments`, `postcard_likes`, `postcard_reports` and `ride_messages` — and **not** on
`profiles` UPDATE, `profile_countries`, `blocks`, `postcard_hides`, `feed_reads` or any
`storage.objects` policy. `023` shipped it on eight; `ride_messages` is the ninth.

An un-onboarded rider also has a NULL `username`, which the `profiles` SELECT policy uses to
hide them from other riders — so their content would appear to everyone else with an
unresolvable author.

**On `ride_messages` the gate is defence in depth, not the primary control, and stating it
otherwise would be an overclaim.** An un-onboarded rider cannot become crew — the gate already
covers `rides` and `ride_members` — so they cannot satisfy the chat's crew predicate and could
not insert a message even if the trigger were absent. It becomes **load-bearing** the day
`private.may_participate()` consults `private.current_terms_version()`, which `030` created the
column for and which returns `'0-placeholder'` today: at that moment an existing crew member
becomes un-consented **while remaining crew**, and this trigger is the only thing that stops them
writing. Measured 2026-08-07 — `may_participate()` checks the two stamps and nothing else.

#### Scenario: An un-onboarded rider cannot create content
- **WHEN** a rider whose `onboarding_completed_at` is NULL inserts into `postcards`, `clubs`,
  `rides`, `club_members`, `ride_members`, `postcard_comments`, `postcard_likes`,
  `postcard_reports` or `ride_messages`
- **THEN** the database SHALL reject the write

#### Scenario: Per-viewer tables are deliberately excluded
- **WHEN** an un-onboarded rider inserts into `blocks`, `postcard_hides`, `feed_reads`,
  `profile_countries` or their own `profiles` row
- **THEN** the write SHALL succeed, because none of these produces content another rider can
  see and `profiles` is the row the wizard itself writes
- **AND** the exclusion SHALL be stated in the migration rather than left as silence: fourteen
  tables carry an INSERT policy and this gate names nine of them

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
- **WHEN** the same rider sets a username and location and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way and SHALL remain refused while either field is NULL,
  unchanged from `003`

#### Scenario: Reading is unaffected
- **WHEN** an un-onboarded rider reads any table
- **THEN** the existing policies SHALL apply unchanged, so this requirement adds no new read
  restriction and cannot strand a rider mid-wizard
- **AND** for a ride's chat the read is closed by construction rather than by the gate, because
  an un-onboarded rider cannot become crew in the first place — which SHALL be asserted rather
  than assumed

#### Scenario: A revoked consent stops a sitting crew member writing
- **WHEN** `private.may_participate()` is extended to require the current terms version, and a
  rider who is already on a ride's crew has consented only to an earlier one
- **THEN** their next message insert SHALL be refused with `check_violation`
- **AND** their read of the thread SHALL be unaffected, because the gate is on writes only
- **AND** this is the case in which the gate on `ride_messages` stops being defence in depth,
  which is why the trigger ships before the case exists
