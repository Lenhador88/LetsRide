# content-moderation Specification

## Purpose
TBD - created by archiving change act-on-postcard-reports. Update Purpose after archive.
## Requirements
### Requirement: Filed reports SHALL be readable by the project owner and by nobody else

`postcard_reports` is write-only today: `011` grants SELECT only to the reporter, and its own
table comment says *"Write-only in practice"*. A triage surface SHALL exist that presents every
filed report with the postcard it names, and it SHALL be reachable **only** by a connection
authenticating as the database owner — the Supabase dashboard's SQL editor.

The surface SHALL be created in the **`private` schema**. That is not a stylistic preference:
an object created in `public` by a migration is born granted to `authenticated` and
`service_role` by Supabase's default privileges, and PostgREST publishes `public`. The same
object in `private` is born with no grants at all, and `anon` and `authenticated` hold no USAGE
on that schema. See `design.md` D1 for the measurement.

The surface SHALL additionally carry an explicit `revoke all … from anon, authenticated,
service_role`, even though all three are already born without the grant, so that a later change
to default privileges cannot silently publish it.

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request arrives with the `anon` key, by any route including PostgREST
- **THEN** `anon` SHALL hold no USAGE on `private`, no privilege on the triage surface, and no
  route to it
- **AND** the signed-out visitor SHALL continue to reach only the app shell and `/legal/*`,
  which is what decision #1 already guarantees

#### Scenario: A signed-in rider cannot read the triage surface
- **WHEN** any rider authenticated as `authenticated` selects from the triage surface, by
  PostgREST or by any SQL path available to that role
- **THEN** the read SHALL be refused
- **AND** `has_schema_privilege('authenticated', 'private', 'usage')` SHALL be false
- **AND** `has_table_privilege('authenticated', '<triage surface>', 'select')` SHALL be false

#### Scenario: `service_role` cannot read the triage surface
- **WHEN** a caller holding the service-role key selects from the triage surface
- **THEN** the read SHALL be refused
- **AND** the refusal SHALL come from the object privilege, because `service_role` **does** hold
  USAGE on `private` (`031` granted it) and holds `BYPASSRLS`, so no other layer is doing the
  work here

#### Scenario: The reported postcard's own author still cannot read reports about it
- **WHEN** the author of a reported postcard reads `postcard_reports` as `authenticated`
- **THEN** they SHALL see zero rows, exactly as before this change
- **AND** the reporter's identity SHALL NOT be discoverable by the reported rider through any
  object this change adds

#### Scenario: A reporter still reads only their own reports
- **WHEN** a rider who has filed a report selects from `postcard_reports`
- **THEN** they SHALL see their own report rows and no others
- **AND** the policy `"Riders see only the reports they filed"` SHALL be unmodified by this
  change

### Requirement: The triage surface SHALL NOT become a second way to read postcards

The triage surface runs as the database owner, who holds `BYPASSRLS`. It therefore resolves
postcards that RLS would refuse to the caller: postcards in private clubs the owner is not a
member of, postcards a viewer has hidden, and postcards authored by a rider who has blocked
them. That bypass is the surface's purpose and SHALL be stated as such in the migration.

Because the bypass is real, unreachability is the entire defence, and the surface SHALL
therefore expose the minimum a triage decision needs.

#### Scenario: Blocking is not undone for anyone who can reach the client
- **WHEN** rider A has blocked rider B
- **THEN** no object added by this change SHALL make B's content, profile or report visible to
  A, or A's to B, through any role reachable from the client
- **AND** decision #2 SHALL remain enforced in RLS for every client role, with the owner
  connection as the single deliberate exception

#### Scenario: The surface exposes no `auth.users` data
- **WHEN** the triage surface is read by the owner
- **THEN** it SHALL NOT expose any column of `auth.users` — no email address, no sign-in
  metadata, no confirmation or password state
- **AND** the reported rider SHALL be identified by `profiles.username` and their uuid

#### Scenario: The surface exposes the reporter as an identifier only
- **WHEN** the triage surface is read by the owner
- **THEN** it SHALL expose `reporter_id` and SHALL NOT expose the reporter's username, profile
  or any other reporter-identifying column

