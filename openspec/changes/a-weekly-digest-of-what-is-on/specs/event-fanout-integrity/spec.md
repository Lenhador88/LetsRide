## MODIFIED Requirements

### Requirement: Fan-out SHALL be performed by a database trigger and by nothing else

Every notification row SHALL be written by an `AFTER INSERT` (or `AFTER DELETE`) row-level trigger
on the table whose write is the event. No application code, Server Action, Edge Function or client
call SHALL write one.

**Fan-out is an integrity rule, and `CLAUDE.md`'s standing rule is that no integrity rule may live
only in client code.** The client owns the mutation path: a client that also writes the
notification is a client that can decline to write it, write it to the wrong rider, or write one
for an event that did not happen. A trigger is the only place in this architecture the rule cannot
be skipped, because the publishable key ships in the bundle and PostgREST accepts any rider's JWT.

**There is a SECOND fan-out class and this requirement previously had no room for it.** A message
whose occasion is the *passage of time* rather than another rider's write has **no parent row**,
so there is no insert to hang a trigger on. The weekly digest is the first. This requirement is
therefore amended rather than widened: a **scheduled fan-out** is permitted, and the permission is
narrow and carries replacements for every guarantee the trigger was providing.

A fan-out is scheduled **only** where it has no parent row at all. Where one exists — including a
row the fan-out itself would have to create first purely to have something to trigger on — the
trigger form is required and a schedule is refused. *"A schedule is easier to reason about"* is
not a reason; *"there is nothing to fire on"* is the only one.

A scheduled fan-out SHALL carry all five of:

1. **A unique key instead of an idempotent trigger.** The trigger form gets at-most-once from
   firing once per row. A schedule runs repeatedly by design, so exactly-once SHALL be a UNIQUE
   constraint on (recipient, period) and the insert SHALL be `on conflict do nothing`. It SHALL
   NOT rest on a `where not exists` in the job body, on the cron expression's period, or on the
   job running only once.
2. **A candidate-relative body shared with the reader.** The job runs with **no JWT**, so
   `auth.uid()` is NULL and RLS does nothing for it. Every predicate SHALL take the candidate as
   an argument, and the body SHALL be the same one the rider's own read resolves through, so the
   two cannot disagree.
3. **An emptiness rule.** Writing no row SHALL be an ordinary outcome that does not raise, log or
   record an attempt — see the existing *"An event with no recipients writes nothing and does not
   fail"* scenario, which a schedule reaches on most runs rather than rarely.
4. **A per-project gate the migration chain cannot replicate.** `docs/ENVIRONMENTS.md` §Scheduled
   jobs: a `pg_cron` job written in a migration replicates to DEV and fires there. A Vault secret
   is the decided mechanism (`121 §10`), because Vault secrets do not replicate. A job with no
   network hop has no network secret to key on and SHALL therefore carry its own presence gate
   rather than borrowing one that describes something else.
5. **Apply-cleanliness with no extensions present.** Every `vault.`, `cron.` and `net.` reference
   SHALL sit inside dynamic SQL behind a catalogue check, because the RLS suite replays the chain
   against a plain Postgres where none of the three exists.

Everything else in this capability binds a scheduled fan-out unchanged — the security context, the
prohibition on `current_user` branching, the prohibition on caller-relative helpers, the actor
rule, self-suppression, and above all *"A fan-out SHALL NOT write a row that the read policy can
never return to its recipient."*

#### Scenario: The trigger fires whatever issued the write
- **WHEN** the parent row is inserted by the app, by a hand-rolled PostgREST request, by a seed, by
  a `security definer` function, or by `psql` as the table owner
- **THEN** the fan-out SHALL run
- **AND** it SHALL NOT carry a `WHEN (CURRENT_USER = 'authenticated')` clause, because that clause
  is what makes `023`'s participation gate correctly *skip* privileged writes, and a notification
  that silently does not happen for a privileged write is a gap with nothing to detect it

