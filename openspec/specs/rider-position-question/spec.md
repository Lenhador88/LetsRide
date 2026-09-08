# rider-position-question Specification

> **Provenance — read before quoting this file.** These requirements were folded out of
> `explore-asks-where-you-ride-from`'s delta spec when it was archived on 2026-09-08. PD-170 and
> PD-419 built the whole of this machinery without an OpenSpec change, so nothing about the
> location ask stood here before — verified rather than assumed:
>
> ```bash
> grep -rln "locationPrimingState\|UseMyLocationRow\|ask-once" openspec/specs/   # 0 before the archive
> ```
>
> **It is deliberately NOT folded into `push-permission-priming`** (which lives, unarchived, under
> `deliver-push-notifications`). The two are the same *shape* — an OS one-shot, a priming sheet, a
> row that draws only in some states — and they hold **opposite** histories about automatic asks,
> so one capability would carry a contradiction in its own scenarios. The name says `question`
> rather than `priming` because this control primarily asks about a **town**, and only secondarily
> offers a permission.

## Purpose
How the app asks a rider where they ride from: the row on the two Explore screens, the pure
function that decides which of its six states draws and which sheet a tap opens, the rule that
nothing opens without a gesture, and the device-local ladder that keeps a dismissed question quiet
for a lengthening interval. Owns the lifted exclusion that gives a rider who denied the OS
permission a route that works.

## Requirements

### Requirement: The app SHALL NOT raise a permission sheet or a question sheet without a rider gesture

No timer, effect, route transition, mount or remount SHALL open the location priming sheet or the
town question sheet. Every opening SHALL originate in a rider's tap on a visible control.

This **reverses PD-419's** *"at Explore, once, automatically, ever"*, and the reversal is deliberate.
The accepted cost is fewer device grants: some riders granted only because a sheet appeared, and
those grants are given up in exchange for an app that never raises a permission sheet unasked. A
later change re-introducing an automatic open is making a new decision against this requirement, not
restoring an oversight.

What PD-419 built and this requirement KEEPS: the town rung itself, the `blocked` sheet's *Set your
town* primary, and the town question for a platform with no geolocation.

#### Scenario: A screen that draws the row opens nothing by itself
- **WHEN** a rider lands on any screen carrying the question row, in any state, and does not touch it
- **THEN** no sheet SHALL open, at any delay
- **AND** this SHALL hold across a remount, a tab change and a return to the screen

#### Scenario: No component may reach the OS dialog without a gesture
- **WHEN** the device permission dialog is raised
- **THEN** the call SHALL be traceable to a rider's tap on the priming sheet's primary action
- **AND** no other module SHALL call the requesting API

### Requirement: The question row SHALL name a town only when that town is what the distances were measured from

The row SHALL ask `Still in <town>?` only where the rider's resolved position came from
`profiles.location`. In every other visible state it SHALL ask `Where do you ride from?`.

This is `near-label.ts`'s standing rule — *the name must come from the same source as the number* —
applied to a question rather than to a claim. A stored town that the geocoder cannot place produces
**no** position, so the app is measuring from nowhere while a town sits in the column; confirming
that town leaves the screen exactly as broken.

The row SHALL derive the name from the raw `profiles.location` reduced by `localityOf`, and SHALL NOT
take it from `nearLabel()`, which answers `you` for a device fix and for an unreducible city — a
label that reads `Still in you?`.

#### Scenario: A rider whose position is their town is asked about that town
- **WHEN** the resolved position's source is the profile and the town reduces to `Hoorn`
- **THEN** the row SHALL read `Still in Hoorn?`

#### Scenario: A stored town that produces no position is not confirmed
- **WHEN** `profiles.location` holds a town the geocoder cannot place, so the position is `null`
- **THEN** the row SHALL read `Where do you ride from?` and SHALL NOT name the stored town

#### Scenario: The accessible name says what tapping does
- **WHEN** the row is read by a screen reader in any visible state
- **THEN** its accessible name SHALL state the action as well as the question, since a bare question
  announces nothing about what the control does

### Requirement: Every state of the question row SHALL be decided by one pure function, including which sheet it opens

The decision SHALL take the device permission, the resolved position, the rider's raw town and
whether the row is within a dismissal interval, and SHALL return one state. The state SHALL determine
both the copy and the destination sheet, so that no caller re-derives an exclusion.

The six states are `hidden`, `ask`, `blocked`, `town`, `refine` and `confirm`. `confirm` is new and
exists so that the destination is a property of the state rather than of a second permission read
inside the component.

#### Scenario: Nothing is drawn against an unread input
- **WHEN** the permission, the position **or** the town has not settled
- **THEN** the state SHALL be `hidden`
- **AND** the town SHALL be a required input, because its absence changes which question is asked
  rather than degrading one question

#### Scenario: A rider with a live grant is not interrupted
- **WHEN** the permission reads `granted`
- **THEN** the state SHALL be `hidden`, whether the fix arrived, failed, or fell back to the town
- **AND** the route to change a stored town SHALL remain reachable from the profile's location
  setting, so this is a silence rather than a dead end

#### Scenario: A stale device fix under a revoked permission draws nothing
- **WHEN** the position is device-sourced and the permission reads `denied` or `prompt`, which the
  five-minute position memo makes reachable after a revocation in the OS settings
- **THEN** the state SHALL be `hidden`, because the state self-corrects and a question that vanishes
  five minutes later is worse than none

