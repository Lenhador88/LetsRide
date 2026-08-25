## MODIFIED Requirements

### Requirement: A rider SHALL NOT learn a private club's name, or a private ride's title, from a notification

A notification row SHALL carry no denormalised text describing its subject. Every rendered string
naming a club, ride, postcard or rider SHALL be read from that resource under the reader's own row
security at the moment of rendering.

**A snapshot is a second copy of a visibility decision and nothing re-checks it.** A
`club_name text` column would be readable by its recipient for ever, including after they left the
club, were removed from it, or were blocked by everyone in it — and the row would look perfectly
correct to any reviewer, because the value in it was true when it was written.

**Push delivery is the one exception to the second sentence, and it is stated here rather than left
as a contradiction between two live specs.** A device shows a string or it shows nothing, and no
device can execute a policy — so the copy a push carries cannot be read under the *reader's* row
security in the literal sense this requirement means. The exception is permitted only under all
four of the conditions `database-enforced-integrity` states, and its scope is exactly one:

- **The first sentence is untouched.** No column holds text, in `notifications` or in any table
  derived from it, before or after sending.
- **What is relaxed is *who executes the check*, never *what the check is*.** A `security definer`
  function evaluates the same conjunct set the reader's own policy would, per column, with the
  recipient supplied as an argument rather than as `auth.uid()` — which is the shape `060` already
  established for fan-out and is why this is a substitution rather than a weakening.
- **The moment is unchanged: rendering time.** The copy is produced immediately before
  transmission, never at the moment of the event.
- **It applies to transmission only.** Every in-app render — the list, the row, the badge — still
  reads under the reader's own row security with no exception of any kind.

#### Scenario: No column holds a name, title or caption
- **WHEN** the table is created
- **THEN** it SHALL carry no `club_name`, `ride_title`, `actor_username`, `postcard_caption`,
  `body`, `message` or equivalent column

#### Scenario: The in-app render keeps the rule with no exception
- **WHEN** `/notifications`, its rows or its badge render
- **THEN** every string SHALL be read under the reader's own row security
- **AND** the push exception SHALL NOT be read as licence to render in-app copy from a privileged
  function, because that path has a reader with a session and needs none

#### Scenario: The substitution is per column and named
- **WHEN** the delivery path evaluates whether a recipient may see a subject
- **THEN** it SHALL apply the same per-column conjuncts the SELECT policy applies
- **AND** it SHALL NOT dispatch that decision on `type`, because this requirement's sibling in
  `036` fixed the subject shapes precisely so that the visibility question could be written per
  column and the two could not drift

#### Scenario: The exception is bounded by the four conditions and by nothing else
- **WHEN** a second consumer of notification copy is proposed — an email digest, an SMS, a webhook
- **THEN** it SHALL meet the same four conditions or SHALL NOT be built
- **AND** the existence of this exception SHALL NOT be cited as a general permission to render
  notification copy outside a reader's session

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Follow buttons, "Ride upcoming!", "Ride updated", "liked your comment.", ride thumbnails,
per-type preferences and a dismiss control SHALL NOT be rendered as disabled or non-functional
controls.

A control that renders and does nothing is a worse artifact than an absent one — the reasoning that
removed the Inbox tab (PD-100) rather than shipping it disabled, and that `RideHeader` already
applies to the buttons it omits.

**Push delivery leaves this list, and per-type preferences stay on it for a different reason,
which has to be restated or the requirement reads as satisfied by inertia.** Both were named in one
breath as absent-not-disabled. Delivery now ships. Preferences stay absent, but no longer because
nothing delivers — the OS switch is now a real control that really does something, so the reason
becomes a decision about product surface rather than a consequence of an unbuilt path.

**And a new surface joins the list rather than being built half-way: the devices screen.** Nothing
in this app shows a rider which devices are registered, and the reason is a schema decision rather
than an omission — no client role may read a device token at all, so such a screen would have to
be built as an RPC returning non-secret attributes and is deliberately not built here.

#### Scenario: The Follow button is absent, not disabled
- **WHEN** the list is built
- **THEN** no follow affordance SHALL be rendered anywhere on it
- **AND** the reason SHALL be recorded: there is no follow graph, `013` dropped `friendships`, and
  the social graph is clubs plus blocking

#### Scenario: The scheduled and update rows are absent
- **WHEN** the list is built
- **THEN** `Ride upcoming!` and `Ride updated` rows SHALL NOT be rendered as placeholders, greyed
  rows or "coming soon" entries
- **AND** their two-line date/time row shape SHALL NOT be built speculatively
- **AND** the *"your ride is tomorrow"* reminder SHALL remain absent from this change even though
  push now exists, because it needs a sixth notification type, a subject-shape CHECK arm, an
  idempotence index and the first deliberate exception to *"a rider SHALL NEVER be notified of
  their own action"* — all of which are `notifications` work rather than delivery work