#### Scenario: The surface exposes the image path
- **WHEN** the triage surface is read by the owner
- **THEN** it SHALL expose the reported postcard's `image_path`, because that is the only way to
  locate the Storage object that a take-down cannot delete

#### Scenario: The triage surface is not a write surface
- **WHEN** any role attempts INSERT, UPDATE or DELETE against the triage surface
- **THEN** the attempt SHALL be refused for every role except the database owner
- **AND** no INSERT, UPDATE or DELETE privilege SHALL exist on it for `anon`, `authenticated`
  or `service_role`

### Requirement: A take-down SHALL remove exactly one postcard and SHALL be callable by nobody from the client

A privileged removal SHALL exist that deletes exactly one postcard, named by id. It SHALL take
a single `uuid` argument and SHALL return what it did, so a wrong id is distinguishable from a
successful removal.

It SHALL live in `private`, SHALL be `security invoker` — **not** `security definer` — and SHALL
carry `set search_path = ''` with every name schema-qualified per `005`. `public.moderate_comment`
(`011` §1b) is the precedent for the narrowness and not for the escalation: that function is
`security definer` because a *rider* calls it and cannot read the row their action depends on,
whereas this one is called by the table owner, who already holds `BYPASSRLS` and has nothing to
escalate to. See `design.md` D4.

Callability SHALL be enforced by **both** the grant and the schema placement, so that neither
alone is load-bearing.

#### Scenario: No client role can call the take-down
- **WHEN** `anon`, `authenticated` or `service_role` attempts to call the take-down, by
  PostgREST or by SQL
- **THEN** the call SHALL be refused
- **AND** `has_function_privilege(<role>, '<take-down>(uuid)', 'execute')` SHALL be false for
  each of the three
- **AND** PostgREST SHALL have no route to it, because it routes only to `public`

#### Scenario: The take-down removes one postcard and nothing else
- **WHEN** the owner calls the take-down with the id of one reported postcard
- **THEN** exactly that postcard SHALL be deleted
- **AND** every other postcard, club, ride, profile, comment and report not attached to it SHALL
  still exist, asserted by counting survivors rather than by counting the deletion

#### Scenario: The take-down cannot be turned into a general delete
- **WHEN** the take-down's definition is read
- **THEN** it SHALL name exactly one table in its `delete`, SHALL filter on the `uuid` it was
  given, and SHALL NOT accept a predicate, a filter expression or a second id
- **AND** rows removed alongside the postcard SHALL be removed by the cascades `011` already
  documents, never by a second `delete` in the function body

#### Scenario: No rider gains a delete right over another rider's postcard
- **WHEN** a rider attempts to delete a postcard they did not author
- **THEN** the delete SHALL still affect zero rows, and the postcard SHALL survive
- **AND** `009`'s `"Authors can delete their own postcards"` policy SHALL be unmodified

### Requirement: A take-down SHALL hand back the evidence it destroys

`postcard_reports.postcard_id` is `ON DELETE CASCADE`, so removing a reported postcard erases
the reports about it. **That cascade is kept deliberately**, and so is the absence of any
archive behind it: a store holding a caption, an `image_path` encoding a rider's uuid and an
author id would outlive the account deletion `029` performs and `/legal/account-deletion`
promises erases all three. That is a retention decision with a lawful basis and a window behind
it, not a column a take-down function may add on its own.

So the evidence SHALL be returned to the operator **at the moment of acting**, by the take-down
itself, read before the delete that destroys it. Nothing in the database keeps a second copy.

**Two consequences SHALL be stated rather than discovered**, because both read as defects to
anyone assuming an archive exists:

- A per-author report count computed from live rows is an **open** count and never a lifetime
  one — each take-down zeroes that author's history, so a repeat offender under-counts exactly
  in proportion to how well moderation has been working.
- Nothing records that a take-down happened at all. The only artefact is whatever the operator
  keeps from the return value.

#### Scenario: The take-down returns what it removed
- **WHEN** the owner takes down a postcard that carries reports
- **THEN** the call SHALL return the postcard's id, author, caption and `image_path`, and every
  report against it with its reason, note, reporter identifier and timestamp
