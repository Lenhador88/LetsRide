# client-render-shell (delta)

## ADDED Requirements

### Requirement: A privacy control SHALL NOT render a guessed position

A control that states what the app does with a rider's data SHALL render its true position or no
position at all. It SHALL NOT paint a default while the real answer is in flight.

The standing rule — *gate a screen on its data, never on `isLoading`* — is the mechanism, and here
it has a consequence the ordinary screens do not: a toggle that flashes **on** before an
opted-out rider's preference resolves has told them something false about their own privacy, and
a rider who taps it in that window believes they have just opted out when they have opted **in**.
The two-tap race is the whole reason this requirement exists.

`undefined` is "not read yet"; `null` is the decided answer "not opted out". Conflating them is
what draws the guess.

**Every state, because a settings row has all of them:**

| State | Required behaviour |
|---|---|
| Empty | Does not occur. There is always an answer — a stamp or NULL — for any row that exists |
| Loading | The row renders with its label and a **disabled, position-less** control, or a skeleton. Never a toggle in a default position |
| Error | The accessor failed. The row says so and offers a retry. **No toggle is drawn**, and the analytics client stays capture-off |
| Offline | The write is refused with a message. The control SHALL NOT flip optimistically — an opt-out that appears to land and never does is the worst outcome this screen can produce |
| Permission denied | Cannot occur for a rider's own row; if the RPC answers `42501` or `PGRST202` — a deploy mismatch — it is the **error** state, never "not opted out" |
| Partial | Does not occur; one value, one call |
| Stale | The preference may have been changed on another device. The screen SHALL re-read on mount and SHALL invalidate its key on write, so the window is one navigation rather than one session |

#### Scenario: The toggle is not drawn before the preference is known
- **WHEN** the settings surface first paints and `my_analytics_opt_out()` has not answered
- **THEN** the control SHALL be disabled and SHALL show no on/off position
- **AND** a tap in that window SHALL do nothing rather than write the position it appeared to show

#### Scenario: A failed read is not drawn as an answer
- **WHEN** the preference read errors
- **THEN** the row SHALL show an error with a retry
- **AND** it SHALL NOT fall back to rendering "analytics on", which is both the wrong claim and the
  opposite of the capture-off posture the client is actually in

#### Scenario: Offline refuses rather than pretends
- **WHEN** a rider toggles the control with no connectivity
- **THEN** the control SHALL return to its stored position and the rider SHALL be told the change
  did not save
- **AND** no local-only "opted out" state SHALL be retained that the client then honours, because a
  preference that exists on one device and not in the database is exactly the durability this
  change was written to provide