#### Scenario: No club-postcard notification is added
- **WHEN** the trigger set is built
- **THEN** no notification SHALL be written for a new postcard in a club
- **AND** the reason SHALL be recorded: `015`'s `feed_reads` watermark and `club_unread_counts()`
  already badge that surface, and a second mechanism for one event is how one of them goes stale

#### Scenario: The header control does not displace an existing menu
- **WHEN** the notification control is added to a tab-root screen that already renders a header
  action — `/profile` and its `ProfileMenu` is the only one today
- **THEN** both controls SHALL be present, matching the design's two 40×40 controls at x302/x342
- **AND** neither SHALL be removed, hidden behind the other, or moved into the other's menu

#### Scenario: How `Header` carries two controls is an architecture decision, not a styling one
- **WHEN** the mechanism is chosen — a second named slot, or an `action` that accepts a fragment
- **THEN** it SHALL be recorded as an **architecture decision in `design.md`**, with the option not
  taken and why, rather than delegated as "`design-system`'s call"
- **AND** the reason SHALL be that `Header` is a primitive every screen in the app renders, its
  `action` slot is already consumed by `/profile` and `RideHeader`, and this is the **only** change
  in this proposal that touches code outside `src/**/notifications/` — so its blast radius is the
  whole app rather than one screen
- **AND** the decision SHALL be taken before `§4` starts, because both call sites have to be written
  against whichever shape is chosen

#### Scenario: Detail screens get no notification control
- **WHEN** a detail screen renders its header
- **THEN** it SHALL keep its `action` slot for its own menu and SHALL NOT gain the notification
  icon
- **AND** the four tab-root screens SHALL be the complete set that carries it

#### Scenario: Per-type preferences stay absent, for a restated reason
- **WHEN** push delivery ships
- **THEN** no per-category toggle SHALL be rendered, enabled or disabled
- **AND** the reason SHALL be recorded as a decision rather than a consequence: the platform's own
  per-app switch is the control, all five existing types are low-volume by construction, and a
  preference table is a second visibility-shaped decision to keep in step with a fan-out that
  already has five types
- **AND** the condition that reopens it SHALL be named: **the first high-volume category.** Ride
  chat is the candidate, and if chat push ships, preferences ship in the same change — or the first
  busy thread teaches every rider on it to disable LetsRide notifications entirely, which is not
  recoverable

#### Scenario: A devices screen is absent rather than stubbed
- **WHEN** push registration ships
- **THEN** no "your devices" list, count or management control SHALL be rendered
- **AND** the reason SHALL be recorded: no client role may read a device token, so the screen would
  have to be an own-row RPC returning `platform` and `last_seen_at`, and building it as a SELECT
  grant would reopen the registration RPC's safety argument

## ADDED Requirements

### Requirement: A notification SHALL be pushed at most once, and a delivered push SHALL be understood as beyond recall

Each `notifications` row SHALL produce at most one push attempt per registered device, whatever
happens to the schedule, the batch or the sending process. And once a push has been accepted by a
platform, its text is on a device permanently: no block, membership change, deletion or policy
edit removes it.

**The in-app row and the delivered push therefore have different lifetimes, and the difference is
stated rather than discovered.** `036` §3's whole design is that a notification's correctness at
write time says nothing about its correctness at read time, so the policy re-asks the question on
every read and a row silently stops being returned. A push is read exactly once, by a device, at a
moment nothing can revisit.

#### Scenario: A retried batch does not double-send
- **WHEN** the same outbox row is claimed twice — an overlapping schedule run, a function that
  timed out after sending, a manual re-run
- **THEN** at most one push SHALL reach a device for that notification
- **AND** the guarantee SHALL come from the claim, not from a check performed after sending

#### Scenario: The two lifetimes are stated together
- **WHEN** a rider is blocked, removed from a private club, or loses a ride, after a push about it
  was delivered
- **THEN** their next read of `/notifications` SHALL NOT return the row, and the unread count SHALL
  fall with it, per the existing read-time requirements
- **AND** the delivered push SHALL remain on their device
- **AND** this SHALL be recorded in the migration header and in `design.md` in the same words, so
  that no future session reads the in-app disappearance as evidence the push was withdrawn

#### Scenario: No withdrawal mechanism is built
- **WHEN** a mechanism to remove or replace delivered pushes is proposed
- **THEN** it SHALL be refused
- **AND** the reason SHALL be that it requires a standing sweep re-evaluating every delivered push
  against every rider's current visibility — an unbounded query answering a question a device has
  already shown to somebody

#### Scenario: The retention window for a notification is unchanged
- **WHEN** push delivery ships
- **THEN** the `notifications` retention window SHALL remain *as long as the subject exists*, in
  those words
- **AND** the outbox SHALL NOT extend it: an outbox row SHALL cascade with its notification, and
  completed rows SHALL additionally be swept, so that delivery bookkeeping does not become a
  permanent parallel record of every interaction in the app after the notifications themselves are
  gone