- **AND** the reports themselves SHALL then be gone, by the existing cascade

#### Scenario: A take-down that matches nothing is a clean answer
- **WHEN** the take-down is called with an id that matches no postcard
- **THEN** it SHALL report that it removed nothing, rather than raising
- **AND** nothing SHALL be written anywhere

#### Scenario: The per-author count is documented as open rather than lifetime
- **WHEN** a session or an operator reads the triage surface's per-author count
- **THEN** the surface's own comment SHALL say that the count covers open reports only and that
  a take-down erases that author's history

### Requirement: The photo SHALL be deleted in the same sitting, and the copy SHALL NOT promise more

Deleting the `postcards` row does not delete the Storage object at `image_path` — Postgres and
Storage are separate systems — and `delete from storage.objects` is refused outright by
Supabase's own guard (`42501: Direct deletion from storage tables is not allowed`). So **no SQL
this change can write is able to remove the photo.**

**And no policy hides it in the meantime.** It is tempting to reason that an orphaned object is
unreachable, because the `media` bucket is private and `010`'s Storage SELECT policy resolves
through a `postcards` row that no longer exists. That is true of an RLS-mediated read, and
**the app never does one**: `src/lib/data/media.ts` hands the browser a signed URL with a
one-hour TTL, and Supabase validates the signature rather than re-running the policy. A rider
whose feed had already rendered the postcard keeps a working URL for the rest of that hour, and
so does anyone they forward it to, signed out or with no account at all.

A take-down SHALL therefore be a two-step procedure whose second step is written down as a
runbook and understood as **time-bounded rather than optional**, and the rider-facing copy SHALL
NOT claim an immediacy the mechanism does not provide.

#### Scenario: The runbook names the second step and its window
- **WHEN** an operator follows the take-down runbook
- **THEN** it SHALL name the bucket and the path to delete, and SHALL say that until the object
  is deleted an already-issued signed URL keeps working for the remainder of its TTL

#### Scenario: The published copy does not promise an instant
- **WHEN** `/legal/privacy` describes what removing a postcard does
- **THEN** it SHALL NOT state that the photo becomes unfetchable immediately
- **AND** it SHALL name the signed-link window, so the claim stays true whether or not step two
  has run yet

### Requirement: A club thread SHALL be reportable, and its reports SHALL live in their own table

Reports about a thread SHALL be written to `public.club_thread_reports` — a new table — and SHALL
NOT be written to `public.postcard_reports`.

**The reasons are structural rather than aesthetic, and the third alone decides it:**

1. `postcard_reports.postcard_id` is `NOT NULL` with a foreign key to `postcards` and a `unique
   (reporter_id, postcard_id)`. Sharing the table means a nullable subject, a "exactly one of"
   CHECK and two partial unique indexes on a table riders write to today.
2. The two subjects carry different audience predicates. `011`'s INSERT policy inherits block, club
   and hide from an `EXISTS` against `postcards` **while naming none of them**; a thread needs an
   `EXISTS` against `club_threads`. One table means a branching `with check` that names both, and
   the property is gone.
3. `private.postcard_report_queue` — live since `076` — joins `public.postcards` with a plain inner
   join. A thread report in that table would break the operator's queue, or vanish from it behind a
   `left join` "fix". **A report in a table no query returns is the failure `011` spent
   sixty-five migrations in.**

The table SHALL carry `011` §4's shape with the subject renamed: reporter, subject, `reason` under a
CHECK of the same six values, an optional `note` under the same bound, `created_at`, and
`unique (reporter_id, thread_id)`.

`created_at` SHALL be **server-owned** — withheld from the INSERT column grant — because the triage
queue orders by it and a client-stamped value would pin a report to the top of the operator's queue
for ever. This is a stated departure from `011`, which granted INSERT at table level.

A report SHALL NOT be editable or withdrawable: no UPDATE policy, no UPDATE grant, no DELETE policy,
no DELETE grant, for any client role. `011`'s reason carries over — a report is a statement of fact
at a moment in time.

