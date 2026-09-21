# candidate-relative-visibility (delta)

## ADDED Requirements

### Requirement: A privileged writer asking whether ANOTHER rider can see a resource SHALL use a predicate that takes its subject as an argument

Whenever code running with elevated rights must decide what some **other** rider can read — a
fan-out choosing recipients, a scheduled job choosing an audience, a delivery worker choosing a
device — it SHALL evaluate a predicate of the form `f(candidate uuid, resource uuid) returns
boolean`. It SHALL NOT evaluate a predicate that reads `auth.uid()` internally, and it SHALL NOT
substitute a narrowing argued in prose for a predicate.

**`event-fanout-integrity` states the prohibition and no spec has stated the permitted
instrument**, which is why every fan-out so far has invented its own answer and two of them have
since gone stale in opposite directions. This capability names the shape once, for everything that
comes next: ride reminders, "ride updated", push delivery and the Inbox epic all need the same
question answered about somebody who is not the caller.

**`auth.uid()` is NULL wherever there is no JWT** — the RLS suite, `psql`, a seed, the Supabase
MCP — and a caller-relative helper reached from a privileged writer therefore returns either the
actor's own answer applied to everybody, or NULL applied to everybody. Both look correct in a
one-member test, and the second makes every negative assertion pass vacuously.

#### Scenario: The predicate takes the candidate, and the caller-relative twin is derived from it
- **WHEN** a concept needs both a caller-relative and a candidate-relative form
- **THEN** the candidate-relative one SHALL hold the body, and the caller-relative one SHALL be a
  one-line wrapper passing `auth.uid()` to it
- **AND** the two SHALL NOT be independent implementations, because two definitions of one concept
  aging apart is the defect this capability exists to prevent
- **AND** the wrapper SHALL keep its existing name, signature and OID where one already exists, so
  that no policy calling it is recreated and no grant moves

#### Scenario: The shared body is asserted by equality, not merely intended
- **WHEN** the sharing is verified
- **THEN** the wrapper's `prosrc` SHALL be pinned by **equality** against its expected one-line
  text, and a `like` match on the callee's name SHALL NOT be accepted as covering it
- **AND** the reason SHALL be recorded: an arm added to the wrapper —
  `select f_for(auth.uid(), $1) or exists (…)` — leaves every calling policy's `qual` text
  unchanged, still satisfies a `like '%f_for%'` match, and makes the candidate-relative predicate
  silently **narrower** than the policy that delegates to it
- **AND** the claim SHALL be stated as *"asserted to share a body"* rather than *"cannot drift
  apart"*, because the second is a stronger claim than any assertion here supports and this
  capability's whole subject is claims outliving their evidence

#### Scenario: One predicate per subject, and none inferred from another
- **WHEN** a privileged writer must decide reach to a row that renders more than one resource
- **THEN** it SHALL evaluate one candidate-relative predicate **per resource**, conjoined
- **AND** no resource's resolvability SHALL be inferred from another's, however reliably the
  implication holds against the current policy text — an implication is a derivation, and a
  derivation goes stale where a call does not

#### Scenario: `auth.uid()` appears nowhere in the candidate-relative form
- **WHEN** the predicate is reviewed
- **THEN** `auth.uid()` SHALL NOT appear in its body, and this SHALL be checkable by inspection
  rather than inferred from behaviour
- **AND** the predicate SHALL be correct when called from a context with no `request.jwt.claims`,
  so that assertions about it mean what they say

#### Scenario: A prose narrowing is not an acceptable substitute
- **WHEN** a recipient or audience set is restricted because some rider "could not see it anyway"
- **THEN** that restriction SHALL be expressed as a call to a candidate-relative predicate rather
  than as a comment justifying an omission
- **AND** the reason SHALL be recorded: a comment cannot fail. `private.notify_ride_created_in_club`
  withheld the club owner for a stated reason that `054` falsified, and the justification survived
  three migrations — into the live `COMMENT ON FUNCTION`, re-issued verbatim by `059` — with
  nothing anywhere to flag it

### Requirement: A candidate-relative visibility predicate SHALL be unreachable by every client role

Each such predicate SHALL live in the `private` schema, SHALL be `SECURITY DEFINER` with
`SET search_path = ''` and every reference schema-qualified, and SHALL have `EXECUTE` revoked from
`public`, `anon` and `authenticated`.

