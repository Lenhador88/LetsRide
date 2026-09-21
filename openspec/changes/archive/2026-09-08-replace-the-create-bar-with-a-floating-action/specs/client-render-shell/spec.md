# client-render-shell (delta)

> **This delta ADDS one requirement and MODIFIES none, deliberately.** `openspec archive` folds a
> delta in by replacing a requirement **wholesale**, so two changes modifying the same requirement
> means whichever archives second discards the first one's edit silently. The six standing
> requirements in this capability — the first-paint state, the failed-read distinction,
> permission-denied versus empty, offline behaviour, the route guard's demotion, and ride-time
> rendering — are read and unchanged, and every one of them already governs the screens this change
> touches.
>
> What they do not cover is what happens when a screen puts a control **on top of** its own scroll
> rather than beside it. Until this change the app had no such control on a content screen: the only
> two `position: fixed` overlays in the tree (`Banner`, `NotificationsPanel`) are transient, and every
> bottom bar reserves its own space. That is the gap below.

## ADDED Requirements

### Requirement: A persistent overlay SHALL NOT permanently occlude content or an interactive element

A control that floats over a screen's scroll rather than reserving space beside it SHALL be defined
against the end of that scroll. Either the screen reserves clearance so nothing ends underneath the
control, or the control's occlusion is bounded so that no **interactive** element is permanently
unreachable. Which of the two a screen takes SHALL be a stated decision rather than a consequence of
its CSS.

A bar reserves its space and therefore cannot occlude anything; that property is what makes the
existing bottom bars safe, and it is what a floating control gives up. The trade is not free in the
direction usually assumed: derived with the same `16 pad + control + 8` rule the existing tokens
use, a 56px control reserves **80px** against the 64px `--navbar-action` bar it replaces, so a
screen that reserves clearance gains no vertical space at all — it gains horizontal space, because
the control spans a fraction of the width the bar did. The space the reserve-nothing option saves is
exactly the space the last row loses.

This is not a rule about floating buttons. It applies to any persistently-drawn overlay a screen
adds over its own scroll.

#### Scenario: The end of a scroll is reachable
- **WHEN** a rider scrolls a list to its last row on a screen carrying a persistent overlay
- **THEN** every interactive target in that row SHALL be reachable without the overlay covering it
- **AND** where clearance is reserved, the amount SHALL be derived from the overlay's own geometry
  rather than borrowed from a differently-sized control

#### Scenario: Clearance is reserved only when the overlay is drawn
- **WHEN** the overlay's gate is false, or still unresolved
- **THEN** the screen SHALL reserve no clearance for it
- **AND** the clearance SHALL be read from the same decision that draws the overlay, so the two
  cannot disagree

#### Scenario: Two overlays on one screen do not share a corner
- **WHEN** a screen can draw both a persistent overlay and a fixed bottom bar
- **THEN** the screen SHALL either draw at most one of them at a time, or offset the overlay by the
  bar's height
- **AND** where both are drawn, the overlay SHALL NOT cover a control the bar carries, including one
  that reaches the same corner because it spans the screen's width
- **AND** which of the two a screen takes SHALL be one decision the screen reads, never a condition
  restated at each control

#### Scenario: A composition that changes under the rider changes its clearance with it
- **WHEN** the rider's own write replaces one bottom control with another of a different height
- **THEN** the clearance the page reserves SHALL change in the same render as the control
- **AND** the change SHALL follow the read that confirmed the write, so a failed write moves neither

#### Scenario: An overlay does not paint over the navigation bar
- **WHEN** a persistent overlay is stacked
- **THEN** it SHALL sit below the navigation bar's layer, so the tabs stay reachable if the two ever
  overlap
- **AND** because a transformed ancestor becomes the containing block for a fixed descendant, the
  overlay SHALL be mounted where no ancestor transform can reparent it, and this SHALL be verified by
  rendering rather than by reading the markup

#### Scenario: The occlusion decision is recorded with its cost
- **WHEN** a screen chooses to let content run underneath a persistent overlay
- **THEN** the choice SHALL be recorded with what it costs — which rows are covered and whether any
  of them is interactive
- **AND** it SHALL NOT be inferred from the absence of a clearance class
