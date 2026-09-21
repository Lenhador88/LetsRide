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

### Requirement: A ride thread and a postcard comment SHALL each be reportable into their own table

Reports about a ride thread SHALL be written to `public.ride_thread_reports`, and reports about a
postcard comment to `public.postcard_comment_reports`. Neither SHALL be written to
`public.postcard_reports` or `public.club_thread_reports`.

**A table per subject, and the third reason decides it alone:**

1. `postcard_reports.postcard_id` is `NOT NULL` with a foreign key and a
   `unique (reporter_id, postcard_id)`. Sharing it means a nullable subject, an "exactly one of"
   CHECK and partial unique indexes on a table riders write to today.
2. The audience predicates differ and cannot share a policy. A postcard report inherits club, hide
   and block from an `EXISTS` against `postcards`; a ride thread inherits ride visibility, crew
   membership and a block arm; a comment inherits its own author arm plus the postcard's audience.
   One table means a branching `with check` naming all of them, and the property each policy exists
   for is gone.
3. **There is a LIVE reader whose join is unconditional.** `private.postcard_report_queue` (`076`)
   inner-joins `public.postcards`. A thread or comment report in that table either breaks the
   operator's queue or vanishes from it behind a `left join` "fix" — a report in a table no query
   returns is worse than no table.

Each table SHALL carry: `reporter_id` and the subject id, both `NOT NULL` with `ON DELETE CASCADE`
foreign keys; `reason` under a CHECK of the same six values the other two report tables use; an
optional `note` under the same bound, where an empty string is not a note; a server-owned
`created_at`; and `unique (reporter_id, <subject>_id)` leading with `reporter_id`, which is both
the anti-brigading key and the index the `profiles` cascade uses.

A report SHALL NOT be editable or withdrawable by anyone: no UPDATE policy, no UPDATE grant, no
DELETE policy, no DELETE grant, for any client role.

#### Scenario: A rider reports a thread they can read
- **WHEN** a rider on a ride's crew, who can read one of its threads, files a report against it
- **THEN** exactly one row SHALL be written to `public.ride_thread_reports` with their own
  `reporter_id`
- **AND** nothing the rider or anyone else can read SHALL change

#### Scenario: A rider reports a comment they can read
- **WHEN** a rider who can read a comment on a postcard files a report against it
- **THEN** exactly one row SHALL be written to `public.postcard_comment_reports`
- **AND** the comment SHALL remain exactly as visible as it was, to the reporter and to everyone
  else, because reporting is not hiding

#### Scenario: The same subject cannot be reported twice by the same rider
- **WHEN** a rider files a second report against a subject they have already reported
- **THEN** the unique constraint SHALL refuse it
- **AND** the client SHALL absorb the refusal as a no-op rather than showing an error
- **AND** the operator's queue SHALL hold one row for that pair, never two

#### Scenario: A report cannot be edited or withdrawn
- **WHEN** a reporter attempts to update or delete their own report
- **THEN** both SHALL be refused
- **AND** the absence SHALL be asserted in **both** directions — no policy and no grant — because a
  well-meaning `grant all` restores only one of them

#### Scenario: A rider cannot stamp a report's creation time
- **WHEN** a client names `created_at` in the insert
- **THEN** it SHALL be refused
- **AND** the INSERT grant SHALL be read scoped to `authenticated` and column by column, never
  counted table-wide, because `postgres` and `service_role` hold everything by Supabase default

#### Scenario: The reason list is enforced by the database
- **WHEN** a value outside the six allowed reasons is written
- **THEN** the CHECK constraint SHALL refuse it
- **AND** the Zod enum SHALL be the message and never the guarantee

### Requirement: The reportable set SHALL be exactly the readable set, and the inheritance SHALL NOT be restated

Each INSERT policy SHALL be `reporter_id = auth.uid()` conjoined with a bare `EXISTS` against the
subject table, and SHALL name no membership predicate, no club predicate, no hide predicate and no
block predicate. The `EXISTS` is evaluated under the caller's own row security, so "may I report
this" resolves to "may I read this" by construction and cannot drift from the policy that owns the
subject's audience.

A rider MAY report their own thread or their own comment — the policy permits it and the row is
inert — but no affordance SHALL be drawn for them.

#### Scenario: A rider who is not on the crew cannot report a ride thread
- **WHEN** a signed-in rider who can see a ride, but is not on its crew, files a report against one
  of its threads
- **THEN** the insert SHALL be refused
- **AND** the refusal SHALL come from the inherited `EXISTS`, with no crew predicate written in the
  report policy

