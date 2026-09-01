## Purpose

A rider joining a club may post one introduction — words of their own, attached to their
membership — and the club's join announcement becomes the door to it. This capability owns what an
introduction is, who may write, read, count, comment on, delete or moderate one, and what the join
row shows in every state an introduction can be in, including never written.

## ADDED Requirements

### Requirement: An introduction SHALL be a thread the rider authored, and SHALL inherit that thread's audience

An introduction SHALL be a `club_threads` row whose author is the introducing rider, carrying a
marker naming the membership it introduces and the introduction text itself. It SHALL NOT be a
separate table, and no policy on it SHALL restate club visibility, membership, role or the block
predicate — `club_threads`' own SELECT policy already carries all four, and a second copy is the
drift `009` and `081` both refuse.

A rider who can read the thread can read the introduction; a rider who cannot, cannot. There SHALL
be no arm, helper, view or RPC that returns an introduction to a rider who cannot read its thread.

#### Scenario: Reading an introduction requires reading its thread
- **WHEN** any rider reads an introduction, by any path
- **THEN** the rows SHALL be returned by `club_threads`' existing SELECT policy and by nothing else
- **AND** no `security definer` function SHALL return introduction text

#### Scenario: The marker and the text are not separately audienced
- **WHEN** a rider can read a thread
- **THEN** they SHALL be able to read both its marker and its introduction text
- **AND** no column-level grant SHALL make one readable and the other not

### Requirement: Every role's reach into an introduction SHALL be stated, including the negative cases

Stated per role, for a club and a rider who has introduced themselves in it. Each line is a
testable statement about a role and a resource and SHALL map onto an assertion in
`supabase/tests/rls_test.sql`.

**May read the introduction and its comment count:**

- The club's **owner** — through `private.is_club_member`'s owner arm (`054`).
- A club **admin** — as a member; `admin` grants no extra reach here and SHALL NOT.
- Any **member** of the club, public or private.
- The **subject** themselves, who is a member by definition.

**May NOT read it — and each of these is a case this change is written to get right:**

- A **non-member of a PUBLIC club**. They can read that club's roster and therefore see the join
  announcement, and they SHALL read **zero** threads, **zero** messages and therefore a comment
  count of zero. They SHALL NOT be shown a count derived from anything but their own readable rows.
- A **non-member of a PRIVATE club**, who reads neither the roster nor the thread, and whose
  reduced preview screen SHALL gain no read from this change.
- A rider the **subject has blocked**, and a rider **who has blocked the subject** — symmetrically,
  because `081`'s block arm is on the thread's author.
- A **former member**, from the moment their `club_members` row is deleted.
- A **pending invitee** and a rider with a **pending join request**. Neither is a member; a pending
  invite grants nothing at all (`093`) and neither does a request (`085`).
- The holder of a live **club invite link token**. A token buys exactly `club_invite_link_preview`
  and `claim_club_invite_link` and no policy reach; the preview SHALL NOT gain an introduction.
- A **signed-out visitor**, who reaches the shell and no data. `anon` holds zero grants and this
  change adds none.

**May write an introduction:** the subject alone, for their own membership, once.

**May NOT write one:** everybody else, including the club's owner and its admins. There SHALL be no
path by which any rider marks another rider's thread as that rider's introduction.

#### Scenario: A non-member of a public club sees the join row and no introduction
- **WHEN** a signed-in rider who is not a member opens a public club
- **THEN** they SHALL read the roster
- **AND** they SHALL read zero threads and zero messages for that club
- **AND** no join row SHALL display a comment count, a comment icon or a link to a thread

#### Scenario: An admin gains no reach an ordinary member lacks
- **WHEN** a club admin reads an introduction
- **THEN** they SHALL read exactly what any member reads
- **AND** no policy arm SHALL name `role` for the purpose of reading an introduction

#### Scenario: A rider cannot introduce another rider
- **WHEN** any rider attempts to set the introduction marker on a thread, directly or through any
  function, for a membership that is not their own