#### Scenario: The trigger is AFTER, not BEFORE
- **WHEN** the fan-out runs
- **THEN** it SHALL run AFTER the parent row exists
- **AND** a parent write refused by RLS, a CHECK or the participation gate SHALL produce no
  notification, because it never reaches the AFTER phase

#### Scenario: A refused parent write leaves nothing behind
- **WHEN** a rider attempts a like, comment, RSVP, ride creation or club join that the database
  refuses
- **THEN** zero notification rows SHALL exist afterwards

#### Scenario: An event with no recipients writes nothing and does not fail
- **WHEN** a ride is created with `club_id` NULL, or the only club member is the actor, or every
  candidate recipient is blocked
- **THEN** zero rows SHALL be written and the parent write SHALL succeed normally

#### Scenario: A message with no parent row is scheduled, and one with a parent row is not
- **WHEN** a new message class is designed
- **THEN** it SHALL use the trigger form if any row's insert is its occasion
- **AND** the scheduled form SHALL be reachable only where the occasion is the passage of time
- **AND** creating a row purely so that a trigger has something to fire on SHALL NOT be accepted
  as satisfying the trigger form

#### Scenario: A schedule's exactly-once is a constraint, not a query
- **WHEN** a scheduled fan-out runs twice in the same period, concurrently or serially
- **THEN** at most one row per recipient per period SHALL exist
- **AND** the assertion SHALL attempt the duplicate insert directly and observe the unique
  violation, rather than observing that the job's own `where not exists` worked

#### Scenario: A scheduled fan-out has no JWT and its assertions therefore mean what they say
- **WHEN** the job runs from `pg_cron`, from the RLS suite, or from a maintenance session
- **THEN** `auth.uid()` SHALL be NULL in all three, and every predicate SHALL still resolve because
  every one takes its subject as an argument
- **AND** a self-suppression written as `recipient <> auth.uid()` SHALL NOT appear, because it
  evaluates to NULL and filters out every recipient

#### Scenario: A scheduled job that fires on the wrong project is a defect the gate prevents
- **WHEN** the migration chain replicates the schedule to a project the owner has not configured
- **THEN** the job SHALL run and write nothing
- **AND** the gate SHALL be a value the chain cannot carry, never a hard-coded project reference,
  because Postgres on Supabase exposes no self-identifying project ref — `cluster_name` is `main`
  and `current_database()` is `postgres` on both projects

## ADDED Requirements

### Requirement: A scheduled fan-out SHALL be bounded per run and SHALL NOT assume its candidate set is small

One invocation SHALL process a bounded number of candidates, and the bound SHALL be applied to the
**candidates** rather than table-wide. A job whose cost grows with the whole rider table is a job
that stops completing at the scale the product is aimed at, and the failure is silent: the
schedule keeps firing, each run times out part-way, and the riders past the cut-off are never
assembled anything.

Candidates SHALL be taken in a **deterministic order** so that a bounded run followed by another
bounded run covers everybody rather than re-covering the same prefix. The unique key makes
re-covering harmless, which is what makes a simple ordering sufficient.

#### Scenario: A run is bounded and the bound is on candidates
- **WHEN** the job runs against a rider table larger than one run can process
- **THEN** it SHALL process a bounded slice and return normally
- **AND** the next run SHALL make progress rather than repeating the same slice

#### Scenario: A rider missed by one run is not missed for the period
- **WHEN** a rider falls outside a run's bound while inside their send window
- **THEN** a later run inside the same window SHALL reach them
- **AND** the send window SHALL be wide enough that this is possible, which is a property of the
  window and of the run interval together and SHALL be stated where both are set

#### Scenario: A single rider's bad data does not take the run down
- **WHEN** one candidate raises — an unresolvable timezone, a malformed value
- **THEN** the run SHALL continue with the remaining candidates
- **AND** the failure SHALL be visible somewhere a human reads, rather than swallowed into a
  silently shorter run