#### Scenario: A pending invitee cannot report a ride thread
- **WHEN** a rider holding an unaccepted ride invite files a report against a thread on that ride
- **THEN** the insert SHALL be refused, because the invite widens ride visibility and never thread
  visibility

#### Scenario: A rider who cannot see the postcard cannot report its comments
- **WHEN** a rider who is not in the postcard's private club, or who has hidden that postcard, or
  whose author has blocked them, files a report against a comment on it
- **THEN** the insert SHALL be refused in all three cases, by the same inherited `EXISTS`

#### Scenario: A rider cannot report as somebody else
- **WHEN** a rider files a report carrying another rider's `reporter_id`
- **THEN** the insert SHALL be refused by the policy, not by client convention

#### Scenario: An un-onboarded rider is refused without learning anything
- **WHEN** a rider who has not accepted the terms files a report against a subject they can read,
  and against one they cannot
- **THEN** both SHALL be refused by the participation gate with the identical error
- **AND** the two refusals SHALL be asserted equal as strings, so the gate cannot become an
  existence oracle

### Requirement: Blocking SHALL make reporting unreachable, and that consequence SHALL be stated rather than patched

Where a block hides the subject, the report SHALL be refused, in both directions, because the
inherited `EXISTS` resolves to zero rows. Block-then-report SHALL be unreachable by construction.

No `security definer` reporting function SHALL be introduced to step past a block, and no block-arm
exemption SHALL be written into a report policy: the first would have to decide what to tell a
caller about a row they cannot see, and the second would let a rider probe for the existence of
content authored by riders who blocked them.

A block SHALL NOT retract a report already filed, in either direction, and SHALL NOT disclose to
either party that a report exists.

#### Scenario: Blocking first makes the report impossible
- **WHEN** a rider blocks an author and then attempts to report that author's thread or comment
- **THEN** the report SHALL be refused
- **AND** the rider's remaining remedies SHALL be the block itself, hiding the postcard, and
  leaving the crew

#### Scenario: The photo owner's fallback survives in SQL and not in the app, and SHALL be stated as such
- **WHEN** the author of a postcard has blocked a rider who commented on it
- **THEN** the existing `security definer` moderation function SHALL still accept that comment's id
  from them, the privilege being keyed on the postcard's author and not on readability
- **AND** no screen SHALL be able to supply that id, because the comment list resolves under the
  caller's own row security and the block removes the row from it
- **AND** the consequence SHALL be stated rather than implied: the comment stays visible to every
  other viewer while the photo's owner can neither see, report nor remove it through any control
  the app draws
- **AND** this change SHALL NOT redesign that path, it being pre-existing, and SHALL NOT claim the
  block costs the photo's owner nothing

#### Scenario: A block does not unmake an earlier report
- **WHEN** a rider reports a subject and afterwards blocks its author, or is blocked by them
- **THEN** the report SHALL still exist and SHALL still be readable by its reporter and by the
  operator's queue
- **AND** neither party SHALL be told anything about it

### Requirement: Nobody who can act on the content SHALL be able to read a report about it

Each table SHALL grant SELECT, by policy, to `reporter_id = auth.uid()` and to nobody else. The
SELECT policy SHALL carry no membership, crew or club conjunct: a report is the reporter's own
statement, it holds an id, a reason and a note but no content, and evidence that evaporates when
the reporter leaves is not evidence.

**Specifically, and each SHALL be asserted separately**: the thread's author, the ride's organiser,
the comment's author, the postcard's author whose photo the comment sits on, and any club owner or
admin SHALL read zero rows. The delete rights those riders hold SHALL be unchanged and SHALL NOT be
read as implying a read right.

`service_role` SHALL be named in an explicit revoke at creation on both tables. These are
restricted-readership sinks: a row is one rider's accusation against another, and the reporter's
identity is precisely what the one credential that bypasses RLS must not be able to enumerate.
Account deletion SHALL be unaffected, because a referential cascade runs as the constraint's system
trigger and does not consult privileges.

#### Scenario: The reported rider reads nothing
- **WHEN** the author of a reported thread, or the author of a reported comment, selects from the
  report table
- **THEN** they SHALL see zero rows
- **AND** the reporter's identity SHALL NOT be discoverable by them through any object this change
  adds

#### Scenario: The ride's organiser reads nothing
- **WHEN** the organiser of the ride a reported thread belongs to selects from the report table
- **THEN** they SHALL see zero rows
- **AND** their existing right to remove the thread SHALL be unchanged