- **THEN** the write SHALL be refused
- **AND** the refusal SHALL be by grant or policy, not by application filtering

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request arrives with no session
- **THEN** it SHALL read no introduction, no marker and no count
- **AND** no grant SHALL be added to `anon` by this change

### Requirement: An introduction SHALL be written in ONE statement, and the membership SHALL already exist

The membership SHALL exist before the introduction is written, because thread creation requires it.
The introduction itself — its marker, its text and its thread — SHALL be written by a single
statement, so that no state exists in which a thread is marked as an introduction but holds no
text, or holds text and is not marked.

The writing function SHALL take a **club** and the text, and SHALL NOT take a rider id; the subject
SHALL be read from the session and from nowhere else.

#### Scenario: A partial introduction is unreachable
- **WHEN** the write fails for any reason
- **THEN** no thread SHALL exist carrying a marker with no text
- **AND** no thread SHALL exist carrying introduction text with no marker at the moment of writing

#### Scenario: The subject is never an argument
- **WHEN** any caller invokes the writing function
- **THEN** its parameters SHALL name a club and the text and nothing that identifies a rider
- **AND** a caller SHALL NOT be able to write an introduction on behalf of anybody

#### Scenario: A non-member is refused
- **WHEN** a rider who is not a member of the club calls the writing function
- **THEN** it SHALL refuse
- **AND** it SHALL raise the same error, with the same message and the same SQLSTATE, as it raises
  for a club that does not exist, so that it is not an oracle for private clubs

### Requirement: An introduction SHALL be a participation-gated content write, and the gate SHALL be restated where the trigger cannot run

Writing an introduction SHALL be refused for a rider whose consent stamp is NULL, exactly as every
other content write in this app is.

Because the write runs inside a `security definer` body, `current_user` is the function's owner and
the `enforce_participation_gate` trigger on `club_threads` — which carries
`when (current_user = 'authenticated')` — SHALL NOT fire for it. The gate SHALL therefore be
restated inside the function against the calling rider. Adding a further trigger SHALL NOT be
treated as coverage: it would raise the trigger count while gating nothing, which is the defect
`078.9` exists to assert against.

#### Scenario: An un-onboarded rider cannot introduce themselves
- **WHEN** a rider with `terms_accepted_at` NULL calls the writing function
- **THEN** it SHALL refuse
- **AND** no `club_threads` row SHALL be written

#### Scenario: The gate count does not move
- **WHEN** this change is applied
- **THEN** the number of `enforce_participation_gate` triggers SHALL be unchanged, because no
  table is added
- **AND** the gate's coverage SHALL be claimed as "restated in the function", never as a trigger

### Requirement: The introduction's bounds SHALL be enforced by the database

The introduction text SHALL be non-blank and SHALL be at most 1000 characters, enforced by a CHECK
constraint. A validation schema in the client MAY carry the same bounds for the message and the
live counter, and SHALL NOT be the only place either bound exists — the client owns the mutation
path, so a rule that reaches only a schema is a suggestion a rider can decline.

The bound SHALL match `club_messages.body`'s, so an introduction cannot be longer than any reply to
it.

#### Scenario: A blank introduction is refused by the database
- **WHEN** a write supplies whitespace only, bypassing the client entirely
- **THEN** the database SHALL refuse it with a check-constraint violation

#### Scenario: An over-long introduction is refused by the database
- **WHEN** a write supplies more than 1000 characters, bypassing the client entirely
- **THEN** the database SHALL refuse it with a check-constraint violation

### Requirement: A rider SHALL have at most one introduction per club, and a rejoin SHALL start with none

Uniqueness SHALL be enforced by the database, keyed on the club and the subject, so a second
introduction is refused rather than merely not offered.

The marker SHALL key to the **membership** — the club and the rider together — and not to the rider
alone, so that leaving and rejoining does not inherit the old introduction. A rejoined rider SHALL
be indistinguishable from a first-time joiner, which is what `club-timeline` already requires of
the join entry itself and of its waves.

#### Scenario: A second introduction is refused
- **WHEN** a rider who has already introduced themselves in a club attempts another
- **THEN** the write SHALL be refused by a uniqueness constraint
- **AND** the client SHALL NOT offer the prompt to a rider who already has one

