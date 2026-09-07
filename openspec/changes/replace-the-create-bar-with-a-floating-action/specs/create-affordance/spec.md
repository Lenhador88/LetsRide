# create-affordance (delta)

> **New capability.** Nothing in `openspec/specs/` covers how a screen offers a rider the act of
> creating something. The eight standing capabilities were read before writing this
> (`client-render-shell`, `client-cache-invalidation`, `client-session-storage`,
> `database-enforced-integrity`, `event-fanout-integrity`, `notifications`, `realtime-subscriptions`,
> `ride-chat`) and none of them owns this behaviour — so this delta **ADDS** a capability and
> **MODIFIES nothing**.
>
> **The requirements are written about a create affordance, not about a floating one**, and that is
> what let the change widen without them moving. The change now converts **both** detail screens —
> the ride shipped 2026-09-06 (`d4fd70b`) and Q1 answered the club the same day — and **not one
> requirement below needed rewriting for it**: the club scenarios were already written as behaviour
> the conversion must preserve, so they became its acceptance criteria unchanged rather than
> describing a screen left alone. A requirement that had named the *bar* would have had to be
> rewritten here; that is the argument for writing them this way, recorded because it paid off.
>
> The four `STICKY_ACTIONS` **list** screens keep their full-width primary and are out of scope.
>
> **Every requirement below is about the affordance, never about enforcement.** Each gate named here
> is already enforced in Postgres and is unchanged by this change; the requirements say the control
> must *agree* with the policy, so that no rider is offered an action the database will refuse.
> `openspec/config.yaml` asks that access-control requirements be testable statements about a role
> and a resource — the role rows below are written to map onto assertions, and the policies they
> name (`private.is_club_member`, `private.is_ride_crew`) already have them in
> `supabase/tests/rls_test.sql`.

## ADDED Requirements

### Requirement: A create affordance SHALL be gated on the same predicate as the policy behind it

A control offering a create action SHALL be drawn only when every destination it can reach would be
accepted by its INSERT policy for the current rider. A control the database always refuses is worse
than no control, because the refusal arrives after the rider has committed to the act.

Measured on DEV on 2026-09-06, the predicates are: a postcard or ride in a club and a club thread all
require `private.is_club_member(club_id)`; a postcard tagged to a ride requires
`private.is_ride_crew(ride_id)`, which is `rides.organizer_id = auth.uid()` **or** a `ride_members`
row.

The affordance is never the enforcement. A rider who defeats the control SHALL gain nothing.

#### Scenario: A club member reaches every action the control offers
- **WHEN** a rider with any `club_members` row for a club opens that club's detail
- **THEN** the create affordance SHALL be drawn
- **AND** each action it offers SHALL be one `private.is_club_member` already admits

#### Scenario: The control does not read `club_members.role`
- **WHEN** the control decides whether to draw for a club
- **THEN** it SHALL read membership and SHALL NOT read `role`
- **AND** a rider whose row is `admin` SHALL be offered exactly what a `member` is offered, because
  `private.is_club_member` ignores `role` and gating on it would invent a hierarchy no policy has

#### Scenario: A club owner is admitted on their membership row, which ownership does not guarantee
- **WHEN** a club's owner opens its detail and holds a `club_members` row
- **THEN** the control SHALL be drawn because of that row, not because they are the owner
- **AND** no separate owner branch SHALL exist in the control
- **AND** where the owner holds **no** membership row — reachable on any project without `103`'s
  seeding trigger — the control SHALL NOT be drawn, even though `private.is_club_member_for` admits
  them through `054`'s owner arm and the INSERT policy would accept the write
- **AND** the control SHALL NOT be "fixed" by gating on `private.is_club_member_for` instead: the
  affordance SHALL reflect the membership row the screen already reads, so it fails by withholding
  rather than by offering a control whose basis it has not established

#### Scenario: A non-member of a public club is offered nothing
- **WHEN** a rider with no `club_members` row opens a public club's detail
- **THEN** no create affordance SHALL be drawn
- **AND** it SHALL NOT be drawn in a disabled state, because a disabled control still announces that
  the action exists

#### Scenario: A ride's crew is the organizer plus the joined riders, and nobody else
- **WHEN** a rider opens a ride's detail
- **THEN** the create affordance SHALL be drawn only if `private.is_ride_crew` would return true —
  the organizer, or a rider with a `ride_members` row of either status
