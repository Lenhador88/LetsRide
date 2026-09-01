## ADDED Requirements

### Requirement: A reply to a club thread SHALL notify the rider who started it, and nobody else

`notifications` SHALL gain a fifteenth type, `club_thread_replied`, written by an `AFTER INSERT`
trigger on `public.club_messages`. Its recipient SHALL be `club_threads.author_id` for the thread the
message belongs to. Its subject SHALL be `thread_id` alone, with `postcard_id`, `comment_id`,
`ride_id` and `club_id` all NULL.

**No notification in this schema fires on a `club_messages` insert today** — fourteen types and none
of them a reply — so a rider who opens a thread and is answered by three people is told nothing, ever.
That is the gap this requirement closes, and it is what makes an introduction thread worth writing.

The recipient set is one rider by decision, on `ride_joined`'s original footing: *widening it is a
product decision recorded as an open question, not a default.* `proposal.md` Q1 is that question.

#### Scenario: The thread's author is notified of a reply

- **WHEN** a club member inserts a `club_messages` row into a thread they did not author
- **THEN** exactly one `club_thread_replied` row SHALL be written, addressed to
  `club_threads.author_id`
- **AND** it SHALL carry `thread_id` and no other subject column

#### Scenario: Replying to your own thread notifies nobody

- **WHEN** the thread's author replies in their own thread
- **THEN** zero notification rows SHALL be written
- **AND** the exclusion SHALL be by rider id read from the inserted row, never from `auth.uid()`

#### Scenario: No other member of the club is notified

- **WHEN** a reply is written in a thread with other members and other prior repliers present
- **THEN** only the thread's author SHALL receive a row
- **AND** the club's owner SHALL NOT, its admins SHALL NOT, its ordinary members SHALL NOT, and prior
  repliers SHALL NOT
- **AND** the assertion SHALL be made with at least one prior replier present, because a
  single-participant thread cannot distinguish the author-only set from a participants set

#### Scenario: One rider replying repeatedly produces one live row

- **WHEN** the same rider posts ten messages in the same thread
- **THEN** exactly one `club_thread_replied` row SHALL exist for that recipient and that actor in that
  thread
- **AND** its `created_at` SHALL be the instant of their **first** reply and SHALL NOT be moved
- **AND** the collapse SHALL come from `notifications_event_key`, absorbed by `on conflict do nothing`
  rather than raised

#### Scenario: Five riders replying produce five rows

- **WHEN** five different riders each reply in the same thread
- **THEN** five `club_thread_replied` rows SHALL exist, all addressed to the thread's author
- **AND** each SHALL open the same thread

#### Scenario: A non-member cannot cause the notification at all

- **WHEN** a rider who is not a member of the club attempts to insert a `club_messages` row into one
  of its threads
- **THEN** the insert SHALL be refused, because `club_messages` INSERT carries an `EXISTS` against
  `club_threads` evaluated under the caller's own row security and `club_threads` SELECT requires
  `private.is_club_member(club_id)`
- **AND** zero notification rows SHALL exist afterwards, because an `AFTER` trigger never reaches a
  refused write

### Requirement: A wave on a club thread SHALL notify the rider who started it, and SHALL be retracted when withdrawn

`notifications` SHALL gain a sixteenth type, `club_thread_waved`, written by an `AFTER INSERT` trigger
on `public.club_thread_waves` and removed by an `AFTER DELETE` trigger on the same table. Its
recipient SHALL be `club_threads.author_id`. Its subject SHALL be `thread_id` alone.

**A thread wave notifies nobody today, and that was deliberate**: `092` shipped
`public.club_thread_waves` with no fan-out and recorded it in the database, in
`comment on function private.notify_club_waved()` — *"A THREAD wave notifies nobody at all; there is
deliberately no notify_club_thread_waved."* This requirement reverses that decision on the product
owner's instruction, and the comment SHALL be corrected in the same migration.

#### Scenario: The thread's author is notified of a wave

- **WHEN** a club member inserts a `club_thread_waves` row for a thread they did not author
- **THEN** exactly one `club_thread_waved` row SHALL be written, addressed to `club_threads.author_id`

#### Scenario: Waving your own thread notifies nobody

