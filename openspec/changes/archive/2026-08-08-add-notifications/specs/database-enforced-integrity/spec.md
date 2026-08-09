<!--
⚠ COORDINATION — READ BEFORE ARCHIVING THIS CHANGE.

`Onboarding completion SHALL gate participation, not only navigation` now has THREE claimants:
`add-account-deletion`, `add-ride-chat` and this change. Archiving folds a delta in by replacing
the requirement **WHOLESALE**, so whichever archives last silently discards every earlier edit,
and OpenSpec will not warn you.

**It is the ONLY requirement in this repo with three claimants** — not the third to reach three.
An earlier revision said *"the third requirement in this repo to reach three claimants, after
`Club membership role SHALL NOT be self-assignable` and `Stale data SHALL be bounded and
visible`"*, which reached three on those two only by counting the archived
`2026-08-06-migrate-to-client-rendered-shell`. That change is where these requirements came FROM;
its deltas are already folded into `openspec/specs/`, so counting it is counting the standing text
twice. Re-derive rather than trust either version — `grep -rn "^### Requirement: <text>" openspec/`,
then discard `changes/archive/`:

| Requirement | Unarchived claimants |
|---|---|
| **`Onboarding completion SHALL gate participation …`** | **3** — `add-account-deletion`, `add-ride-chat`, `add-notifications` |
| `Counts SHALL stay per-viewer …` | 2 — `add-account-deletion`, `add-notifications` |
| `Stale data SHALL be bounded and visible` | 2 — `add-ride-chat`, `add-account-deletion` |
| `Club membership role SHALL NOT be self-assignable` | 2 — `enforce-creator-membership`, `add-account-deletion` |

Understating this one as "one of three such requirements" is what makes it read as routine. It is
the worst case on the board and the only one where a two-way merge is not enough.

**Before archiving: re-read `openspec/specs/database-enforced-integrity/spec.md` as the previous
archive actually left it, and rewrite the MODIFIED block below against THAT text** rather than
against the version transcribed here on 2026-08-07.

The merged text this delta should converge on: `add-ride-chat` adds `ride_messages` to the gated
list (eight → nine); this change replaces the *enumeration* with a statement of the rule plus the
command that counts it, and adds the third category — a table with no INSERT policy and no gate.
Those edits compose. A merge that keeps the hardcoded eight-table list is the one that is wrong.
-->

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

**The gate is narrower than the requirement above reads, and its scope SHALL be counted rather
than enumerated.** Earlier revisions of this requirement listed the gated tables by name and
asserted "thirteen tables carry an INSERT policy and this gate names eight of them". Both numbers
went stale within a day of being written — `034` added `ride_messages` as a ninth gated table, and
`036` adds `notifications` as a fifteenth table that carries **no INSERT policy at all**, which is
a third category the enumeration cannot express. A standing spec asserting a stale count is worse
than one asserting nothing, because a table added without a gate looks exactly like the list being
right. The scope is therefore stated as a rule with the command that measures it:

```sql
select count(*) from pg_trigger
 where tgname = 'enforce_participation_gate' and not tgisinternal;
```

The rule, which does not go stale: **every table into which a rider inserts content another rider
can see carries the gate.** Per-viewer tables that produce nothing anyone else can see do not —
`profiles` UPDATE, `profile_countries`, `blocks`, `postcard_hides`, `feed_reads`, and every
`storage.objects` policy, which check the path prefix only.

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
- **WHEN** the same rider sets a username and location and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way and SHALL remain refused while either field is NULL,
  unchanged from `003`

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

## ADDED Requirements

### Requirement: A table whose rows are addressed to a rider other than their writer SHALL grant no INSERT to any client role

Where a row's `user_id` names somebody other than the rider whose action created it, `authenticated`
SHALL hold **no INSERT grant** on that table and the table SHALL carry **no INSERT policy**. Its
only writer SHALL be a `security definer` trigger owned by the table owner.

Every other table in this schema pins its rows to their writer — `auth.uid() = user_id`,
`auth.uid() = author_id`, `auth.uid() = organizer_id` — and that pin is what makes a client-owned
mutation path safe. A notification inverts it: the row is *about* the actor and *addressed to*
somebody else, so no `with check` clause on `auth.uid()` can express its correctness. There is no
policy that both permits the write and forbids forging it, which is why the grant has to be absent
rather than the policy narrow.