- **AND** a rider who has been **invited but has not joined** SHALL NOT be offered it
- **AND** a rider who can merely **read** the ride SHALL NOT be offered it, because readability and
  crew membership are different predicates

#### Scenario: Declining a ride withdraws the affordance, and that is not an error state
- **WHEN** a rider answers *No*, which deletes their `ride_members` row rather than storing a status
- **THEN** the create affordance SHALL NOT be drawn, because `041` and `108` both refuse the writes
  behind it
- **AND** the screen SHALL NOT explain the withdrawal as a consequence of their answer, because the
  same absence is what every non-crew reader sees

### Requirement: A create affordance SHALL NOT be drawn before its gate has an answer

The control SHALL be drawn only when its gate has resolved to true, and SHALL NOT be drawn while the
gate is unresolved. The gate is read asynchronously and is `undefined` until it lands; a control
drawn on `undefined` and withdrawn on `false` offers an action to a rider who may not take it, and
reads as the app changing its mind.

This is `client-render-shell`'s *"a screen never renders its empty state while loading"* applied to a
control rather than to content, and it is the same rule as `CLAUDE.md`'s *gate on the data, never on
`isLoading`*.

#### Scenario: The gate is still loading
- **WHEN** the membership or crew read has not returned
- **THEN** no create affordance SHALL be drawn
- **AND** the screen SHALL NOT reserve clearance for one it is not drawing

#### Scenario: The subject failed to load
- **WHEN** the club or ride read fails and the screen renders its error state
- **THEN** no create affordance SHALL be drawn over it
- **AND** the retry SHALL be the only action offered

#### Scenario: A partial failure does not withdraw a control its own gate answered
- **WHEN** the club loads and membership is known but a secondary read on the screen fails
- **THEN** the create affordance SHALL still be drawn, because it is gated on membership alone

### Requirement: A create affordance SHALL be owned by its screen and SHALL NOT be hoisted into a shared layout

The control SHALL be rendered by the screen that knows its gate, and SHALL NOT be added to the root
layout, the `(app)` layout, or the navigation component.

A shared layout knows the pathname and nothing else — which is exactly why `Navbar`'s `STICKY_ACTIONS`
map cannot carry the club's control, and why the club detail owns its own. Hoisting it also drops it
onto the screens that deliberately render no navigation bar, whose own fixed composers are
bottom-anchored; that defect has already shipped once on the club thread and **no gate but the smoke
walk can see it**.

#### Scenario: The control is absent from screens that replace the navigation bar
- **WHEN** a rider opens a screen that renders no navigation bar because it has its own
  bottom-anchored composer
- **THEN** no create affordance SHALL be drawn on it
- **AND** this SHALL hold by the control being screen-owned, not by a list of exceptions

#### Scenario: The primitive decides nothing
- **WHEN** the shared floating-action primitive is written
- **THEN** it SHALL take its visibility from a prop supplied by the screen
- **AND** it SHALL contain no membership, crew, pathname or route knowledge of its own

### Requirement: A create affordance's behaviour SHALL follow its arity, and its name SHALL follow its behaviour

A control offering exactly one action SHALL perform that action, and SHALL be named for the act. A
control offering two or more SHALL open the labelled action list, and SHALL be named for the
category. A menu holding a single row is a tap that asks a question with one answer.

An icon-only control carries no visible word, so where the name is the act it SHALL be visible and
not only accessible.

#### Scenario: One action navigates
- **WHEN** a screen's create affordance has exactly one destination
- **THEN** tapping it SHALL go to that destination directly
- **AND** its name SHALL be the act — *Add a photo* — never a bare `+` and never *Create*

#### Scenario: Several actions open a list
- **WHEN** a screen's create affordance has two or more destinations
- **THEN** tapping it SHALL open a labelled list of them
- **AND** each entry SHALL carry the club or ride, so the composer opens already scoped and the back
  path returns to the screen the rider left

#### Scenario: A second action arrives and the behaviour follows by rule
- **WHEN** a screen that had one create destination gains a second
- **THEN** its control SHALL begin opening the list by the rule above
- **AND** this SHALL NOT require a decision to be re-taken per screen

#### Scenario: The list keeps every behaviour of a modal
- **WHEN** the action list is opened, by whatever animation
- **THEN** it SHALL trap focus, close on Escape, present a dismissing scrim, prevent the page behind
  it from scrolling, and return focus to the control that opened it