#### Scenario: A rejoin does not inherit an introduction
- **WHEN** a rider leaves a club in which they had introduced themselves and later rejoins
- **THEN** their new join entry SHALL carry no introduction and no comment count
- **AND** they SHALL be prompted for a new one

### Requirement: Leaving a club SHALL detach the introduction and SHALL destroy nothing

When the membership is deleted, the marker SHALL be cleared and the thread SHALL survive, carrying
its text and every comment other riders wrote in it. The leave SHALL succeed.

The introduction SHALL NOT cascade with the membership. A wave cascades because it decorates an
event; an introduction is words, and words other riders wrote in reply are theirs. Deleting them
because their subject left is the defect `add-club-threads` §*Leaving a club SHALL remove the whole
conversation from the leaver, and SHALL remove nothing from anybody else* already forbids.

**No constraint SHALL be able to refuse the leave.** This SHALL be asserted by a rider who *has* an
introduction leaving a club; a leave by a rider without one passes under every incorrect shape and
proves nothing.

#### Scenario: A rider with an introduction can leave
- **WHEN** a rider who has introduced themselves leaves the club
- **THEN** the delete SHALL succeed
- **AND** the thread SHALL still exist, with its text and its comments intact
- **AND** its marker SHALL be NULL

#### Scenario: The leaver loses the conversation and nobody else does
- **WHEN** that rider is no longer a member
- **THEN** they SHALL read none of that club's threads, including the one that was their own
  introduction
- **AND** every remaining member SHALL read it unchanged

### Requirement: Deleting or moderating an introduction SHALL leave a join row with no door, and that SHALL be a designed state

An introduction SHALL be deletable by its author, and by anyone who administers the club, through
exactly the paths that already exist for a thread — no new verb, no new authority, no new
notification.

When the introduction is gone, the join announcement SHALL revert to a row with a sentence, a time
and a wave, carrying no comment icon, no count and no thread link. This SHALL be indistinguishable
from a rider who never wrote one, and that is deliberate: distinguishing them would tell the club
that something was removed and, in a small club, who removed it.

#### Scenario: The author deletes their own introduction
- **WHEN** the subject deletes the thread
- **THEN** it and its comments SHALL be deleted, exactly as for any other thread they authored
- **AND** their join row SHALL render with no count and no link

#### Scenario: An admin moderates an introduction
- **WHEN** an owner or admin takes the thread down through the existing moderation path
- **THEN** the outcome SHALL be identical to the author's own deletion from every reader's view
- **AND** the subject SHALL NOT be notified, because nothing in this app notifies on a moderation

#### Scenario: Removed and never written look the same
- **WHEN** a member views a join row with no introduction
- **THEN** the row SHALL NOT indicate whether one ever existed

### Requirement: The comment count SHALL be computed under row security, SHALL NOT be stored, and SHALL NOT be treated as a fact about the club

The number beside the comment icon SHALL be an aggregate over the rows row security returns to
**that viewer**, and SHALL NOT be a stored column, a counter, a trigger-maintained total or a
`security definer` read.

Three consequences follow and SHALL be treated as designed behaviour:

- Two members of one club MAY see different numbers on the same introduction and neither SHALL be
  told why, because a blocked rider's comments are filtered by the message policy.
- A rider who can read no message of the thread SHALL see the count as absent, not as `0 comments`.
- A count SHALL never confirm that a conversation exists to somebody who may not read it.

Three uses are forbidden, transferred verbatim from the wave count they sit beside:

- it SHALL NOT order, rank or sort any list;
- it SHALL NOT provide a cursor or a page boundary;
- it SHALL NOT feed a threshold, badge or label implying a shared judgement.

#### Scenario: A stored count is forbidden
- **WHEN** this change is applied
- **THEN** no column, trigger or materialised total SHALL hold a comment count for any thread
- **AND** the count SHALL be re-derived per viewer on every read

#### Scenario: A blocked rider's comments are uncounted as well as unseen
- **WHEN** a member has blocked a rider who commented on an introduction
- **THEN** that comment SHALL be absent from their view **and** absent from their count
- **AND** the blocked rider's own view SHALL still count their own comment