#### Scenario: A report cannot be edited or withdrawn
- **WHEN** a reporter attempts to update or delete their own report
- **THEN** both SHALL be refused
- **AND** the absence SHALL be asserted in **both** directions — no policy and no grant — because a
  well-meaning `grant all` restores only one of them

#### Scenario: A rider cannot stamp a report's creation time
- **WHEN** a client names `created_at` in the insert
- **THEN** it SHALL be refused `42501`
- **AND** the grant SHALL be read scoped to `authenticated`, never counted table-wide, because
  `postgres` and `service_role` hold everything by Supabase default

#### Scenario: The reason list is enforced by the database
- **WHEN** a value outside the six allowed reasons is written
- **THEN** the CHECK constraint SHALL refuse it
- **AND** the Zod enum SHALL be the message and never the guarantee

### Requirement: Nobody inside the club SHALL be able to read a report, including the riders who can act on one

`public.club_thread_reports` SHALL grant SELECT, by policy, to `reporter_id = auth.uid()` and to
nobody else.

Explicitly, and each SHALL be asserted separately because none implies another:

- The **thread's author SHALL NOT** read reports filed against their thread. In a small club, even
  the knowledge that a report exists narrows the reporter to a handful of names, and the rider
  reading it can now remove the reporter (`088`) and delete their thread.
- The **club owner SHALL NOT** read them.
- The **club admin SHALL NOT** read them — and the admin may be the reported party, since `088`
  lets an admin be promoted by another admin.
- **`service_role` SHALL NOT** read them. It SHALL be named in the revoke **at creation**, because
  Supabase's project default grants it everything on a new `public` table — `076` §3b is the worked
  example of noticing that sixty-five migrations late.
- **`anon` SHALL NOT** reach the table by any route.

Revoking `service_role` SHALL NOT break account deletion: a referential cascade runs as the
constraint's system trigger and does not consult privileges. This SHALL be **measured** in a
rolled-back transaction rather than reasoned, because getting it wrong takes account deletion down
and nothing in CI would notice.

The reporter's SELECT SHALL carry **no** club-membership conjunct, so a report survives its
reporter leaving the club and survives a block in either direction. A report is the reporter's own
statement, and it holds a thread id, a reason and a note — no thread content — so it leaks nothing
about a club they have left.

#### Scenario: The reported author reads nothing
- **WHEN** the author of a reported thread selects from `club_thread_reports`
- **THEN** they SHALL read zero rows

#### Scenario: The club's leadership reads nothing
- **WHEN** the club's owner, and separately an admin of that club, select from
  `club_thread_reports`
- **THEN** each SHALL read zero rows

#### Scenario: The reporter keeps their own report after leaving and after blocking
- **WHEN** a reporter leaves the club, or blocks the thread's author, or is blocked by them
- **THEN** they SHALL still read their own report row

#### Scenario: `service_role` can neither read a report nor break the deletion cascade
- **WHEN** `service_role` selects from the table
- **THEN** it SHALL be refused
- **AND** deleting a reporter's `profiles` row as `service_role` SHALL still remove their reports

### Requirement: A filed report SHALL have a reader, and that reader SHALL be the project owner outside the API

The migration that creates the table SHALL, in the same file, create the surface that reads it.
Shipping the table alone SHALL be treated as the defect `076`'s title names.

The reader SHALL be `private.club_thread_report_queue` (a view) and
`private.remove_reported_thread(uuid)` (the take-down), both in the `private` schema, on `076`'s
objects line for line:

- The view SHALL declare `with (security_invoker = false)` **explicitly**, though it is the default,
  because running as its owner is the entire reason it can answer and an implicit load-bearing
  default is invisible.
- The take-down SHALL NOT be `security definer` — its only caller is already the owner, and marking
  it definer would add an advisor for a function no `authenticated` session can execute.
- Both SHALL be revoked from `public`, `anon`, `authenticated` **and `service_role`**, the last
  named because it holds USAGE on `private` (`031`) and is the one client-side role for which the
  schema is not already the barrier.
- Neither SHALL be a write surface for any role.

**This change SHALL add no security advisor.** Both new objects are in `private`; the one `public`
function it touches already carries its advisor.

