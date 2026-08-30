> **Ordering note.** `club-join-requests` is **not yet a standing capability** — it is a delta in
> `openspec/changes/show-private-clubs-and-request-to-join/`, which is unarchived and sits on this
> same branch. The requirements below are written as ADDED against the capability that change
> establishes, so `show-private-clubs-and-request-to-join` SHALL be archived **before** this change.
> `tasks.md` 9.3 carries that step. Archiving in the other order folds out a standing spec saying
> *"there SHALL be no `club_join_request_declined` type"* that the shipped code already contradicts.

## ADDED Requirements

### Requirement: The `Clear` control on a declined request SHALL exist, and it SHALL be the only route by which a refusal is lifted

`085`'s DELETE policy already admits `private.is_club_admin(club_id)` against a row in any status,
and shipped with **no surface for it** — deliberately, naming PD-326 as its owner. This change
builds it: a `Clear` control on each declined row in the club's request list, on the Manage riders
screen.

The requester SHALL remain unable to clear their own refusal. `085`'s DELETE arm for them is scoped
to `status = 'pending'`, the table holds no UPDATE grant or policy for anyone, and the unique key
refuses a second insert with `23505`. **A `no` means no, it does not expire, and only the club lifts
it.**

Without this control a declined rider can never ask again, which makes the refusal permanent by
accident rather than by design — the state `085` shipped and named.

#### Scenario: An admin clears a declined row and the rider may ask again
- **WHEN** an owner or admin clears a `declined` row
- **THEN** the row SHALL be gone and a fresh `INSERT` by that rider SHALL succeed, admitted by
  `private.club_takes_join_requests`

#### Scenario: The requester still cannot clear it
- **WHEN** the requester attempts to delete their own `declined` row
- **THEN** it SHALL match zero rows and report success, disclosing nothing — unchanged from `085.15`

#### Scenario: An ordinary member sees no requests at all
- **WHEN** a member who is neither owner nor admin reads `club_join_requests` for their own club
- **THEN** they SHALL receive **zero** rows, in every status, including their own club's

### Requirement: The request surface SHALL move rather than duplicate, and its entrance SHALL survive the move

`ClubJoinRequestsSection` SHALL be removed from the club detail page and mounted on the Manage riders
screen, reusing `queryKeys.clubs.joinRequests(clubId)` and `getClubJoinRequests` unchanged. A second
list of the same rows SHALL NOT be created.

**The at-a-glance prompt SHALL NOT be reintroduced as a badge**, because it was never the discovery
surface: `085`'s fan-out writes a `club_join_requested` notification to every owner and admin on
every request, and `ClubJoinRequestActions` already puts Approve and Decline on that row. The
notification is the entrance, and the screen is where the queue lives.

#### Scenario: Neither surface is lost
- **WHEN** a request arrives
- **THEN** every owner and admin SHALL receive a notification carrying Approve and Decline, and the
  same request SHALL appear on the Manage riders screen
- **AND** answering it on either surface SHALL clear it from both

#### Scenario: The screen is not unreachable
- **WHEN** an owner or admin opens the club's options menu
- **THEN** a `Manage riders` row SHALL be present — the entrance PD-125's defect existed for the
  want of

### Requirement: A declined rider SHALL be told, through a notification whose absence `085` recorded as deliberate

`085`'s header states there is no decline notification and that a later session will want to "fix"
it. **The product owner has asked for it (PD-335, 2026-08-28), and the fix is neither of the two
shapes that header warned against.** It is not a subject-less type — `club_id` stays set, so nothing
collapses under `nulls not distinct` — and it is not an unconditional widening of `036` §3's club
conjunct.

`decline_club_join_request`'s comment and `085`'s header both claim no notification is written, and
both SHALL be restamped by `089` rather than left contradicting the database (`028`, `033`: the
comment is the `data` agent's first read and no edit to `CLAUDE.md` reaches it).

#### Scenario: The decline writes exactly one row, to exactly one rider
- **WHEN** `decline_club_join_request` succeeds
- **THEN** exactly **one** `notifications` row SHALL be written, addressed to the requester
- **AND** **zero** rows SHALL be written to the club's admins or owner
- **AND** `085.26`'s assertion of the zero SHALL be **replaced**, not deleted — its new form asserts
  the one and asserts that the recipient is the requester

#### Scenario: The requester reads it, and the request row is still the record
- **WHEN** the requester loads their notifications
- **THEN** the decline SHALL be returned and counted
- **AND** their `club_join_requests` row SHALL still say `declined` with `responded_at` set, so the
  reduced club screen `085` built continues to work unchanged and is not replaced by the
  notification

#### Scenario: The stale comments are restamped
- **WHEN** the comments on `public.decline_club_join_request` and
  `public.club_join_requests` are read after `089`
- **THEN** neither SHALL still claim that a decline writes no notification
