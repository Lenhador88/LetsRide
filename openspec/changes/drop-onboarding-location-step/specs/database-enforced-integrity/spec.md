<!--
⚠ COORDINATION — ONE SIBLING, AND IT CARRIES THE SENTENCE THIS CHANGE MAKES FALSE.

`Onboarding completion SHALL gate participation, not only navigation` is modified by TWO active
changes: `add-account-deletion` and this one. Re-derive rather than trust it:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

Archiving folds a delta in by replacing the requirement WHOLESALE, and `openspec archive` compares
scenario NAMES rather than bodies — so whichever change archives last silently wins the body.

**The dangerous direction is specific and named.** Both files carry a scenario called
`Completing onboarding is still the only way through`, and `add-account-deletion`'s copy
(line 312 as read 2026-08-24) still reads:

    - **WHEN** the same rider sets a username and location and receives the completion stamp
    - **AND** the stamp SHALL remain one-way and SHALL remain refused while either field is NULL

That is exactly the invariant `075` relaxes. If `add-account-deletion` archives AFTER this change,
the standing spec is left asserting that completion is refused without a location, about a database
where it is not — a spec contradicting the schema, in the file whose only job is to be the schema's
contract. The scenario NAME is identical in both, so `openspec archive` will not warn.

Two things follow, and both are tasks (see tasks.md §6):

  1. Before archiving THIS change: re-read `openspec/specs/database-enforced-integrity/spec.md` as
     the previous archive actually left it and rewrite the MODIFIED block below against THAT text.
     The version transcribed here was read 2026-08-24, before `add-account-deletion` archived.
     Keep every scenario the sibling has added; this change removes no scenario and renames none.
  2. Whether this change archives first or last, correct the location clause in
     `add-account-deletion`'s copy of that scenario in the same session. That is an edit to another
     change's file and is deliberate — it is the only place the fix can live.

The ADDED requirement below has no other claimant.
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

**What completion requires is `username` + consent, and NOT a location (PD-286).** The location
arm was part of this invariant from `003` §6a until `075`, and it was written down in three places
that had to agree: `complete_onboarding`'s own restatement, `enforce_onboarding_completion`'s
INSERT arm, and its UPDATE arm. The requirement is unchanged in *shape* — completion is still a
one-way stamp the client cannot forge, still refused without a username, still refused without
consent — and one conjunct narrower. `profiles.location` survives as an ordinary rider-editable
column with `018`'s length CHECK; what stops existing is the claim that a rider must fill it in
before they may participate.

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

## ADDED Requirements

### Requirement: A relaxed write rule SHALL NOT turn a refusal into a silent overwrite

When a rule that previously **refused** a write is relaxed, every line the refusal used to guard
SHALL be re-read as if it were newly reachable, and any of them that destroys existing data SHALL
be made explicitly non-destructive in the same migration.

`public.complete_onboarding(p_location text)` is the worked example and the reason this
requirement exists. Its body ends in

```sql
update public.profiles p
   set location = p_location, ...
```

