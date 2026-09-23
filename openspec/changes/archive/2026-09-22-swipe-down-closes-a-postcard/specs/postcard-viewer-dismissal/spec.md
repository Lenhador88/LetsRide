## Purpose

Defines every way the open-postcard popup (`PostcardViewerDialog`) may be dismissed by a rider's
own action, and the conditions under which a gesture that looks similar must NOT dismiss it —
covering the Close control, Escape, a scrim tap, and a downward drag from inside the panel.

## ADDED Requirements

### Requirement: A downward drag that begins inside the panel closes the popup

The popup SHALL close in response to a pointer gesture that begins inside the panel — over the
photo, the caption, the comment thread, or any plain content — travels predominantly downward, and
is either far enough or fast enough to read as deliberate. Where the gesture begins and what the
panel's own scroller is doing decide the outcome; where the gesture ends does not.

#### Scenario: A strong, dominant, downward pull closes the popup
- **WHEN** a rider drags down from inside the panel, with the panel's own scroller already at its
  top, far enough or fast enough to be a deliberate pull
- **THEN** the popup SHALL close

#### Scenario: A drag that is released short of the threshold springs back
- **WHEN** a rider's downward drag from inside the panel travels far enough to be drawn as
  following the finger, but is released before it is far or fast enough to qualify
- **THEN** the popup SHALL remain open
- **AND** the panel SHALL return to its resting position

### Requirement: The panel's own scroller owns a downward drag that STARTS with anywhere to go

The panel's content scrolls (`overflow-y-auto`, `overscroll-contain`, per PD-339). Whether the
scroller or the dismiss owns a gesture is decided once, from the scroller's position at the start
of that gesture, and is never re-decided as the gesture plays out. A pull that begins while the
scroller is not at its own top SHALL be read as scrolling for the gesture's whole duration and
SHALL NOT dismiss the popup, however far or fast it is dragged and even if the scroller reaches
its top before release. Only a pull that begins with the scroller already at its top is a
candidate dismissal.

This is a platform constraint, not a design preference: suppressing the browser's own default is
what lets a gesture become a dismiss at all (see the sibling requirement on controls), and this
capability deliberately does not suppress the platform's native scroll for a gesture that starts
with the scroller not at its top. Once the platform has taken the gesture for its own scroll, it
does not hand it back mid-gesture, so there is no point at which "the scroller just reached its
top" can be observed and answered.

#### Scenario: Pulling down through unread content scrolls, and only scrolls
- **WHEN** a rider drags down while the panel's scroller is not at its top
- **THEN** the popup SHALL NOT close, whatever the distance or speed of the drag, and whether or
  not the scroller reaches its top before the rider releases
- **AND** the scroller SHALL move as an ordinary scroll

#### Scenario: A pull that starts at the top is a candidate dismissal from the first pixel
- **WHEN** a rider drags down and the panel's scroller is already at its top at the moment the
  drag begins
- **THEN** the drag SHALL be judged as a candidate dismissal by this capability's other
  requirements, measured from where it began

### Requirement: A gesture that begins on a control keeps that control's own behaviour

A pointer gesture whose `pointerdown` target is, or is inside, a text field, a `select`, a button,
a link, or any `contentEditable` element SHALL NOT be read as the start of a dismiss drag at any
distance or speed. The control SHALL receive the gesture exactly as if this requirement did not
exist — including a caret placement, a text selection, or an ordinary click.

#### Scenario: A drag starting in the comment composer keeps its own gesture
- **WHEN** a rider presses and drags inside the comment textarea, in any direction
- **THEN** the popup SHALL NOT close
- **AND** the textarea SHALL behave exactly as it would with no dismiss gesture installed —
  including placing a caret or selecting text

#### Scenario: A drag starting on a button or a link keeps its own click
- **WHEN** a rider's gesture begins on the Close button, the byline, the club link, or any control
  drawn inside the panel, and is released without leaving that control
- **THEN** the popup SHALL NOT close as a side effect of the drag
- **AND** the control's own click SHALL still fire

### Requirement: A nested dialog above the panel absorbs the gesture

When another `role="dialog"` `aria-modal="true"` element is mounted above the panel — the
postcard's own overflow menu — a pointer gesture SHALL dismiss neither the popup underneath nor
anything else, the same nesting rule this popup's own Escape handling already follows.

#### Scenario: A drag while the overflow menu is open dismisses nothing underneath
- **WHEN** the postcard's own overflow menu is open over the popup
- **THEN** a drag SHALL NOT close the popup underneath it, however it is shaped

### Requirement: An upward drag never dismisses the popup

A pointer gesture travelling predominantly upward SHALL NOT close the popup, regardless of the
panel's scroll position, its distance, or its speed.

#### Scenario: Pulling up does nothing
- **WHEN** a rider drags upward from inside the panel, at any scroll position
- **THEN** the popup SHALL NOT close

### Requirement: A mostly-horizontal drag over the postcard card does not dismiss

A gesture whose travel is not predominantly vertical SHALL NOT be read as a dismiss, including one
that starts over the postcard photo or caption — the same card the home deck swipes horizontally
elsewhere in the app.

#### Scenario: A horizontal drag over the card is not mistaken for a dismiss
- **WHEN** a rider's drag over the postcard card travels mostly sideways
- **THEN** the popup SHALL NOT close, whatever the horizontal distance

### Requirement: The existing exits are unaffected, and the gesture adds no new one to the accessibility tree

The Close button and Escape (when the panel is the topmost dialog) SHALL continue to close the
popup exactly as before this capability existed. The drag gesture SHALL add no ARIA role, no
`tabIndex`, and no other accessibility-tree change to the panel — it is reachable by pointer alone,
the same way the scrim tap it sits beside already is.

#### Scenario: Escape still closes the topmost popup
- **WHEN** the rider presses Escape while the popup is the topmost dialog
- **THEN** the popup SHALL close, exactly as before this capability existed

#### Scenario: The panel's accessible shape is unchanged
- **WHEN** the popup is open
- **THEN** the panel SHALL still expose `role="dialog"`, `aria-modal="true"` and `tabIndex="-1"`,
  and no attribute the drag gesture introduces

### Requirement: A drag that begins inside the panel is never re-judged as a scrim tap

The scrim's own tap-to-dismiss (PD-339) fires only for a gesture whose `pointerdown` landed on the
scrim itself. A gesture whose `pointerdown` began inside the panel SHALL be decided entirely by
this capability's own requirements, regardless of where it is released — including a release over
the strip of scrim PD-339 deliberately leaves above the panel.

#### Scenario: A panel drag released over the scrim strip is judged as a panel drag
- **WHEN** a drag begins inside the panel and is released over the strip of scrim above it
- **THEN** whether the popup closes SHALL be decided by this capability's drag requirements alone
- **AND** the scrim's own tap-to-dismiss SHALL NOT additionally fire for the same gesture

### Requirement: This capability applies to the popup only, not to the full-screen thread route

`/postcards/detail` renders the same postcard as its own screen rather than as a sheet drawn over
another one. A downward drag on that route SHALL NOT be affected by anything in this capability.

#### Scenario: The full-screen thread route is untouched
- **WHEN** a rider drags downward on `/postcards/detail`
- **THEN** no behaviour from this capability SHALL apply
- **AND** the route's own scroll and its existing swipe-right-to-go-back gesture (PD-341) SHALL be
  the only gestures in effect
