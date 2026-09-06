# create-affordance (delta)

> **New capability.** Nothing in `openspec/specs/` covers how a screen offers a rider the act of
> creating something. The eight standing capabilities were read before writing this
> (`client-render-shell`, `client-cache-invalidation`, `client-session-storage`,
> `database-enforced-integrity`, `event-fanout-integrity`, `notifications`, `realtime-subscriptions`,
> `ride-chat`) and none of them owns this behaviour — so this delta **ADDS** a capability and
> **MODIFIES nothing**.
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
  the organizer, or a rider with a `ride_members` row
- **AND** a rider who has been **invited but has not joined** SHALL NOT be offered it
- **AND** a rider who can merely **read** the ride SHALL NOT be offered it, because readability and
  crew membership are different predicates

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

### Requirement: The bottom composition of a screen SHALL be decided in one place, and complementary affordances SHALL NOT be expressed as separate conditions

Where a screen can draw more than one thing at its bottom edge — an RSVP bar, a create affordance,
neither — which ones are drawn and where they sit SHALL be one pure function with an exhaustive test,
not two or more conditions in the markup.

Two conditions written at two points can drift into agreeing, which produces either two entrances to
one composer or none at all. This survives the affordance changing shape: a floating control does not
contend for the sticky slot, but it does contend for the same **pixels**, because the RSVP bar's
button group reaches the same corner. The contest becomes an offset rather than a slot, and the
condition deciding it is unchanged.

#### Scenario: One decision, one test
- **WHEN** the ride detail decides what to draw at its bottom edge
- **THEN** a single pure function SHALL answer it from the RSVP condition and the crew condition
- **AND** its test SHALL be exhaustive over those inputs

#### Scenario: The clearance a screen reserves comes from the same decision as the control it clears
- **WHEN** a screen reserves bottom clearance
- **THEN** the amount SHALL be read from the same decision that drew the control
- **AND** clearance SHALL NOT be reserved for a control that is not drawn

#### Scenario: A floating control above an existing bottom bar is offset, not overlapped
- **WHEN** a floating create control and a bottom bar are drawn on the same screen
- **THEN** the control SHALL be offset by that bar's height
- **AND** it SHALL NOT cover any control the bar carries

#### Scenario: Exactly one entrance survives the rewrite
- **WHEN** a rider who may create opens the screen
- **THEN** they SHALL be offered exactly one entrance to the composer, never two and never none
- **AND** where a fallback entrance existed only because the primary could not be drawn, it SHALL be
  removed when the primary can always be drawn, rather than left as a second entrance

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
