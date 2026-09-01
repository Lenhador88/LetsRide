## ADDED Requirements

### Requirement: A thread MAY carry a marker naming the membership it introduces, and that marker SHALL be unwritable by any client

`club_threads` gains two columns: a nullable marker naming the membership a thread introduces, and
the introduction text itself. Both SHALL be readable by everybody who can read the thread and
writable by **no client role at all** — no INSERT grant, no UPDATE grant, no policy. The only
writer SHALL be the introduction function.

This is `044`/`046`'s rule applied to two new columns: a column the server owns SHALL NOT be
writable by a client that can insert the row. A client can still insert an ordinary thread with a
title, exactly as before, and the two new columns are simply not in its grant.

#### Scenario: A client cannot mark a thread as an introduction
- **WHEN** a rider inserts a thread naming the marker column
- **THEN** the write SHALL be refused for lack of a column grant
- **AND** the refusal SHALL NOT depend on any policy predicate

#### Scenario: A client cannot mark somebody else's thread
- **WHEN** a rider attempts to update any thread's marker
- **THEN** the write SHALL be refused, `club_threads` having no UPDATE grant and no UPDATE policy
  for anyone

#### Scenario: Reading the marker needs the same grant as reading the thread
- **WHEN** a member reads a thread
- **THEN** the marker and the introduction text SHALL be readable in the same query
- **AND** a read naming them SHALL NOT fail for a rider who can read the thread's other columns

### Requirement: An introduction SHALL be immutable, exactly as a title and a message body already are

The introduction text SHALL NOT be editable by its author, by a club admin, by the club's owner, or
by any function. A rider who wants a different introduction SHALL delete the thread and write
another.

This adds no new rule: `club_threads` has no UPDATE grant and no UPDATE policy for anyone, and this
change adds neither.

#### Scenario: Nobody can edit an introduction
- **WHEN** any role attempts to update the introduction text
- **THEN** the write SHALL be refused
- **AND** no `security definer` function SHALL offer an edit

### Requirement: The existing delete and moderate paths SHALL reach an introduction unchanged

An introduction SHALL be deletable by its author under the existing thread DELETE policy, and by
anyone who administers the club under the existing moderation function. Neither SHALL be widened,
narrowed or special-cased for an introduction, and no new authority SHALL be introduced.

Deleting an introduction's thread SHALL delete its comments by the existing cascade, exactly as for
any other thread.

#### Scenario: The author's delete works on their own introduction
- **WHEN** the subject deletes their introduction's thread
- **THEN** it SHALL be deleted, with its comments, by the existing policy and cascade

#### Scenario: The owner's and admins' moderation works on an introduction
- **WHEN** an owner or admin takes down an introduction's thread
- **THEN** the existing moderation function SHALL delete it, with no new argument and no new check

#### Scenario: An introduction is reportable exactly as any thread is
- **WHEN** a member who can read an introduction reports it
- **THEN** it SHALL be accepted by the existing report path
- **AND** nobody inside the club SHALL be able to read that report

### Requirement: A comment on an introduction SHALL be an ordinary message, and every message in an introduction's thread SHALL be a comment

An introduction's text SHALL NOT be stored as a message. Every `club_messages` row in an
introduction's thread is therefore a comment on it, which is what makes the count beside the join
row exact without arithmetic.

The message policies SHALL be unchanged: a member may post, a rider reads a message unless they and
its author have blocked each other, nobody may edit one, and a rider erases their own through the
existing function.

#### Scenario: The count needs no adjustment
- **WHEN** an introduction has been posted and nobody has replied
- **THEN** its thread SHALL hold zero messages
- **AND** its comment count SHALL be zero

#### Scenario: A blocked pair still talk past each other
- **WHEN** two riders who have blocked each other both comment on the same introduction
- **THEN** each SHALL see their own comment and not the other's
- **AND** neither SHALL be told that the other commented
</content>
