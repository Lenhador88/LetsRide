# club-ownership-succession (delta)

## ADDED Requirements

### Requirement: An owner SHALL be able to leave their club, under exactly three arms

The app SHALL offer a club's owner a way out, and the outcome SHALL be one of exactly three, decided
by the database from the club's true roster:

1. **At least one other admin** — a `club_members` row with `role = 'admin'` whose `user_id` is not
   `clubs.owner_id`. The owner leaves and **ownership transfers** to the longest-standing such admin.
2. **No other rider on the roster at all.** The owner leaves and **the club is deleted**, behind the
   existing deletion confirmation.
3. **Otherwise** — riders remain but none is an admin. The leave is **refused**, and the rider is told
   the remedy: promote another rider to admin first.

Product owner, 2026-08-31: *"an owner can only leave a club if there is at least one more admin
associated with it, or if it has no members."* The empty case was decided in the same conversation:
delete it, with a confirmation.

Today the owner has no exit that is not destructive. `ClubOptionsMenu` renders `Leave club` only in
its non-owner branch, and the owner's only route out is `Delete club`, which takes every other
member's postcards with it.

#### Scenario: The owner leaves a club that has another admin
- **WHEN** the owner of a club holding at least one other `admin` chooses to leave and confirms
- **THEN** they SHALL no longer be the club's owner and SHALL hold no membership of it
- **AND** the longest-standing other admin SHALL be its owner, by `joined_at` ascending and tie-broken
  by `user_id`
- **AND** the club, its rides, its postcards, its threads and its remaining roster SHALL be unchanged

#### Scenario: The owner leaves a club nobody else is in
- **WHEN** the owner of a club with no other roster row chooses to leave
- **THEN** they SHALL be shown the existing club-deletion confirmation, worded for this case, before
  anything is destroyed
- **AND** confirming SHALL delete the club through the existing deletion path
- **AND** cancelling SHALL leave them the owner, in the club, with nothing changed

#### Scenario: The owner is refused when only members remain
- **WHEN** the owner of a club holding other riders, none at `role = 'admin'`, chooses to leave
- **THEN** the app SHALL refuse, SHALL delete nothing and SHALL transfer nothing
- **AND** the message SHALL name the remedy — promote another rider to admin — and the rider SHALL be
  able to reach the manage-riders screen from where they are

#### Scenario: The refusal message is one string for two different states
- **WHEN** the leave is refused
- **THEN** the same message SHALL be shown whether the club holds no riders the owner can see or
  holds riders it has no admin among
- **AND** it SHALL NOT be split into two clearer messages, because the two states differ by exactly
  what a block hides, and telling them apart would tell an owner that a rider they cannot see is in
  their club

### Requirement: No action a rider takes as leaving SHALL destroy a club without a confirmation that counts what it destroys

Leaving and deleting SHALL be separate operations. A rider who chose to leave SHALL never find that
they deleted a club instead, whatever the app believed about the roster when it drew the control.

The client decides which affordance to draw from a member count that is cached and read under the
viewer's own row security, so it can be stale and is always a floor. An operation that could both
transfer and delete would turn a minute-old count into a destroyed club.

#### Scenario: A stale roster count cannot destroy a club
- **WHEN** the app believes the club has other members, the last of them has since left, and the rider
  taps leave
- **THEN** the club SHALL still exist afterwards unless the rider was shown the deletion confirmation
  and confirmed it
- **AND** the refusal SHALL be what opens that confirmation, so the mistake self-corrects into a
  decision rather than into an error

#### Scenario: The deletion confirmation is the existing one
- **WHEN** a deletion is reached by way of leaving
- **THEN** it SHALL show the same counts, phrased as the same floors, as the deletion reached from the
  club menu
- **AND** those counts SHALL cover postcards, rides and members, and SHALL NOT be replaced by a
  sentence about being the only rider

#### Scenario: An empty roster does not mean nothing is at stake
- **WHEN** the club holds no other members but holds postcards written by riders who have since left
- **THEN** the confirmation SHALL still report them
- **AND** the copy SHALL NOT state or imply that only the leaving rider's own content is affected

### Requirement: The rider SHALL be told what leaving costs them, and SHALL NOT be told who inherits

The confirmation for a transfer SHALL state the rule — that another admin takes the club on — and
SHALL NOT name the successor.

Naming them needs a read that returns nothing for an admin the owner has blocked, and the privileged
alternative would disclose a rider blocking exists to hide. The rule is what the departing rider
actually needs to know.

#### Scenario: The transfer confirmation names no rider
- **WHEN** the owner is asked to confirm leaving a club that will transfer
- **THEN** the copy SHALL describe the outcome without naming any rider
- **AND** it SHALL read identically whether or not the successor is someone the owner has blocked