#### Scenario: A rider with no position is asked, by the route their platform allows
- **WHEN** the position is `null`
- **THEN** the state SHALL be `ask` for `prompt`, `blocked` for `denied` and `town` for
  `unavailable`
- **AND** each SHALL read `Where do you ride from?`

#### Scenario: A rider whose town measures their distances is asked to confirm it
- **WHEN** the position is profile-sourced
- **THEN** the state SHALL be `refine` for `prompt` and `confirm` for `denied` or `unavailable`
- **AND** `refine` SHALL open the priming sheet, whose secondary route reaches the town question
- **AND** `confirm` SHALL open the town question directly

### Requirement: A rider who has denied the permission and holds a stale town SHALL have a route that works

The exclusion that returns `hidden` for a profile-sourced position under a `denied` permission SHALL
be lifted **for the town half only**. That rider SHALL be able to correct their town from the screen
their distances are drawn on, and SHALL NOT be offered the device permission again.

The exclusion was correct while the row said *Use my location*: iOS will not re-raise its dialog for
the life of the install, so the offer was a dead end. Once the row asks about the town, the same
rider has a route that works. The same argument lifts the `unavailable` case, which is a dead end for
a different reason and was hidden by the same rule.

#### Scenario: The denied rider is asked about their town
- **WHEN** the permission is `denied`, the position is profile-sourced and the row is not quiet
- **THEN** the row SHALL draw and SHALL open the town question on a tap
- **AND** it SHALL NOT open the priming sheet, offer *Use my location*, or call the geolocation API

#### Scenario: The lift does not restore the device offer
- **WHEN** any state reached by lifting this exclusion is rendered
- **THEN** no control in it SHALL lead to the OS permission dialog

### Requirement: A dismissal SHALL keep the question quiet for a stated, lengthening interval, and acting SHALL reset it

Dismissing the question SHALL be read as *"yes, still here"*. The row SHALL then be `hidden` for
**30 days**, doubling on each consecutive dismissal — 30, 60, 120 — capped at **180 days**. The rider
acting SHALL set the consecutive count back to zero and start a fresh 30 days.

*Acting* means a town was stored through any route, or the device permission was granted. *Dismissing*
means the sheet was closed without either — including by the scrim and by Escape, so that one rule
covers every way out.

The interval quiets **every** visible state, not only the ones naming a town. The cost is recorded
rather than hidden: a rider with no position at all buys thirty days of missing distances with one
dismissal. The profile's location setting reaches the same question with no interval on it.

#### Scenario: The ladder lengthens only while the rider keeps dismissing
- **WHEN** a rider dismisses the question on consecutive appearances
- **THEN** the quiet interval SHALL be 30, then 60, then 120, then 180 days, and SHALL NOT exceed 180
- **AND** a stored count larger than the cap SHALL still yield 180 days rather than an overflow

#### Scenario: Answering resets the ladder and buys silence
- **WHEN** a rider stores a town, from the row's sheet, the profile setting or the onboarding step
- **THEN** the consecutive count SHALL return to zero and the row SHALL be quiet for 30 days
- **AND** the reset SHALL be driven by every writer of `profiles.location` — there are **two**,
  `setRiderTown` and `setHomeTown`, so there is no single writer to hang the guarantee on and each
  carries the call

#### Scenario: Removing a town is not answering the question
- **WHEN** a rider clears their stored town
- **THEN** the ladder SHALL NOT reset and no silence SHALL be bought — that rider is now in the
  state the question exists to fix, so silencing it there is the one direction that fails unsafely

#### Scenario: A grant clears the record outright
- **WHEN** the device permission is granted **and a fix comes back**
- **THEN** the dismissal record SHALL be removed, so a later revocation starts at the bottom of the
  ladder rather than in the middle of an interval
- **AND** a granted permission whose fix did NOT come back SHALL leave the record alone — nothing
  was answered, and the row is hidden by the permission rather than by the ladder

#### Scenario: A save that did not land is not a dismissal
- **WHEN** a rider closes the town sheet after a save came back refused
- **THEN** no dismissal SHALL be recorded and the row SHALL keep drawing — that rider answered the
  question and the write failed, most often offline, and charging them a rung punishes the network

#### Scenario: The interval is quiet, not gone
- **WHEN** the interval elapses and the rider still has a stale or absent town
- **THEN** the row SHALL draw again

### Requirement: The question row SHALL draw only on the screens whose numbers it explains

The row SHALL render on `/rides/explore` and `/clubs/explore` and nowhere else. The tab roots SHALL
carry only their door strip.

Two 56px rows in one slot, with the same icon, the same chevron, the same geometry and the same town
name, is what this change removes; a third caller re-creates it. The door strip renders in every
state and is the only route to the Explore screens, so nothing is lost by the roots keeping it alone.

#### Scenario: The tab roots carry one row
- **WHEN** `/rides` or `/clubs` is rendered in any position, permission or town state
- **THEN** exactly one row SHALL occupy the strip slot, and it SHALL be the door to Explore

#### Scenario: The row is not gated on a neighbouring read
- **WHEN** an Explore screen's list read is still in flight or has failed
- **THEN** the question row SHALL still render according to its own inputs
- **AND** both Explore screens SHALL place it identically, so its visibility is one decision rather
  than two

#### Scenario: The row reaches no anonymous surface
- **WHEN** a visitor with no session holds a ride invite link
- **THEN** the preview they reach SHALL NOT draw this row, which has no profile to name and no
  session to write one