- **WHEN** the thread's author waves at their own thread
- **THEN** zero notification rows SHALL be written

#### Scenario: Un-waving removes exactly the row the wave wrote

- **WHEN** a rider deletes their `club_thread_waves` row
- **THEN** the matching `club_thread_waved` notification SHALL be removed, whether or not it had been
  read
- **AND** the recipient's unread count SHALL fall if it was unread, which SHALL be accepted rather
  than compensated for

#### Scenario: One rider's un-wave cannot reach another rider's notification

- **WHEN** riders A and B have both waved the same thread, and A un-waves
- **THEN** A's `club_thread_waved` notification SHALL be removed and B's SHALL survive
- **AND** the retraction SHALL match on `user_id`, `type`, `actor_id` **and** `thread_id` together,
  never on a subset
- **AND** this SHALL be asserted with two actors, because a single-actor assertion cannot fail

#### Scenario: Deleting the thread retracts the wave notification twice over, harmlessly

- **WHEN** a thread is deleted and its `club_thread_waves` rows cascade away
- **THEN** the `AFTER DELETE` retraction SHALL fire once per cascaded row, inside the deletion's own
  transaction, which SHALL be recorded rather than discovered
- **AND** the same rows are removed by `notifications.thread_id`'s own cascade, so the retraction is
  at worst redundant and never wrong
- **AND** the redundancy SHALL NOT be removed by adding a `pg_trigger_depth()` or `TG_OP` guard,
  because a guard that skips the cascade case is one refactor away from skipping the rider case

#### Scenario: Wave, un-wave and wave again re-notifies once per cycle, and that is a stated cost

- **WHEN** a rider waves, un-waves and waves the same thread again
- **THEN** exactly one live row SHALL exist afterwards
- **AND** it SHALL be a **new** row with a new `created_at` and an unread state, because the
  retraction removed the first and the collapse key therefore did not collide
- **AND** this SHALL be recorded as the same exposure `club_waved` carries since `092`, bounded by
  `club_thread_waves`' primary key `(thread_id, user_id)` and by the recipient being a single rider
  who can block the waver
- **AND** the alternative — dropping the retraction, which is what `090` did to `ride_invited` for
  exactly this reason — SHALL be an open question against **all three** wave-shaped fan-outs together
  rather than a divergence introduced here

### Requirement: A reply notification SHALL NOT be retracted when its message is deleted

No `AFTER DELETE` trigger SHALL be created on `public.club_messages`.

The standing rule already decides this: *"a retraction hanging off a DELETE the **actor** controls is
a rider-aimed delete of another rider's row in a table no rider may write … accepted once for likes
and not a second time."* `public.delete_own_club_message` is exactly such a DELETE. Two further
reasons hold independently: a rider who replied three times holds **one** notification keyed on the
thread, so removing it on one message's deletion would clear a row the other two still justify; and
post-then-delete-then-post would re-notify once per cycle, which is `090`'s generator.

#### Scenario: Deleting your reply leaves the notification standing

- **WHEN** a replier deletes their own message through `public.delete_own_club_message`
- **THEN** the `club_thread_replied` notification SHALL survive, unchanged
- **AND** the recipient SHALL keep reading "replied to ‹thread›" about a message that is gone, which
  is correct because the row records an **event at an instant** and not a standing claim about the
  present

#### Scenario: Deleting one of several replies changes nothing

- **WHEN** a rider who has posted three messages in a thread deletes one of them
- **THEN** exactly one `club_thread_replied` row SHALL still exist for that actor and thread

### Requirement: The two new types SHALL carry a `thread_id`, and every other type SHALL carry NULL there

`notifications` SHALL gain `thread_id uuid references public.club_threads(id) on delete cascade`.
`notifications_type_check` SHALL admit the two new types. `notifications_subject_shape` SHALL be
re-created with **sixteen** arms: two new ones requiring `thread_id IS NOT NULL` with every other
subject column NULL, and **`AND thread_id IS NULL` added to each of the fourteen existing arms**. The
`ELSE false` fallthrough SHALL remain.