#### Scenario: The postcard's author reads nothing about comments on their own photo
- **WHEN** the author of a postcard selects from the comment-report table
- **THEN** they SHALL see zero rows
- **AND** their existing right to remove any comment on their postcard SHALL be unchanged

#### Scenario: A reporter reads only their own reports
- **WHEN** a rider who has filed reports selects from either table
- **THEN** they SHALL see their own rows and no others
- **AND** this SHALL hold after they leave the crew, leave the club or hide the postcard

#### Scenario: `service_role` reads neither table
- **WHEN** a caller holding the service-role key selects from either table
- **THEN** the read SHALL be refused by an explicit revoke issued at creation
- **AND** deleting a reporter's account SHALL still cascade their reports away, asserted rather
  than reasoned

#### Scenario: `anon` reaches neither table
- **WHEN** a request arrives with the publishable key and no session
- **THEN** it SHALL reach no row of either table, by any route
- **AND** neither table SHALL appear in any policy or grant naming `anon`

### Requirement: Each new report table SHALL ship its reader in the same migration, outside the API

Each table SHALL be created together with a triage view and a take-down in the `private` schema:
one row per open report with the context a triage decision needs, and a removal of exactly one
subject named by id.

Both SHALL be unreachable from the client by three independent barriers — `anon` and
`authenticated` hold no USAGE on `private`, `service_role`'s privileges are explicitly revoked
though it does hold USAGE, and PostgREST routes only to `public`. The take-down SHALL NOT be
`security definer`: its only caller is the owner, who has nothing to escalate to, and marking it
definer would add a security advisor for a function no session can execute.

**Neither object SHALL become a second way to read a row RLS would refuse.** Each view runs as its
owner and therefore steps past every crew, club, hide and block predicate in the system. That
bypass is the surface's purpose and SHALL be stated as such in the migration; unreachability is the
entire defence, so each view SHALL expose the minimum a triage decision needs and no more.

#### Scenario: No client role reaches a queue
- **WHEN** `anon`, `authenticated` or `service_role` selects from either queue, by PostgREST or by
  SQL
- **THEN** the read SHALL be refused
- **AND** the absence of schema USAGE, the explicit revoke, and the absence of a PostgREST route
  SHALL each be asserted, because any one of them alone would be load-bearing

#### Scenario: No client role calls a take-down
- **WHEN** `anon`, `authenticated` or `service_role` calls either take-down
- **THEN** the call SHALL be refused
- **AND** `has_function_privilege` SHALL be false for each of the three
- **AND** neither function SHALL be `security definer`

#### Scenario: A queue names the reporter as an identifier only
- **WHEN** the owner reads either queue
- **THEN** it SHALL expose `reporter_id` and SHALL NOT join `profiles` for the reporter or expose
  their username, email or any other reporter-identifying column
- **AND** it SHALL expose no column of `auth.users`

#### Scenario: The comment queue shows the words, not the photo
- **WHEN** the owner reads the comment queue
- **THEN** it SHALL expose the comment's body, its author's id and username, its timestamp, the
  postcard it sits on and the counts needed to spot a pattern
- **AND** it SHALL NOT expose the postcard's `image_path`, because removing a comment removes no
  Storage object and an offensive photo is reportable through the surface that already carries that
  column

#### Scenario: A take-down removes one subject and nothing else
- **WHEN** the owner calls a take-down with one id
- **THEN** exactly that thread, or exactly that comment, SHALL be deleted
- **AND** every other row not attached to it SHALL survive, asserted by counting survivors
- **AND** rows removed alongside it SHALL be removed by existing cascades, never by a second
  `delete` in the function body

#### Scenario: A take-down cannot be turned into a general delete
- **WHEN** either take-down's definition is read
- **THEN** it SHALL name exactly one table in its `delete`, filter on the `uuid` it was given, and
  accept no predicate, filter expression or second id

#### Scenario: A take-down that matches nothing is a clean answer
- **WHEN** a take-down is called with an id that matches no row — including one an operator is
  acting on from a queue somebody has already deleted
- **THEN** it SHALL report that it removed nothing rather than raising
- **AND** nothing SHALL be written anywhere

### Requirement: A take-down SHALL hand back the evidence it destroys, and no archive SHALL outlive the subject

Reports cascade with their subject, so a take-down erases the reports about it. **That cascade is
kept deliberately**, and so is the absence of any archive behind it: a store holding a rider's words
and another rider's accusation would outlive the account deletion `/legal/account-deletion`
promises erases both.

Each take-down SHALL therefore read the evidence **before** the delete and return it, so the
operator holds it at the moment they act. The thread take-down SHALL additionally return the
thread's messages, capped, with a total beside the cap so a truncation is visible rather than
silent.