- **AND** if it is not the existing bottom sheet, it SHALL be tested under a DOM environment, because
  a scrim tap and an Escape key cannot be dispatched against a static render

### Requirement: A create affordance SHALL meet the glove target floor, and its hit area SHALL be measured rather than assumed

Every interactive target SHALL be at least 44×44 CSS px of **hit area**. The rendered box may be
smaller where the design measures it smaller, provided the touch target is extended to the floor
without moving a rendered pixel — the technique `Button` already uses for its `sm` and `md` sizes.

The floor is written in `.claude/agents/rider-ux.md` and `.claude/agents/design-system.md`. It is
**not** in `CLAUDE.md`, though two primitives cite it as being there — so a grep of `CLAUDE.md`
returns the plausible wrong answer that no floor exists.

#### Scenario: The control clears the floor
- **WHEN** the floating create control is built
- **THEN** its hit area SHALL be at least 44×44 CSS px

#### Scenario: The loss against the bar is stated rather than discovered
- **WHEN** a full-width create bar is replaced by a floating control
- **THEN** the change in hit area SHALL be stated in the change record, because a 358×44 target
  becoming a 56×56 one is a fivefold reduction that clearing the floor does not describe
- **AND** where the control carries a visible label, the extended shape SHALL be preferred over a
  bare circle, because it recovers hit area and preserves the label at the same time

#### Scenario: A retired affordance's target is accounted for
- **WHEN** a fallback create affordance is removed by this change
- **THEN** whether it met the floor SHALL be recorded, so removing a sub-floor target is not confused
  with removing a compliant one

#### Scenario: An indicator that reopens a control is measured as a control
- **WHEN** an inline indicator is the only route back to a control the screen has hidden
- **THEN** its hit area SHALL be at least 44×44 CSS px, extended without moving a rendered pixel
  where the drawn box is smaller
- **AND** it SHALL carry a visible affordance that it can be tapped, because inline text at a title's
  size reads as a label and a rider who does not tap it cannot revise their answer at all

### Requirement: The bottom composition of a screen SHALL be decided in one place, and complementary affordances SHALL NOT be expressed as separate conditions

Where a screen can draw more than one thing at its bottom edge — an RSVP bar, a create affordance,
neither — which ones are drawn and what clearance the page reserves SHALL be one pure function with
an exhaustive test, not two or more conditions in the markup.

Two conditions written at two points can drift into agreeing, which produces either two entrances to
one composer or none at all. The function survives the affordance changing shape, and it survives the
contest being *removed*: a screen whose two bottom controls are mutually exclusive still has to
decide which one is drawn, what the chip beside them says, and which clearance the page owes.

#### Scenario: One decision, one test
- **WHEN** the ride detail decides what to draw at its bottom edge
- **THEN** a single pure function SHALL answer it, from whether the RSVP question is live for this
  rider, what they have stored, whether they may create, and whether they have asked to answer again
- **AND** its test SHALL be exhaustive over those inputs

#### Scenario: The clearance a screen reserves comes from the same decision as the control it clears
- **WHEN** a screen reserves bottom clearance
- **THEN** the amount SHALL be read from the same decision that drew the control
- **AND** clearance SHALL NOT be reserved for a control that is not drawn, nor while its gate is
  unresolved

#### Scenario: Two persistent bottom controls SHALL NOT share a corner
- **WHEN** a screen can draw both a fixed bottom bar and a floating create control
- **THEN** at most one of them SHALL be drawn at any moment
- **AND** where a screen is ever built that must draw both, the floating control SHALL be offset by
  the bar's height and SHALL NOT cover a control the bar carries, including one that reaches the same
  corner because it spans the screen's width

#### Scenario: Exactly one entrance, and the one state that has none is rider-initiated
- **WHEN** a rider who may create opens the screen
- **THEN** they SHALL be offered exactly one entrance to the composer, never two
- **AND** they SHALL be offered none only while they are answering a question they themselves
  reopened, and that state SHALL be dismissable by answering it

#### Scenario: A fallback entrance whose condition became unreachable is removed, and the removal is proved
- **WHEN** a fallback entrance existed only for a combination of conditions the change makes
  unreachable
- **THEN** it SHALL be removed rather than left as a second entrance
- **AND** the unreachability SHALL be established from the database rule that makes it so — a column
  that cannot be null, and every writer of that column — rather than from reading the components