There SHALL be **no `resolved_at`, no status column and no workflow**. `011` and `076` both refuse
it for the same reason: it makes the queue a product with two writers, and this project has no
moderator role to be the second one.

#### Scenario: No client role can reach the triage surface
- **WHEN** `anon`, `authenticated` or `service_role` attempts to select the view or execute the
  take-down
- **THEN** each SHALL be refused
- **AND** three independent barriers SHALL hold for the first two: no USAGE on `private`, no
  privilege on the object, and PostgREST not routing to `private`

#### Scenario: The triage view is not a second way to read a private club
- **WHEN** the view is queried by its owner
- **THEN** it SHALL return rows that RLS would hide from any member — every membership and block
  predicate stepped past
- **AND** that SHALL be the reason no PostgREST role may reach it, rather than an accident of how
  it was written

#### Scenario: The reporter is a uuid and never a name
- **WHEN** the queue is read
- **THEN** the reporter SHALL appear as a uuid with no username, email or profile join
- **AND** the reported rider's username SHALL be present, because a thread is judged with its
  author's name as context and the reporter's is not needed to judge it

### Requirement: A take-down SHALL hand back the evidence it destroys, and the evidence SHALL NOT outlive the thread

`club_thread_reports.thread_id` SHALL be `ON DELETE CASCADE`, so deleting a thread — by its author,
by moderation, by the club's deletion, or by the take-down — destroys the reports about it.

**That is a decision, not an inheritance.** Preserving it would need a store holding a rider's
words about another rider, a thread's title and an author id, surviving the account deletion `029`
performs and `/legal/account-deletion` promises erases. A moderation archive is a real product with
a retention window and a lawful basis, and inventing one inside a take-down function is how it
arrives with neither.

So `private.remove_reported_thread` SHALL read the evidence **before** the delete and return it: the
thread and its club, the author's id and username, every report with its reason, note and reporter
uuid, and the thread's messages — capped, with a total beside the cap so a truncation is visible
rather than silent. The messages are included where `076` needed only a caption, because the
reportable content of a thread is mostly its replies.

The take-down SHALL delete **exactly one** thread, named by id, and SHALL NOT be usable as a general
delete. Rows that go with it SHALL go by existing cascades, so the blast radius is a property of the
schema rather than of this body — and that chain SHALL be **read off `pg_constraint`** when the
function is written rather than remembered, `076`'s header recording that it once named one cascade
of five.

Retention SHALL be stated in the table comment at creation: a report lives as long as its thread and
its reporter and no longer, through two cascades and nothing else, with no scheduled deletion —
this repo having taken no decision on `pg_cron`.

#### Scenario: A take-down returns what it is about to erase
- **WHEN** the operator calls the take-down on a reported thread
- **THEN** the return value SHALL carry the reports, their reasons, their notes and their reporter
  uuids, read before the delete
- **AND** afterwards those reports SHALL no longer exist

#### Scenario: Deleting a thread by any route removes its reports
- **WHEN** a thread is deleted by its author, by a moderator, or by its club being deleted
- **THEN** the reports about it SHALL be removed by cascade with no new cleanup path

#### Scenario: A missing thread is a clean answer
- **WHEN** the take-down is called on a thread id that no longer exists
- **THEN** it SHALL return a "not removed" answer rather than raising, because an operator acting on
  a queue row somebody already deleted has done nothing wrong

### Requirement: Reporting a thread SHALL notify nobody

No notification SHALL be written to any recipient when a report is filed — not the thread's author,
not the club's owner or admins, not the reporter.

`public.notifications` SHALL gain no type, no subject column and no CHECK arm from this change. It
follows that this change carries **none** of `089`'s client-ordering constraint: no exhaustive
`switch` in `notificationCopy` or `NotificationsListItem` can be made non-exhaustive by it.

Nothing in the app SHALL indicate that a thread has been reported — no badge, no count, no flag —
pending the product owner's answer on whether the club's admins see anything at all.

#### Scenario: A report writes no notification row
- **WHEN** a rider reports a thread
- **THEN** zero `notifications` rows SHALL be written
- **AND** the count SHALL be asserted rather than assumed

