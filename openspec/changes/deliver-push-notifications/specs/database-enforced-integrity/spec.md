## MODIFIED Requirements

### Requirement: A derived row SHALL NOT hold a copy of a visibility decision

A row written as a consequence of another row SHALL store references, and SHALL NOT store a
denormalised copy of any text, name, title or count that a policy governs.

A stored copy is a visibility decision that nothing re-checks. It is correct at the instant it is
written, it is owned by its recipient, and it survives every event that would have withdrawn the
original — leaving the club, being removed, being blocked, the club turning private. The failure is
silent and permanent and looks correct to review, because the value really was true once.

**A push payload is such a copy, it is the one this schema has to permit, and the exception is
therefore stated with its conditions rather than left for the first implementer to invent.** A
notification with no text is not a notification; a device shows a string or it shows nothing. So
the rule becomes: a copy of a visibility decision MAY be **produced and transmitted**, never
**stored**, and only under all four of the following.

1. **It is never written to a table.** No payload column, no rendered-copy column, no cached
   string on the outbox row. The outbox carries a notification id and delivery bookkeeping and
   nothing that names a club, ride, postcard or rider.
2. **It is produced at the latest possible moment** — immediately before transmission, never at
   the moment of the event it describes.
3. **It is produced by one function**, which re-evaluates every conjunct the governing SELECT
   policy requires for that reader, and which is the only place that policy is restated.
4. **That restatement is pinned textually against the live policy**, so that a policy gaining a
   conjunct fails a test rather than opening a leak. This is `060`'s mitigation, applied to a
   second restating function for the same reason.

**And the residue is stated rather than mitigated.** Once transmitted, the copy is outside the
database's reach: no block, no membership change, no deletion and no policy edit removes it from a
device. That is a property of push and not a defect in this design, and it is written down so that
a future session does not attempt a withdrawal sweep, which would be a standing unbounded query
re-evaluating every delivered message against every rider's current visibility.

#### Scenario: References, not copies
- **WHEN** a derived table is designed
- **THEN** it SHALL carry foreign keys to what it describes
- **AND** it SHALL NOT carry a name, title, caption, username or body copied from them

#### Scenario: The reader's own policy decides what resolves
- **WHEN** a derived row is **read** — by a client, under a session
- **THEN** the resources it references SHALL be read under the reader's own row security at that
  moment
- **AND** a row whose references do not resolve SHALL NOT be returned
- **AND** the **transmission** case carved out by conditions 1–4 above is not this case and does
  not weaken it: there the reader is a device with no session and no ability to execute a policy,
  so the check is executed *on their behalf* by a function that applies the same conjuncts with the
  recipient as an argument. Any path that has a session SHALL use the session

#### Scenario: A count is not a copy either
- **WHEN** a count over a policy-governed table is needed
- **THEN** it SHALL be computed under the reader's row security rather than denormalised onto a row
- **AND** this SHALL match the existing decision that `postcard_likes` and `postcard_comments` carry
  no denormalised count, because the correct count is per-viewer

#### Scenario: A transmitted copy is not a stored copy
- **WHEN** a payload is rendered for transmission to a device
- **THEN** it SHALL exist only in the sending process's memory and in the transmission itself
- **AND** no column anywhere SHALL hold it, before or after sending
- **AND** an implementation that stores it "for debugging", "for retry" or "for auditing" SHALL be
  refused, because a retry must re-derive the copy under the conditions above rather than replay a
  stale one

#### Scenario: The four conditions are checkable, not aspirational
- **WHEN** the payload path is reviewed
- **THEN** each of the four SHALL map to something a reviewer can check: the table definition, the
  call ordering, the single function's grant, and the textual pin in the RLS suite

#### Scenario: The residue is recorded where it will be read
- **WHEN** the migration and the spec are written
- **THEN** both SHALL state, in the same words, that a transmitted copy cannot be withdrawn
- **AND** a withdrawal mechanism SHALL be explicitly refused rather than left as an open idea

### Requirement: Every role's reach into a rider's identity SHALL be stated

Each role that can reach a rider's identity SHALL have its access stated so that each line maps
onto an assertion, because an unstated negative silently becomes whatever the migration author
assumed. This covers `profiles.username`, and it now covers **a rider's device tokens**, which are
about a rider in the strongest sense — they address the rider's phone — while being readable by
none of the roles that can read the rest of their identity.

#### Scenario: The rider themselves

- **WHEN** a rider reads or writes their own `profiles` row
- **THEN** they SHALL read every column their grants permit, SHALL set `username` while it is
  NULL, SHALL change it to another valid value while **the username-mutability question carried
  forward from `view-rider-profile` (its Q1, not this change's)** remains unanswered, and SHALL
  NOT return it to NULL

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

#### Scenario: Device tokens, for every role at once

- **WHEN** the rider themselves, any other signed-in rider, a club owner, a club admin, a fellow
  member, a non-member, a blocked rider or a signed-out visitor attempts to read, count or infer a
  device token by any route
- **THEN** every one of them SHALL be refused
- **AND** the refusal SHALL come from an absent grant rather than a policy, so that no future
  policy can widen it
- **AND** the rider themselves SHALL be on that list, which is the one line most likely to be
  softened later and the one that keeps the registration RPC safe

#### Scenario: `service_role`'s reach is stated rather than assumed unlimited

- **WHEN** `service_role` is used by an Edge Function
- **THEN** the set of database objects that function may reach SHALL be stated in its header and
  narrowed to named functions granted to `service_role` explicitly
- **AND** an Edge Function that queries tables directly with a service-role key SHALL be treated as
  reopening decision #8's third reading, in which every policy in this repo becomes decorative

## ADDED Requirements

### Requirement: A per-device bearer secret SHALL be readable by no client role, its owner included

Where a table holds a value that grants its holder the ability to reach a rider's device or
account — a push token, a device registration, a channel credential — `authenticated` and `anon`
SHALL hold **no** SELECT privilege on it, and it SHALL carry no SELECT policy.

This is deliberately stricter than the ownership pattern every other table in this schema uses,
and the reason is that such a value is not a record *about* a rider that they may inspect: it is a
credential, and the only parties with a use for reading it are the process that sends and an
attacker. Own-row SELECT is the natural instinct and it is wrong here — it makes the value
reachable by any leaked session, any XSS, and any future join written without noticing.

#### Scenario: The absent grant is asserted by role
- **WHEN** such a table exists
- **THEN** the suite SHALL assert `has_table_privilege('authenticated', …, 'SELECT')` is false, and
  the same for `anon`
- **AND** the assertion SHALL name the role rather than attempting a statement, because the suite
  runs as the table owner — `031`'s lesson

#### Scenario: RLS is enabled with no policy, deliberately
- **WHEN** the table is created
- **THEN** RLS SHALL be enabled and no policy SHALL be written, following `026`'s
  `password_reset_grants`
- **AND** the resulting `rls_enabled_no_policy` INFO advisor SHALL be added to the expected-advisor
  table in `CLAUDE.md`, because an expected advisor that is undocumented is indistinguishable from
  a new one

#### Scenario: Reading it back is never the way a feature is built
- **WHEN** a surface is proposed that would show a rider their own registered devices
- **THEN** it SHALL be an own-row `security definer` RPC returning only non-secret attributes
- **AND** it SHALL NOT be implemented by adding a SELECT grant