Two consequences SHALL be stated rather than discovered: a per-author count computed from live rows
is an **open** count and never a lifetime one, and nothing records that a take-down happened at all.

#### Scenario: The take-down returns what it removed
- **WHEN** the owner takes down a reported thread or comment
- **THEN** the call SHALL return the subject, its author, its text, and every report against it with
  reason, note, reporter identifier and timestamp
- **AND** the reports SHALL then be gone, by the existing cascade

#### Scenario: The per-author count is documented as open rather than lifetime
- **WHEN** a session or an operator reads either queue's per-author count
- **THEN** the view's own comment SHALL say the count covers open reports only and that a take-down
  erases that author's history

### Requirement: Retention SHALL be stated at creation, and a report SHALL die with its subject and its reporter

Each table's comment SHALL state its retention at creation: indefinite, ending only when its subject
is deleted or its reporter's account is deleted, through two `ON DELETE CASCADE`s and nothing else.
There SHALL be no scheduled deletion, no `resolved_at` and no take-down ledger — the first needs a
mechanism this repo has not chosen, and the second would need an UPDATE grant both existing report
tables refuse and would make the queue a workflow with two writers.

#### Scenario: Deleting the subject deletes its reports
- **WHEN** a ride thread, a ride, a postcard comment or a postcard is deleted by any existing path
- **THEN** the reports hanging off it SHALL be deleted by cascade, with no new cleanup path
- **AND** the operator's queue SHALL simply stop returning them

#### Scenario: Deleting the reporter's account deletes their reports
- **WHEN** a rider deletes their account
- **THEN** every report they filed SHALL be removed by the `profiles` cascade
- **AND** an index leading with `reporter_id` SHALL exist for that cascade to use

#### Scenario: Retention is legible from the database itself
- **WHEN** a session reads either table's comment
- **THEN** it SHALL state the retention, the two cascades, and that there is no scheduled deletion

### Requirement: Reporting SHALL notify nobody and SHALL change nothing the app can read

No notification of any kind SHALL be produced by a report — not to the reported rider, not to the
ride's organiser, not to a club's owner or admin, not to the reporter. No badge, no timeline entry,
no fan-out row.

Because nothing readable changes, reporting SHALL invalidate no cache key on either surface, and no
query key SHALL be introduced for a report.

#### Scenario: Nothing is fanned out
- **WHEN** a report is filed
- **THEN** no notification row SHALL be written and no existing fan-out SHALL fire
- **AND** the only artefact SHALL be the report row itself

#### Scenario: The client makes no cache claim
- **WHEN** the report action succeeds
- **THEN** it SHALL invalidate no key, and the screen SHALL confirm with a banner rather than a
  refetch
- **AND** the action module SHALL remain one that already makes a cache claim for its other writes,
  so the standing "every table writer makes a cache claim" check stays honest rather than gaining a
  new exemption

### Requirement: The comment surface SHALL offer a report control to every rider but the comment's author

A comment the viewer did not write SHALL carry a report affordance wherever comments are rendered —
the postcard detail screen and the swipeable viewer alike, since both mount the same list. A
comment the viewer wrote SHALL NOT carry one.

The control SHALL meet the app's 44px touch floor, SHALL be one tap with no reason step while no
reason step is drawn, SHALL confirm with a banner and SHALL NOT navigate. It SHALL be a display
hint only: the database SHALL refuse a forged attempt on its own.

A failed report SHALL say it failed and SHALL NOT disclose why.

#### Scenario: A rider reports somebody else's comment
- **WHEN** a signed-in rider taps the report control on a comment they did not write
- **THEN** the report SHALL be filed, a confirmation SHALL appear, and the rider SHALL stay where
  they are
- **AND** the comment SHALL remain visible to them, because reporting is not hiding

#### Scenario: A rider sees no report control on their own comment
- **WHEN** a rider views a comment they wrote
- **THEN** no report control SHALL render for it
- **AND** the delete control SHALL render exactly as it does today

#### Scenario: A comment rendered while the session is unknown offers nothing it cannot deliver
- **WHEN** the viewer's identity has not resolved
- **THEN** the report control SHALL NOT be drawn on every comment by default, and the existing
  delete control's gate SHALL be unchanged

#### Scenario: A failed report is legible and uninformative
- **WHEN** the report write fails, for any reason including a refusal by RLS
- **THEN** the rider SHALL be told it did not send and offered the action again
- **AND** no PostgREST code, relation name, or difference between "not allowed" and "does not
  exist" SHALL be shown