**Adding the column and leaving the existing arms alone is the defect this requirement exists to
prevent.** A `postcard_liked` row could then legally carry a `thread_id`, which would place it in a
different equivalence class under the collapse key, break its own retraction's four-column scope, and
make it resolvable or not according to a thread nothing about it renders. Nothing would refuse it.

#### Scenario: An existing type cannot carry a thread

- **WHEN** a `postcard_liked`, `ride_joined`, `club_joined` or any other pre-existing row is written
  with a non-NULL `thread_id`
- **THEN** the insert SHALL be refused by `notifications_subject_shape`
- **AND** the assertion SHALL name at least two of the fourteen, because a single one cannot show the
  arms were rewritten rather than one arm patched

#### Scenario: A new type cannot carry a postcard, comment, ride or club

- **WHEN** a `club_thread_replied` or `club_thread_waved` row is written with any of `postcard_id`,
  `comment_id`, `ride_id` or `club_id` non-NULL
- **THEN** the insert SHALL be refused

#### Scenario: A new type cannot be written without a thread

- **WHEN** either new type is written with `thread_id` NULL
- **THEN** the insert SHALL be refused

#### Scenario: An unknown type is still refused by the fallthrough

- **WHEN** a row with a type absent from `notifications_subject_shape` is inserted
- **THEN** the insert SHALL be refused by the `ELSE false` arm
- **AND** the refusal SHALL not depend on the type list, so the two constraints cannot silently
  disagree

### Requirement: The collapse key SHALL include `thread_id`, and rebuilding it SHALL change no existing collapse

`notifications_event_key` SHALL be re-created over `(user_id, type, actor_id, postcard_id, comment_id,
ride_id, club_id, thread_id)`, still `NULLS NOT DISTINCT`, with `thread_id` **appended last**.

**Without it, a reply notification collapses per *(recipient, type, actor, club)*.** Ana replies in
thread X and the author is notified; Ana replies in thread Y **in the same club** and `on conflict do
nothing` absorbs it — so the author is never told, for ever, with nothing raised anywhere. That is why
the column is mandatory rather than convenient.

**The rebuild SHALL be proved safe rather than asserted**, on three measured facts: the key is a plain
UNIQUE INDEX and not a table constraint, so nothing depends on a constraint name; every existing row
has `thread_id` NULL and `NULLS NOT DISTINCT` compares NULLs equal, so appending a column constant
across every existing row cannot split an equivalence class; and **every one of the twelve existing
fan-outs ends in a bare `on conflict do nothing`** with no index name and no column list, so none
names the index and none needs editing.

#### Scenario: Every existing type collapses exactly as it did

- **WHEN** each pre-existing fan-out is exercised twice with identical inputs after the rebuild
- **THEN** exactly one row SHALL exist for each, as before
- **AND** liking, unliking and liking again SHALL still leave one row
- **AND** leaving and rejoining a ride SHALL still produce exactly one

#### Scenario: A duplicate found during the rebuild is a pre-existing defect, not a rebuild problem

- **WHEN** the `create unique index` fails on existing data
- **THEN** it SHALL be treated as a pre-existing duplicate and investigated as a finding
- **AND** the migration SHALL NOT be made to succeed by weakening the index

#### Scenario: No fan-out names the index

- **WHEN** the fan-out functions are reviewed after the rebuild
- **THEN** none SHALL contain `on conflict (…)`, `on constraint` or the index's name
- **AND** this SHALL be checked by reading `prosrc` rather than inferred from the migration files,
  because a function may have been replaced since the file that created it

#### Scenario: Two replies in different threads of the same club both notify

- **WHEN** one rider replies in two different threads of the same club, both authored by the same
  recipient
- **THEN** two `club_thread_replied` rows SHALL exist
- **AND** this SHALL be asserted directly, because it is the exact case the seven-column key swallows
  and the case no error would ever report

### Requirement: A tap on either new notification SHALL open the thread, and SHALL open nothing when the thread is unreadable

The destination for both types SHALL be `routes.clubThread(thread.id)` — the thread itself, not its
club and not the club's thread list. Neither type SHALL draw a trailing thumbnail.

#### Scenario: The row opens the conversation it names

- **WHEN** a `club_thread_replied` or `club_thread_waved` row is rendered
- **THEN** its link SHALL resolve to the thread screen for that thread
- **AND** it SHALL NOT resolve to the club, because the rider was told about a conversation and the
  club's thread list does not say which one