### Requirement: A question a rider has answered SHALL NOT keep a standing control, and the answer SHALL stay changeable from a control that meets the target floor

Where a screen draws a standing control to ask a rider something, and the rider has answered it, the
control SHALL be replaced by an indicator of their answer that reopens it. The indicator SHALL be a
control in its own right: it SHALL meet the target floor, SHALL carry a visible affordance that it
can be tapped, and SHALL be reachable without scrolling past the thing it describes.

Hiding the standing control is what frees the screen; the indicator is what stops that from being a
one-way door. An answer a rider cannot revise is worse than a control they must look past, because
the cost lands on somebody else — a ride cancelled for rain, counted with a rider who is not coming.

The indicator SHALL show the rider's **own** stored answer and nothing else. It SHALL NOT be derived
from a roster, a count or any read that includes other riders, both because those are filtered by
blocking and truncated for display, and because one rider's answer is not a fact this control is for.

#### Scenario: An unanswered rider keeps the standing control
- **WHEN** the question is live for a rider and they have stored no answer
- **THEN** the standing control SHALL be drawn
- **AND** no indicator SHALL be drawn
- **AND** the create affordance SHALL NOT be drawn beside it

#### Scenario: An answered rider gets the indicator and the create affordance
- **WHEN** the question is live for a rider and they have stored an answer
- **THEN** the standing control SHALL NOT be drawn
- **AND** the indicator SHALL show that answer
- **AND** the create affordance SHALL take the bottom corner, because the writes behind it are
  exactly the ones a stored answer admits

#### Scenario: The indicator reopens the question
- **WHEN** the rider taps the indicator
- **THEN** the standing control SHALL be drawn again
- **AND** the create affordance SHALL be withdrawn for as long as it is

#### Scenario: An answer that clears the stored row leaves the standing control drawn
- **WHEN** a rider's answer is recorded by deleting their row rather than by storing a status
- **THEN** the standing control SHALL remain drawn and no indicator SHALL be drawn, because that
  rider is indistinguishable from one who never answered
- **AND** the screen SHALL NOT invent an indicator for a state the database does not store

#### Scenario: A rider who cannot change their answer is offered no indicator
- **WHEN** the question is not live for a rider — they own the thing being asked about, or the moment
  to answer has passed
- **THEN** no indicator SHALL be drawn, even where a stored row exists for them
- **AND** the gate SHALL be the question's liveness and SHALL NOT be a folded value that supplies an
  answer on their behalf, because a control that reopens a question the database refuses to let them
  answer is a control with nothing behind it

#### Scenario: A failed answer leaves the reopened control open
- **WHEN** the rider answers from the reopened control and the write fails
- **THEN** the control SHALL stay open with its failure message readable
- **AND** the screen SHALL collapse it only on a write that succeeded, so a failed answer is never
  presented as an accepted one

### Requirement: Changing a create affordance SHALL NOT change who can create, and blocking SHALL NOT be added to it

This change is presentational. The set of riders who may create SHALL be identical before and after,
and no visibility rule SHALL migrate into the control.

Blocking is symmetric and removes *visibility*, not *membership*. A club member blocked by another
member still creates in that club, and that is correct: the block governs what each of them sees of
the other, and every part of it is enforced in RLS.

#### Scenario: A blocked club member keeps the affordance
- **WHEN** a rider who holds a `club_members` row and is blocked by another member opens that club
- **THEN** the create affordance SHALL be drawn
- **AND** no block predicate SHALL be added to the control, in either direction

#### Scenario: A blocked rider's absence is an ordinary absence
- **WHEN** a block withholds the crew relationship that would have gated a ride's affordance
- **THEN** the screen SHALL present an ordinary absence
- **AND** it SHALL NOT indicate that a block is the reason, in either direction

#### Scenario: No policy, grant or table changes
- **WHEN** this change is implemented
- **THEN** it SHALL add no migration, alter no policy and add no grant
- **AND** the set of riders admitted by each INSERT policy SHALL be unchanged

#### Scenario: A signed-out visitor reaches the shell and no data
- **WHEN** a request arrives for a club or ride detail with no session
- **THEN** the route guard SHALL send it to `/auth/login`
- **AND** no grant to `anon` SHALL exist for any table the affordance's destinations write, so the
  control's absence is a consequence of the route being unreachable rather than of the control
  hiding itself
