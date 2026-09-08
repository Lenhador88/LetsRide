# client-render-shell (delta)

> **This delta ADDS one requirement and MODIFIES none, deliberately.** `openspec archive` folds a
> delta in by replacing a requirement **wholesale**, so two changes editing one requirement means
> whichever archives second discards the other's edit in silence. Fifteen standing requirements were
> read; three govern this change and every one of them already holds:
>
> - **"A privacy control SHALL NOT render a guessed position"** — the row obeys it today by
>   returning `hidden` until both inputs settle, and this change *widens* that obedience by adding
>   the town read to the set of inputs it waits for. The requirement is unchanged; a new scenario
>   under it would be a modification, so the new obligation is stated below instead.
> - **"Every screen SHALL have a defined first-paint state"** — the row draws nothing on first paint
>   and never flashes an answer. Unchanged.
> - **"A screen assembled from several independently-audienced reads SHALL define every state ONCE"**
>   — this change makes the two Explore screens agree with each other, which is that requirement
>   being satisfied rather than rewritten.
>
> What none of them covers is a control whose **states are a function of a read it does not use**,
> which is D7 in `design.md` and the gap below.

## ADDED Requirements

### Requirement: A control's states SHALL be a function of its own inputs, and SHALL NOT be gated on an unrelated read

A control whose visibility is decided by its own data SHALL be mounted where that decision is the
only gate on it. It SHALL NOT be nested inside a branch belonging to a different read, so that its
seven states are not silently multiplied by another read's three.

`/clubs/explore` draws the location row above its list branch and `/rides/explore` draws it inside
the success branch, over identical inputs. The consequence is invisible in review and precise in
effect: a rider whose ride list is failing, or still loading, is not asked the question that would
fix the distances in that list — on one screen, and not on the other.

The general form matters more than the instance. A screen assembles several reads; nesting one
control under another's gate makes its state table the product of two, and only one of those tables
is ever written down.

**Every state, for this control:**

| State | Required behaviour |
|---|---|
| Empty | Not applicable to the row itself. Its "empty" is a settled `null` position with no town, which is a **visible** state — the question — rather than an absence |
| Loading | Any of the permission, the position or the town unsettled: the row draws **nothing**. Never a placeholder and never a skeleton — a 56px skeleton that resolves to nothing is a worse first paint than nothing |
| Error | The town or position read failed. The row draws nothing rather than asking the wrong question against a missing input, and the screen's own error state owns the message |
| Offline | The row may draw; both sheets refuse gracefully. The town write reports its failure and stores nothing, and the device request simply produces no fix. **No dismissal is recorded for a sheet the rider closed because the write failed** |
| Permission denied | Two different denials share this row and must not be conflated: the **OS** permission (`denied`) is a visible state with its own route, while an RLS refusal on the town read is indistinguishable from an empty answer at the client and is therefore treated as **unsettled**, drawing nothing |
| Partial | The position settled and the town did not, or the reverse. Nothing draws until both do, because the pair decides *which question* is asked |
| Stale | The town may have been changed on another device or on the profile screen in the same session. The row re-reads its keys on mount and its writer invalidates them, so the window is one navigation |

#### Scenario: The control renders on a screen whose list failed
- **WHEN** a screen's primary list read errors or is still in flight
- **THEN** a control gated only on its own inputs SHALL still render according to those inputs
- **AND** it SHALL NOT be mounted inside the list's success branch

#### Scenario: Two screens drawing one control agree on where it goes
- **WHEN** the same control is drawn by more than one screen
- **THEN** its placement relative to those screens' own gates SHALL be the same on each
- **AND** a difference SHALL be a stated decision rather than a consequence of where the JSX was
  pasted

#### Scenario: A control whose copy depends on an input waits for that input
- **WHEN** an input decides **which** of two messages a control shows, rather than decorating one
- **THEN** the control SHALL draw nothing until that input has settled
- **AND** the input SHALL be a required prop, so a caller that omits it renders nothing rather than
  the wrong message