**A predicate that answers a visibility question about an arbitrary rider is a probe**, and this
is the property that distinguishes it from its caller-relative twin, which is safe to grant. In a
rider's hands, `is_club_member_for(<any rider>, <any club>)` and
`can_read_club(<any rider>, <any club>)` disclose a private club's membership one bit at a time,
and `can_read_ride(<any rider>, <any ride>)` returns a boolean that is a function of that rider's
**block state** with the organizer — and decision #2 requires blocking be invisible, with *"no
gap, count or marker"*. A boolean is a marker.

Being in `private` is already sufficient, since `authenticated` holds no `USAGE` there and
PostgREST routes only to `public`. The revoke is belt and braces, and `029`/`031` are why belt and
braces is the house rule rather than a preference: a function nothing could call shipped once
already, and the barrier that made it unreachable was invisible to the suite.

#### Scenario: No client role holds EXECUTE
- **WHEN** the grant is asserted
- **THEN** `has_function_privilege` SHALL be **false** for `authenticated`, `anon` and
  `service_role` on every candidate-relative predicate
- **AND** the assertion SHALL name the **role** rather than attempting the call, because the RLS
  suite runs as the table owner for whom neither the schema barrier nor the revoke exists — a test
  that calls the function succeeds and proves nothing

#### Scenario: The predicate adds no security advisor
- **WHEN** the security advisors are read after applying the migration
- **THEN** the `authenticated_security_definer_function_executable` set SHALL be unchanged
- **AND** a new WARN SHALL mean the function landed in `public` or a `revoke` did not, and SHALL be
  treated as a failed apply rather than a finding to triage

#### Scenario: The caller-relative wrapper keeps its client grant
- **WHEN** a wrapper exists so that RLS policies can call the concept as the invoker
- **THEN** the wrapper SHALL keep whatever `EXECUTE` its policies require
- **AND** the wrapper SHALL remain `SECURITY DEFINER`, because its callee is revoked and inside a
  definer function `current_user` is the owner — making the wrapper `SECURITY INVOKER` breaks every
  policy calling it, in one statement

### Requirement: A predicate that restates a policy SHALL be pinned to that policy by an assertion

Where a candidate-relative predicate reproduces the text of an RLS policy, the policy's `qual`
SHALL be pinned by a test assertion whose label names the predicate. **Each restatement gets its
own pin** — one per policy restated, not one per change.

**The duplication is real and is accepted rather than denied.** A privileged writer cannot ask a
policy a question about somebody else, so restating it is the only mechanism available; the two
alternatives are worse, being a caller-relative helper (wrong answer for every candidate) or
widening the policy itself (which changes what riders can see, and can collapse any audience that
embeds it by `EXISTS`).

What makes it acceptable is the **direction of failure**. A stale restatement writes rows the read
policy discards, or withholds rows it would have returned. Neither shows anything to anyone, so
the duplication cannot produce a leak — which is not true of the widening it replaces, where
staleness in a policy arm *is* the leak.

#### Scenario: The pin names the predicate that has to move with the policy
- **WHEN** the policy is rewritten, refactored or replaced
- **THEN** the assertion SHALL fail, and its label SHALL name the predicate restating it
- **AND** a structural pin on part of the policy SHALL NOT be accepted as covering this, because a
  rewrite of the middle of a policy passes every structural pin on its ends

#### Scenario: The `qual` pin does not reach the helper bodies the policy delegates to
- **WHEN** the coverage of a `qual` pin is assessed
- **THEN** it SHALL be recorded as covering the policy's **own text only**, and NOT the bodies of
  any function that text calls
- **AND** each such function SHALL therefore carry its own pin — by equality where it is a wrapper
  whose whole content is one delegating line
- **AND** the gap SHALL be stated rather than assumed closed: an arm added to a delegated helper
  changes what the policy admits while leaving the pinned text byte-identical, which is the same
  class of silent drift these pins exist to catch, one level further down

#### Scenario: The pin is deliberately brittle
- **WHEN** the policy text changes cosmetically — a reformat, a reordered but equivalent conjunct
- **THEN** the assertion SHALL still fail, and that SHALL be the intended behaviour
- **AND** the trade SHALL be recorded: a false failure costs one session five minutes and points at
  the right file, while the alternative is a behaviour change nobody can see

#### Scenario: The restatement is derived at build time, not transcribed from a document
- **WHEN** the predicate is written
- **THEN** its body SHALL be derived from the live `pg_policies.qual` with the candidate
  substituted for `auth.uid()`, and the two texts SHALL be compared before the migration is applied
- **AND** a proposal's or design document's copy of the policy SHALL be treated as **evidence**
  rather than as the source, because a document is a snapshot and the policy is not