#### Scenario: An unresolvable thread yields an unlinked row rather than a dead link

- **WHEN** the thread does not resolve for the reader
- **THEN** the row SHALL render unlinked
- **AND** this branch SHALL be understood as the floor rather than a live state, because the SELECT
  policy withholds the whole row in exactly that case — the same predicate resolves the embed and the
  conjunct

#### Scenario: The thread's title is read live and degrades rather than throwing

- **WHEN** the thread embed returns nothing for a row that was returned
- **THEN** the copy SHALL fall back to a generic phrase naming no thread
- **AND** no title, club name or message body SHALL ever be stored on the notification row

## MODIFIED Requirements

### Requirement: A notification SHALL be dropped by the database when its subject is no longer visible to its recipient, not filtered by a screen

The SELECT policy SHALL require, in addition to `user_id = auth.uid()`, that **every** resource the
row's copy renders is still returned to the caller under the caller's **own** row security —
expressed as an `EXISTS` per resource, evaluated under the caller's RLS, and **conjoined** where a
type renders more than one.

The conjunct set is fixed per type and stated here rather than derived:

| Type | Subject columns | `EXISTS` conjuncts, all required |
|---|---|---|
| *(every type)* | `actor_id` | `profiles` |
| `postcard_liked` | `postcard_id` | `postcards` |
| `postcard_commented` | `postcard_id`, `comment_id` | `postcards` **AND** `postcard_comments` |
| `ride_joined` | `ride_id` | `rides` |
| `club_joined` | `club_id` | `clubs` |
| `ride_created_in_club` | `ride_id`, `club_id` | `rides` **AND** `clubs` |
| **`club_thread_replied`** | **`thread_id`** | **`club_threads`** |
| **`club_thread_waved`** | **`thread_id`** | **`club_threads`** |

**The two new types add a `thread_id` conjunct and nothing else.** They render the thread's title and
open the thread; they name no club, so they set no `club_id` and take no club conjunct. Carrying a
club would be a conjunct with no rendered resource behind it, and would put a weaker resolvability
test beside a stronger one — inviting a later reader to simplify the strong one away.

**The new conjunct can only narrow, and that is a derivation from the live policy text rather than a
hope.** `club_threads` SELECT requires `private.is_club_member(club_id)` and `clubs` SELECT admits
every member, so **thread-resolves implies club-resolves**. The derivation SHALL be re-run whenever
either policy changes rather than recalled.

The UPDATE policy's predicate SHALL remain **identical** to the SELECT policy's, in both `using` and
`with check`, with the same conjunct added in the same place. A wider UPDATE policy lets
`update … set read_at = now() where read_at is null` touch rows the rider cannot see, and the
affected-row count PostgREST reports is the count of hidden rows — a marker for a block, which this
spec elsewhere requires never be disclosed.

**No type-scoped disjunct is added.** `089` and `093` each added one because their recipients are by
construction riders who cannot read the subject club. Neither new type has that property: the
recipient is the thread's author, who held a membership when they wrote it. The two existing
disjuncts SHALL be preserved verbatim in the re-created policies.

#### Scenario: A rider who left the club stops reading their own thread's notifications

- **WHEN** the author of a thread leaves the club and then reads their notifications
- **THEN** every `club_thread_replied` and `club_thread_waved` row for that thread SHALL stop being
  returned, and the unread count SHALL fall by the same number in the same instant
- **AND** authoring the thread SHALL NOT be enough to keep it, because `club_threads` SELECT's
  own-row arm sits **inside** its block conjunct and the `private.is_club_member` conjunct dominates
  it — which SHALL be asserted rather than assumed, since the opposite reading is the natural one
- **AND** nothing SHALL delete the rows, so rejoining SHALL return them with their original
  `created_at` and read state

#### Scenario: A rider blocked with the thread's author loses the row by a different mechanism

- **WHEN** the recipient is blocked with the thread's author in either direction
- **THEN** the row SHALL stop being returned by the `club_threads` conjunct
- **AND** this SHALL be asserted separately from the actor block, because the two are different
  mechanisms and one assertion cannot say which fired