#### Scenario: Nothing sorts by the count
- **WHEN** any list containing introductions or threads is ordered
- **THEN** the order SHALL be by time and SHALL NOT consider any count

### Requirement: The prompt SHALL be driven by the ABSENCE of an introduction, not by the join action

A rider SHALL be prompted for an introduction when, and only when, all of the following hold: they
hold a membership of the club; their role is not `owner`; the club is not the default club; and no
introduction exists for that membership.

This rule SHALL be evaluated from state the screen reads for itself, so that it holds for **every**
way a membership comes into existence — the Join button, creating a club, onboarding's auto-join,
an admin approving a request, accepting an invite, and claiming an invite link. A prompt attached
to one write path SHALL be treated as incomplete.

**The prompt SHALL NOT appear during onboarding.** The default club is joined by every rider inside
a wizard that has no skip affordance, and a prompt there would be the first thing a new rider is
asked and the one they least understand.

**A club's owner SHALL NOT be prompted**, because a club's owner is a member of it and introducing
yourself to a club you founded expresses nothing.

#### Scenario: Every door reaches the same rule
- **WHEN** a membership is created by any of the six paths
- **THEN** the rider SHALL be prompted on the club's own screen if and only if the rule above holds
- **AND** no path SHALL be special-cased to prompt or to suppress

#### Scenario: Onboarding is never interrupted
- **WHEN** a rider completes onboarding and is auto-joined to the default club
- **THEN** no introduction prompt SHALL appear at any point in the wizard
- **AND** none SHALL appear on the default club afterwards

#### Scenario: The founder is not asked
- **WHEN** a rider creates a club
- **THEN** they SHALL NOT be prompted to introduce themselves to it

### Requirement: A rider who joins and writes no introduction SHALL be a first-class state

"Joined, no introduction" SHALL exist by construction and SHALL be rendered as an ordinary join
row — the sentence, the time and the wave — with no comment affordance, no placeholder and no
appeal to write one. It SHALL arise from a dismissal, a failed write, a closed tab, a lost
connection, any of the doors that do not prompt, and every membership that predates this change.

No migration SHALL backfill an introduction, and none is needed.

#### Scenario: An existing membership needs no backfill
- **WHEN** this change is applied to a database holding memberships
- **THEN** every existing join row SHALL render exactly as it did before, plus nothing
- **AND** no row SHALL be written by the migration

#### Scenario: A failed introduction leaves a joined rider
- **WHEN** the introduction write fails after the membership was created
- **THEN** the rider SHALL still be a member
- **AND** the failure SHALL be shown as a failure of the introduction, never of the join

### Requirement: The join announcement SHALL carry three distinct targets, and the overflow menu SHALL be removed

The join row SHALL keep its current sentence. Its targets SHALL be:

- the **avatar** — the subject's profile;
- the **row and the comment count** — the introduction's thread, when one exists and the viewer can
  read it;
- the **wave** — the wave, unchanged from `092`, including its absence on the viewer's own row.

The **⋯ overflow SHALL be removed**, together with its one item. No entrance is lost by that
removal: the thread composer keeps its entrances on the create bar and the club's own menu.

Where no introduction exists, or the viewer cannot read it, the row SHALL have **no** thread target
at all rather than a disabled or empty one — a tap that cannot succeed SHALL NOT be drawn.

#### Scenario: Three targets, three destinations
- **WHEN** a member views a join row whose subject has introduced themselves
- **THEN** tapping the avatar SHALL open the subject's profile
- **AND** tapping the row or the count SHALL open the introduction's thread
- **AND** tapping the wave SHALL toggle the wave and SHALL NOT navigate

#### Scenario: The wave survives the redesign
- **WHEN** any join row is drawn after this change
- **THEN** the wave control SHALL be present under exactly the rules `092` set, its own-row absence
  included

#### Scenario: No door where there is nothing behind it
- **WHEN** a viewer cannot read the introduction, or none exists
- **THEN** the row SHALL draw no comment icon and no count
- **AND** the row SHALL NOT be a link to a thread

