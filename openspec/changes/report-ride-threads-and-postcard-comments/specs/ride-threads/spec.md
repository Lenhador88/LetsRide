# Spec Delta

> **Coordination.** `ride-threads` does **not** exist in `openspec/specs/` yet — it is created by
> the active change `retire-ride-chat-for-ride-threads`, whose Q4 defers exactly the affordance this
> delta adds. This delta is **ADDED only**, so it does not depend on which change archives first and
> modifies no requirement that change wrote. Re-derive with `ls openspec/specs/`.

## ADDED Requirements

### Requirement: A crew member SHALL be able to report a ride thread, and the reportable set SHALL be exactly the readable set

A rider who can read a ride thread SHALL be able to report it. A rider who cannot read it SHALL NOT
be able to report it, and the refusal SHALL come from the audience the thread already has rather
than from a predicate restated in the report path.

Reporting SHALL be a right separate from every other right on a thread: it SHALL NOT delete the
thread, SHALL NOT hide it, SHALL NOT remove the reporter from the crew and SHALL NOT change what
anyone can see.

`retire-ride-chat-for-ride-threads` Q4 recorded the absence of this affordance as a deferral with a
named trigger — the store submission. This requirement retires that deferral; the remedies it named
in the meantime, blocking the author and leaving the crew, SHALL remain available and unchanged.

#### Scenario: A crew member reports a thread
- **WHEN** a rider on the ride's crew, who can read the thread, reports it
- **THEN** exactly one report SHALL be recorded against that thread with their own identity as
  reporter
- **AND** the thread SHALL remain readable to them and to everyone else, unchanged

#### Scenario: A rider who cannot read the thread cannot report it
- **WHEN** a rider who is not on the crew, or holds only a pending invite, or has left the crew, or
  is blocked by the thread's author, or has blocked them, attempts to report the thread
- **THEN** the report SHALL be refused
- **AND** the refusal SHALL be indistinguishable from the refusal for a thread id that does not
  exist

#### Scenario: A report is not a deletion
- **WHEN** a thread is reported
- **THEN** it SHALL still be present for the crew, including for the reporter
- **AND** the ride's organiser and the thread's author SHALL keep exactly the rights they had, and
  gain no new one

#### Scenario: A rider reporting repeatedly cannot brigade
- **WHEN** a rider reports the same thread more than once
- **THEN** only one report SHALL exist for that rider and thread
- **AND** the rider SHALL NOT see an error

### Requirement: The ride thread's ⋯ menu SHALL be structurally non-empty, and its mount gate SHALL be removed in the same change

With a report row drawn for every viewer who is not the thread's author, and a delete row drawn for
the author and for the ride's organiser, the menu SHALL hold at least one row for every viewer it
can mount for. The screen's existing conditional mount — which exists only because the menu could
otherwise open empty — SHALL therefore be removed rather than left as a condition that is silently
always true.

The predicate that decides the delete row SHALL remain a single exported expression read by both the
menu and its caller, so the two cannot disagree.

A menu row SHALL NOT be an authorization. Every row SHALL be gated on the viewer so the sheet does
not offer what the database will refuse, and a forged state SHALL reach the same refusal.

#### Scenario: A crew member who is neither author nor organiser sees a menu
- **WHEN** such a rider opens a thread they can read
- **THEN** the ⋯ menu SHALL render and SHALL offer the report row
- **AND** it SHALL NOT offer a delete row

#### Scenario: The thread's author sees delete and not report
- **WHEN** the thread's author opens the menu
- **THEN** it SHALL offer the delete row and SHALL NOT offer the report row
- **AND** the self-report the database would permit SHALL simply not be drawn

#### Scenario: The organiser sees both
- **WHEN** the ride's organiser opens the menu on somebody else's thread
- **THEN** it SHALL offer both the report row and the delete row

#### Scenario: The menu never opens empty
- **WHEN** the menu is rendered for any combination of author and organiser standing
- **THEN** at least one row SHALL render
- **AND** this SHALL be asserted directly, because it is the property that permits the mount gate's
  removal

### Requirement: Reporting a ride thread SHALL claim no cache key, and the delete path's claims SHALL be unchanged

A report changes nothing any query key holds — not the thread, not the thread list, not the unread
map, not the ride's timeline. The report action SHALL therefore invalidate nothing, and no key SHALL
be added for reports.

The existing moderation delete SHALL keep the claims it makes today, and this change SHALL NOT alter
them.

#### Scenario: A successful report refetches nothing
- **WHEN** a rider reports a thread
- **THEN** no query key SHALL be invalidated and no list SHALL refetch
- **AND** the confirmation SHALL be a banner, not a screen change

#### Scenario: The delete path is untouched
- **WHEN** a thread is deleted by its author or by the ride's organiser
- **THEN** it SHALL invalidate exactly the keys it invalidates today