- **AND** the case where recipient and thread author are the same rider SHALL be unaffected, because
  `blocks_no_self_block` makes `is_blocked(x, x)` false

#### Scenario: A private club discloses no more than it already did

- **WHEN** any rider holds a notification for a thread in a private club
- **THEN** the row SHALL be returned only while `club_threads` resolves for them, which requires
  membership
- **AND** the club's name, the thread's title and the message body SHALL never reach a
  non-member's device
- **AND** the row's `thread_id` reaching their device in an earlier response SHALL disclose nothing,
  because every read of that id is refused

#### Scenario: The thread conjunct is not simplified away

- **WHEN** the SELECT policy is reviewed, refactored or replaced
- **THEN** the `thread_id` `EXISTS` SHALL remain and SHALL carry a policy comment saying why
- **AND** removing it SHALL fail at least two assertions rather than passing quietly

### Requirement: A notification SHALL die with its subject, its actor, its recipient and its club

Every foreign key on `notifications` SHALL be `ON DELETE CASCADE`, including the new
`thread_id → club_threads`. A notification whose subject, actor or recipient no longer exists SHALL
NOT survive as a tombstone.

#### Scenario: Deleting the thread destroys its notifications

- **WHEN** a thread's author deletes their own thread
- **THEN** every `club_thread_replied` and `club_thread_waved` row naming it SHALL be removed

#### Scenario: Moderating a thread destroys its notifications

- **WHEN** a club admin calls `public.moderate_club_thread`, or an operator calls
  `private.remove_reported_thread`
- **THEN** every notification naming that thread SHALL be removed by the same cascade
- **AND** `private.remove_reported_thread`'s own body currently states that `notifications` *"has no
  `thread_id` column and is not in the chain"*, which this change makes false — the claim SHALL be
  corrected in the function's external comment and the in-body edit filed separately, because
  `create or replace` on a `security definer` moderation function is outside this change's blast
  radius

#### Scenario: Deleting the club destroys them too, through the thread

- **WHEN** a club is deleted
- **THEN** its threads SHALL cascade and every notification naming one of them SHALL go with them
- **AND** this SHALL hold without `notifications.club_id` being set on either new type

#### Scenario: A departing rider's thread notifications go in both directions

- **WHEN** a rider deletes their account
- **THEN** every `club_thread_replied` and `club_thread_waved` row **to** them SHALL be removed by
  the `user_id` cascade, and every row naming them as actor SHALL be removed from every other rider's
  list by the `actor_id` cascade
- **AND** a rider who authored threads SHALL take those threads' notifications with them, through
  `club_threads.author_id → profiles ON DELETE CASCADE`

### Requirement: Every cascade path into `notifications` SHALL be indexed

Each foreign key on `notifications` SHALL have an index Postgres can use to find the referencing
rows, so that every delete reaching this table is an index scan rather than a sequential scan holding
locks. With `thread_id` there are **seven** FK columns and there SHALL be **seven** usable indexes.

`thread_id`'s index SHALL be **partial** — `where thread_id is not null` — matching the four existing
subject indexes, because every row of the fourteen existing types leaves it NULL and a partial index
enters only the rows that use it.

#### Scenario: The seventh FK gets the seventh index

- **WHEN** the migration is written
- **THEN** `notifications_thread_id_idx` SHALL exist, leading with `thread_id` and partial on it
  being non-NULL
- **AND** its position last in `notifications_event_key` SHALL NOT be offered as covering it, because
  a non-leading column cannot serve the lookup

#### Scenario: The check is derived, not remembered

- **WHEN** the index set is verified after apply
- **THEN** it SHALL be derived by querying `pg_index` for FK columns lacking a leading-column index
- **AND** the count SHALL be **seven FK columns, seven usable indexes**, verified against the live
  database rather than asserted from the file

#### Scenario: The write cost per row does not grow for existing types

- **WHEN** a row of any pre-existing type is written after this change
- **THEN** it SHALL maintain the same indexes it did before — the primary key, the uniqueness index,
  the list index, the `actor_id` index and only those partial subject indexes whose column is
  non-NULL on the row
- **AND** `notifications_thread_id_idx` SHALL take no entry for it, because the index is partial
