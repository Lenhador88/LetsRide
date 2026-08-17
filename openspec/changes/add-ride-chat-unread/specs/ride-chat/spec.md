> **Why this requirement is MODIFIED rather than merely satisfied.** Its opening sentence
> enumerates the surfaces the chat epic left unbuilt, and *"unread badges"* is on that list. This
> change builds one, so the enumeration becomes false the day it ships — and a standing spec
> asserting a stale enumeration is worse than one asserting nothing.
>
> The requirement is restated **whole**, because archiving folds a delta in by replacing the
> requirement wholesale. Two scenarios are carried over unchanged and are reproduced here for that
> reason, not because anything about them moved. **No other active change carries a delta against
> any `ride-chat` requirement** — checked 2026-08-17 across `openspec/changes/*/specs/` — so this
> one needs no coordination note.

## MODIFIED Requirements

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Pin, Mute, attachments, typing indicators, presence, push and **read receipts** SHALL NOT be
rendered as disabled or non-functional controls.

**Unread state is no longer on that list**: it is built, per the `ride-chat-unread` capability, and
it was built on the terms the scenario below always set. What remains unbuilt of "read state" is the
half that faces *other* riders — whether anyone else has seen a message — and that is now a stated
refusal with a policy behind it rather than a gap.

A control that renders and does nothing is a worse artifact than an absent one — the reasoning
`RideHeader` already applies to the two buttons it omits, and the same reasoning that removed the
Inbox tab (PD-100) rather than shipping it disabled.

#### Scenario: Pin and Mute are absent, not disabled
- **WHEN** the chat screen is built
- **THEN** the header's options control SHALL be omitted rather than opening a menu whose two
  rows do nothing
- **AND** the reason SHALL be recorded: Pin orders a chat list that has not existed since the
  Inbox tab was removed, and Mute suppresses notifications that do not exist

#### Scenario: The unread badge extended the existing watermark model
- **WHEN** unread state was built
- **THEN** it extended the per-audience read watermark that already exists for the feed — one row
  per rider per audience, bounded by membership rather than by content
- **AND** it introduced no per-message read table, and is not computed by fetching every message
  and counting in the client
- **AND** the contract for it lives in `ride-chat-unread`, which owns the audience, the states and
  the negative cases; this requirement SHALL NOT restate them

#### Scenario: Read receipts are refused rather than deferred
- **WHEN** any surface would show whether another rider has read a message
- **THEN** it SHALL NOT be built
- **AND** the refusal SHALL be enforced by the watermark table's SELECT policy admitting only its
  own owner, so the data to draw one is unreachable rather than merely unused

#### Scenario: No rate limit exists and that is recorded
- **WHEN** a crew member sends messages as fast as the network allows
- **THEN** nothing SHALL stop them
- **AND** this SHALL be a stated known gap, because nothing in this app rate-limits anything and
  inventing a mechanism for one table would be the only one of its kind
