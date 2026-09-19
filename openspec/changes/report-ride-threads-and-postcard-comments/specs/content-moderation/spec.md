# Spec Delta

> **Coordination.** `content-moderation` exists in `openspec/specs/` (folded out of
> `act-on-postcard-reports`) and today describes **postcards only**. This delta is **ADDED only**:
> it extends the capability to two further subjects and modifies no requirement that change wrote.
> `moderate-and-report-club-threads` is a third, still-active change adding the club-thread subject
> to the same capability, also ADDED only, and the two do not collide — no heading is shared.
> Re-derive with `ls openspec/specs/` and `ls openspec/changes/`.

## ADDED Requirements

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