#### Scenario: The rider is told what they lose
- **WHEN** the confirmation is shown
- **THEN** it SHALL be honest that a private club becomes unreadable to them afterwards, including
  postcards and threads they wrote themselves
- **AND** it SHALL be honest that the club's avatar and cover are cleared by the transfer

### Requirement: The default club SHALL offer its owner no way out

The club carrying `clubs.is_default` SHALL not offer leaving, and any attempt SHALL be refused with a
message saying why.

Every rider joins that club on completing onboarding, so it always has members. Allowing a leave
would hand the club everyone is in to an arbitrary admin in one tap — a gap `059` could only leave
open for the account-deletion path, where the alternative was destroying the club and every postcard
in it.

#### Scenario: The welcome club's owner is refused
- **WHEN** the owner of the club carrying `is_default` attempts to leave, by the control or by a
  direct call
- **THEN** it SHALL be refused, whether or not the club has another admin
- **AND** the message MAY say that this club cannot be left, because that column is readable and
  nothing is disclosed by saying so

### Requirement: Every state of the leave affordance SHALL be specified

The control SHALL have a defined appearance and behaviour in each of the seven states below. A state
left unspecified becomes whatever the component author assumed.

#### Scenario: Empty
- **WHEN** the club has no roster row other than the owner's
- **THEN** the control SHALL still be offered, and SHALL open the deletion confirmation rather than
  performing a leave
- **AND** "empty" SHALL be read as *nothing to hand the club to*, never as an error or a broken screen

#### Scenario: Loading
- **WHEN** the menu is opened before the roster information it needs has arrived
- **THEN** the control SHALL render, and the screen SHALL gate on the **data** rather than on a
  loading flag
- **AND** if the app cannot yet tell which arm applies, it SHALL offer the leave and let the database
  answer, rather than hiding the control or guessing the destructive arm

#### Scenario: Error
- **WHEN** the operation fails for any reason other than the two designed refusals
- **THEN** the rider SHALL see one message and SHALL remain the club's owner, in the club
- **AND** the control SHALL remain available so the action can be retried
- **AND** the refusals SHALL be distinguishable from a transport failure, so a network error is never
  reported as "this club has no other admin"

#### Scenario: Offline
- **WHEN** the rider is offline
- **THEN** the control SHALL be disabled with a line saying why, the way the deletion control already
  is
- **AND** nothing SHALL be queued for later: a transfer decided against a roster that may have changed
  is not a write to replay

#### Scenario: Permission denied
- **WHEN** the caller is not the club's owner — including an admin, a member, a non-member and a rider
  whose ownership moved in another session moments earlier
- **THEN** the refusal SHALL be indistinguishable from "no such club", so nothing is learned about a
  club the caller does not own
- **AND** the app SHALL NOT show a screen implying the club is missing; it SHALL report that the
  action was not available and refresh what it shows

#### Scenario: Partial
- **WHEN** the roster loads but the club's own row does not, or the reverse
- **THEN** the control SHALL NOT be drawn against half the picture in a way that could select the
  destructive arm
- **AND** the deletion confirmation SHALL refuse to enable its confirm button whenever its counts have
  not arrived, unchanged from today

#### Scenario: Stale
- **WHEN** the app's view of the roster is out of date in either direction
- **THEN** the database SHALL decide the arm and the app SHALL render the answer it gets
- **AND** after any outcome the club list, the club's postcard feed, the club's ride list and the
  notifications list SHALL all be invalidated, because a departure changes which notifications resolve
  for this rider with no notification row written or deleted

### Requirement: What a departing owner keeps and loses SHALL be stated

Leaving SHALL change the leaver's membership and the club's ownership, and SHALL NOT reach anything
else they wrote.

#### Scenario: Their content stays with the club
- **WHEN** the owner leaves by transfer
- **THEN** their postcards in the club, the rides they organised in it, their crew memberships of
  those rides, and the threads and messages they wrote SHALL all survive
- **AND** for a private club they SHALL no longer be able to read any of it, which is the same
  asymmetry any rider who leaves already gets

#### Scenario: The club's imagery is cleared
- **WHEN** ownership transfers
- **THEN** the club's avatar and cover SHALL be cleared, because both are pinned to the owner's
  identity by a database constraint
- **AND** the stored image objects SHALL be offered to the leaving rider's client to delete, since it
  is the only client whose storage permissions reach them

#### Scenario: The successor inherits the club's administration
- **WHEN** ownership transfers
- **THEN** the new owner SHALL be able to edit the club, manage its riders including its other admins,
  moderate its threads, and answer its pending join requests
- **AND** any pending join requests SHALL survive the transfer and be answerable by them

#### Scenario: Nobody is notified by this change
- **WHEN** ownership transfers
- **THEN** no notification SHALL be written to anybody, and this SHALL be a stated deferral rather
  than an omission
- **AND** the successor SHALL discover their ownership by opening the club