which is unconditional. Until `075` a NULL or blank `p_location` raised `check_violation` several
lines above, so that assignment could never receive one. Removing the raise makes it reachable on
the very first call the new client makes — `rpc('complete_onboarding', { p_location: null })` — and
the function is **re-runnable by design** (`059`: *"re-running this updates the location and returns
the ORIGINAL stamp"*). A relaxation that stopped at deleting the raise would therefore ship a
granted RPC that erases `profiles.location`, a rider-authored column, with no error and nothing red.

The write SHALL become `location = coalesce(nullif(btrim(p_location), ''), p.location)`: **NULL and
blank both mean "leave it as it is", never "clear it".** `btrim`/`nullif` are folded in for the
same reason — `018`'s `profiles_location_length` CHECK refuses a trimmed-empty string, so storing a
whitespace argument would raise a `23514` the caller cannot act on where doing nothing is correct.

**This is a rule about relaxations generally, not about one function.** The database is the only
enforcement this app has (`CLAUDE.md`: a rule that only reaches a Zod schema is advisory), so a
guard removed from a `security definer` body removes the *only* thing standing between a client
argument and whatever the body does with it.

#### Scenario: Completing onboarding with no location does not clear an existing one
- **WHEN** a rider whose `profiles.location` is already set calls `complete_onboarding(null)` or
  `complete_onboarding('   ')`
- **THEN** the call SHALL succeed and the stored `location` SHALL be unchanged
- **AND** the returned stamp SHALL still be the ORIGINAL completion stamp for an already-complete
  rider, unchanged from `059`

#### Scenario: Completing onboarding with a location still stores it
- **WHEN** any caller — including a client bundle deployed before this change — calls
  `complete_onboarding('Utrecht')`
- **THEN** the location SHALL be stored and the stamp SHALL be set in the same statement, exactly
  as before `075`
- **AND** the function signature SHALL remain `complete_onboarding(text)`, so `021`'s grant,
  `025`'s footer and every existing caller keep naming the same function

#### Scenario: A blank location is never stored
- **WHEN** `complete_onboarding` is called with a string that is empty after `btrim`
- **THEN** the column SHALL be left at its previous value rather than being written
- **AND** no `23514` SHALL reach the caller from `profiles_location_length` for that argument

### Requirement: Every role's reach into another rider's onboarding state SHALL be restated when the invariant changes

Relaxing a completion rule SHALL NOT widen who can read or write onboarding state, and the
unchanged negatives SHALL be asserted rather than assumed — an unstated negative silently becomes
whatever the migration author assumed.

The subject of `complete_onboarding` is `auth.uid()` and there is no parameter naming a rider. That
is what makes every "another rider" case below a property of the signature rather than of a policy,
and it is why the signature must not grow a user id.

#### Scenario: A rider completes only their own onboarding
- **WHEN** any signed-in rider calls `complete_onboarding`
- **THEN** it SHALL act on `auth.uid()` and on no other row
- **AND** the function SHALL take no user id, so "we check the id matches the caller" is not one
  refactor away from not doing that

#### Scenario: No rider can forge or clear the stamp directly
- **WHEN** a rider PATCHes `profiles.onboarding_completed_at` or `terms_accepted_at` through
  PostgREST, on their own row or anyone else's
- **THEN** the write SHALL be refused for want of a column grant (`025`), unchanged by this change
- **AND** `enforce_onboarding_completion` SHALL remain `security invoker` with its
  `current_user <> 'authenticated'` early return intact, so the seed, the signup trigger and a
  support fix still pass through — `033`'s footer requires this and `075` does not touch it

#### Scenario: A signed-out visitor reaches none of it
- **WHEN** `anon` attempts `complete_onboarding`, `accept_terms` or `my_onboarding_state`
- **THEN** execution SHALL be refused, unchanged from `021`'s `revoke all ... from public, anon`
- **AND** this change SHALL add no policy, grant or route admitting `anon`, per decision #1

#### Scenario: Club owners, admins, members and non-members gain nothing
- **WHEN** a club owner or admin views the roster of any club, including the welcome club every
  rider joins on completion
- **THEN** they SHALL see membership and nothing about whether a member has a `location`,
  because `025` leaves `onboarding_completed_at` and `terms_accepted_at` unreadable by other
  riders and `location` is an ordinary profile column that was already readable
- **AND** no role SHALL gain the ability to see WHICH riders skipped the location, because the
  app stores no record that a step was skipped — a NULL `location` is indistinguishable from one
  cleared in the profile editor, and that is deliberate

#### Scenario: A blocked rider's reach is unchanged
- **WHEN** rider A has blocked rider B and either one completes onboarding
- **THEN** every block-aware policy SHALL behave exactly as before, because this change touches no
  policy and no `private.is_blocked` call site
- **AND** the username availability check SHALL remain block-aware and therefore still wrong in one
  direction (PD-146) — the completing step is now the username step, so a rider blocked by a name's
  holder is refused with `23505` on the step that also completes onboarding

#### Scenario: A refused username leaves the rider un-onboarded, not half-onboarded
- **WHEN** the username write is refused — `23505` from the unique index, or `23514` from the
  charset, length or reserved-name CHECKs
- **THEN** `complete_onboarding` SHALL NOT have been called
- **AND** the rider SHALL remain with a NULL completion stamp and SHALL be able to retry on the
  same screen, because the write that can be refused for a rider-actionable reason runs first

#### Scenario: A rider with no location is a first-class rider everywhere
- **WHEN** a rider completes onboarding with `profiles.location` NULL
- **THEN** they SHALL be visible to every other signed-in rider, because the `profiles` SELECT
  policy keys on `username is not null` and never on `location` or on the completion stamp
- **AND** no read path SHALL filter riders by `location is not null`
- **AND** they SHALL be joined to the club carrying `clubs.is_default` exactly as before (`058`),
  since that block hangs off the transition into completion and not off the location

#### Scenario: The welcome-club join is unchanged in both directions
- **WHEN** a rider completes onboarding under the relaxed rule
- **THEN** the `club_members` insert SHALL still run inside the same transaction, still inside the
  `when others` block that can never take the stamp down with it, and still only on the transition
  into completion — so a rider who joined, left and re-ran the RPC is not put back in
- **AND** `notify_club_joined` SHALL still skip its fan-out for that club (`058` §4), so no rider
  gains a notification from this change
- **AND** `059`'s `raise warning` for "no club carries `clubs.is_default`" SHALL be preserved
  verbatim, because it is the only diagnostic for the failure that presents as success