### Requirement: The introduction text SHALL be rendered on its thread, and the render SHALL key off the TEXT rather than the marker

The introduction is the first thing a reader of the thread sees — above the comments, attributed to
its author, and present whether or not anybody has commented. A thread carrying an introduction
SHALL NOT render as an empty thread with a title and nothing in it.

**The render SHALL be driven by the presence of the text, not by the presence of the marker.** The
two come apart permanently the moment the subject leaves the club: the marker is nulled by the
foreign key and the text survives. Keying the render off the marker would make every ex-member's
introduction — and every comment written under it — silently vanish from a thread that still
exists, which is the exact loss the SET NULL was chosen to prevent.

**The author's name SHALL come from the thread's author**, which is the introducing rider by
construction and remains correct after they leave. It SHALL NOT be derived from the marker: the
marker is a key into the membership, not into the rider's profile.

**The empty-thread state is narrowed, not removed.** A thread with no introduction and no messages
still draws the existing empty-thread line; a thread with an introduction and no comments draws the
introduction and an invitation to reply.

#### Scenario: A posted introduction is visible to a reader of its thread
- **WHEN** a member opens an introduction's thread
- **THEN** the introduction text SHALL be rendered, attributed to its author
- **AND** it SHALL be rendered before any comment

#### Scenario: A brand-new introduction does not read as an empty thread
- **WHEN** an introduction has been posted and nobody has commented
- **THEN** the thread SHALL show the introduction
- **AND** it SHALL NOT show the "nothing here yet" state that a thread with no messages shows

#### Scenario: An ex-member's introduction still renders
- **WHEN** the subject has left the club, so the marker is NULL and the text remains
- **THEN** the thread SHALL still render the introduction and every comment under it
- **AND** the author SHALL still be named

### Requirement: Introductions SHALL be distinguishable from one another wherever threads are listed

Every introduction carries the same constant title, so a club with several of them shows several
identically-titled rows on the Threads list and on the timeline's thread entries. Each such row
SHALL carry, in its secondary line, something that tells them apart — the author's name being the
obvious and correct choice, since it is what the row is about.

This SHALL hold after the subject leaves the club, so the distinguishing value SHALL be derived
from the thread's author and SHALL NOT be derived from the marker.

#### Scenario: Two introductions in one club are told apart
- **WHEN** a club holds introductions from two riders
- **THEN** their rows on any list of threads SHALL differ from each other in what they display
- **AND** the difference SHALL name the rider, not a position or a date alone

#### Scenario: The distinction survives a leave
- **WHEN** one of those riders leaves the club
- **THEN** their introduction's row SHALL still be distinguishable from the other's

### Requirement: This change SHALL add no fan-out, and an introduction SHALL be notified on the same terms as every other club thread

This change SHALL add no notification type and no fan-out trigger. Comments and waves on club
threads **are** to be notified — decided 2026-09-01 — and that is a separate change covering every
club thread rather than introductions alone.

An introduction SHALL therefore gain **no** notification behaviour of its own, then or later: when
the fan-out arrives it SHALL treat an introduction as an ordinary thread. A rule that notifies
replies to an introduction and not replies to the thread beside it would be a two-tier visibility
decision that no rider can see the reason for.

Until that change lands, a rider who introduces themselves and receives comments is told nothing —
which is how every club thread behaves today, and SHALL be recorded as a scheduled gap naming its
successor rather than as a property of introductions.

#### Scenario: No new notification type in this change
- **WHEN** this change is applied
- **THEN** the set of notification types SHALL be unchanged
- **AND** no trigger SHALL be hung on `club_messages` or on any wave table

#### Scenario: Writing an introduction notifies exactly what joining already notified
- **WHEN** a rider joins and introduces themselves
- **THEN** the notifications written SHALL be exactly those the join already produced
- **AND** the introduction SHALL add none

#### Scenario: The successor treats an introduction as an ordinary thread
- **WHEN** the club-thread fan-out is added by its own change
- **THEN** a comment on an introduction SHALL notify on exactly the terms a comment on any other
  thread does
- **AND** no branch SHALL test whether the thread is an introduction