#### Scenario: The grant is absent, not merely unused
- **WHEN** the table is created
- **THEN** `authenticated` SHALL hold no INSERT privilege on it
- **AND** the assertion SHALL name the role — `has_table_privilege('authenticated', …, 'INSERT')`
  — rather than attempting an insert, because the RLS suite runs as the **table owner**, for whom
  neither the grant nor RLS applies, so an attempted insert would succeed and prove nothing
- **AND** this SHALL be `031`'s lesson applied prospectively: the assertions that would have caught
  `029`'s uncallable function named a role rather than calling it

#### Scenario: A policy is not a substitute for the missing grant
- **WHEN** an INSERT policy is proposed for such a table
- **THEN** it SHALL be refused
- **AND** the reason SHALL be that a policy plus a grant is one over-permissive `with check` away
  from a forgeable row, while an absent grant fails closed regardless of what any future policy says

#### Scenario: The trigger's write is not a client write
- **WHEN** the `security definer` trigger inserts
- **THEN** it SHALL succeed notwithstanding the absent grant and the absent policy, because the
  function's owner owns the table and `relforcerowsecurity` is false on it
- **AND** that mechanism SHALL be stated in the migration, because it is the load-bearing reason
  the design works and it is invisible in the policy set

### Requirement: A derived row SHALL NOT hold a copy of a visibility decision

A row written as a consequence of another row SHALL store references, and SHALL NOT store a
denormalised copy of any text, name, title or count that a policy governs.

A stored copy is a visibility decision that nothing re-checks. It is correct at the instant it is
written, it is owned by its recipient, and it survives every event that would have withdrawn the
original — leaving the club, being removed, being blocked, the club turning private. The failure is
silent and permanent and looks correct to review, because the value really was true once.

#### Scenario: References, not copies
- **WHEN** a derived table is designed
- **THEN** it SHALL carry foreign keys to what it describes
- **AND** it SHALL NOT carry a name, title, caption, username or body copied from them

#### Scenario: The reader's own policy decides what resolves
- **WHEN** a derived row is read
- **THEN** the resources it references SHALL be read under the reader's own row security at that
  moment
- **AND** a row whose references do not resolve SHALL NOT be returned

#### Scenario: A count is not a copy either
- **WHEN** a count over a policy-governed table is needed
- **THEN** it SHALL be computed under the reader's row security rather than denormalised onto a row
- **AND** this SHALL match the existing decision that `postcard_likes` and `postcard_comments` carry
  no denormalised count, because the correct count is per-viewer

### Requirement: A trigger that must run for every writer SHALL NOT be gated on `current_user`, and one that must skip privileged writers SHALL

Whether a trigger carries a `current_user` guard SHALL be a stated decision recorded at the trigger,
because both shapes exist in this schema, both are correct where they are, and copying the wrong one
fails silently in opposite directions.

Inside a `SECURITY DEFINER` function `current_user` is the **owner**, not `authenticated` — measured
on Postgres 16, and the reason `003`'s and `012`'s guards short-circuit when reached from
`accept_terms()` or `complete_onboarding()`. The nine `enforce_participation_gate` triggers use
`WHEN (CURRENT_USER = 'authenticated')` deliberately, so a privileged path is not refused by a gate
meant for riders. A fan-out trigger needs the opposite: it must fire for every writer, because a
notification that silently does not happen for a seed, a maintenance write or a future RPC is a gap
with nothing to detect it.

#### Scenario: The gate skips privileged writers, by design
- **WHEN** a `security definer` function or the table owner writes to a gated table
- **THEN** `enforce_participation_gate` SHALL NOT refuse it
- **AND** this SHALL remain the behaviour, because the alternative refuses the app's own accessors

#### Scenario: A fan-out fires for every writer, by design
- **WHEN** any writer — client, seed, owner, or a `security definer` function — inserts a row that
  should produce a derived row
- **THEN** the derived row SHALL be written
- **AND** the trigger SHALL carry no `WHEN (CURRENT_USER = …)` clause and its function SHALL contain
  no `current_user` branch

#### Scenario: The choice is recorded where it is made
- **WHEN** a trigger is added
- **THEN** its migration SHALL state which of the two shapes it uses and why
- **AND** the absence of a guard SHALL be as explicitly recorded as its presence, because an absent
  guard is indistinguishable from a forgotten one
