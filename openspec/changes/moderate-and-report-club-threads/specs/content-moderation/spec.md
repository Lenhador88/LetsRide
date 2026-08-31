> **Coordination.** This capability does not exist in `openspec/specs/` yet — it is created by the
> active change `act-on-postcard-reports`. This delta is **ADDED only**, deliberately, so whichever
> of the two archives first creates the capability and the second extends it. Nothing here modifies
> a requirement that change wrote. Re-derive with `ls openspec/specs/`.

## ADDED Requirements

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
