## ADDED Requirements

### Requirement: A new notification type SHALL widen both CHECK constraints, and SHALL apply only after the bundle that knows it is serving

`notifications` SHALL gain a twelfth type, `club_waved`. Both constraints SHALL be widened in the
same migration:

- `notifications_type_check` — the type list.
- `notifications_subject_shape` — a `WHEN 'club_waved'` arm requiring `club_id IS NOT NULL` and
  `postcard_id`, `comment_id` and `ride_id` all NULL. The `ELSE false` fallthrough means a type
  added to the first list and forgotten in the second is refused by the database rather than stored
  shapeless, which is the property that makes forgetting loud.

The subject shape SHALL be **identical to `club_joined`'s**, so `notifications_event_key` collapses
a wave per `(recipient, type, actor, club)` with no new column and no ninth index.

**This migration is additive in SCHEMA and its ordering constraint is in the CLIENT.** It SHALL be
applied only **after** the bundle that knows the new type is confirmed serving — a `READY`
deployment on the merge sha with `aliasError` null — on each project independently. `notificationCopy`
and `NotificationsListItem`'s `describe` are exhaustive switches, so one `club_waved` row landing
while an older bundle is serving takes that rider's whole notifications screen down. This is `089`'s
rule, not a new one.

#### Scenario: An unknown type is refused by the database
- **WHEN** a row with a type absent from `notifications_subject_shape` is inserted
- **THEN** the insert SHALL be refused by the `ELSE false` arm
- **AND** the refusal SHALL not depend on the type list, so the two constraints cannot silently
  disagree

#### Scenario: The client is exhaustive before the type can exist
- **WHEN** `092` is applied to a project
- **THEN** `notificationCopy` and `NotificationsListItem`'s `describe` SHALL already handle
  `club_waved` in the bundle that project is serving
- **AND** the deployment SHALL have been confirmed `READY` on the merge sha before the apply

#### Scenario: A wave collapses per waver, per club
- **WHEN** one rider waves the same join, un-waves and waves again
- **THEN** at most one live `club_waved` row SHALL exist for that recipient and waver in that club
- **AND** the collapse SHALL come from `notifications_event_key`'s `nulls not distinct`

### Requirement: A welcome notification SHALL disclose no more than `club_joined` already does

The `club_waved` row carries a club and an actor and nothing else. Its copy SHALL therefore be
resolvable from the same joins the notifications list already makes, and SHALL disclose nothing a
`club_joined` row would not.

The standing requirement that *a rider SHALL NOT learn a private club's name from a notification*
applies unchanged: the club's name is resolved through the reader's own `clubs` SELECT policy, so a
recipient who cannot see the club sees no name — and, per the fan-out delta, sees no row at all.

The copy SHALL name the gesture in the app's own vocabulary. Per `design.md` §D1 the product word
is **wave**; the notification SHALL not say "liked your join", which names neither the gesture nor
anything a rider did.

#### Scenario: The club name comes from the reader's own policy
- **WHEN** a `club_waved` row's recipient can no longer see the club
- **THEN** the row SHALL be withheld from their list
- **AND** no club name SHALL be embedded in the notification row itself

#### Scenario: The copy is exhaustive and named
- **WHEN** `club_waved` is added
- **THEN** `notificationCopy` SHALL have a branch for it and the type union in `src/types/index.ts`
  SHALL carry it
- **AND** the string SHALL use the app's word for the gesture

### Requirement: A wave SHALL NOT become a push notification in this change

`deliver-push-notifications` and `078`'s `push_devices` are untouched. `club_waved` SHALL not be
added to any push delivery set.

Stated as a prohibition rather than left unmentioned: a welcome is a warm, low-stakes signal and a
push is an interruption. Adding a type to a delivery set is a one-line change that would ship a
per-signup interruption class into the Welcome club, which is the exact scale problem `058`'s
carve-out exists to prevent — arriving through a different door.

#### Scenario: No push is delivered for a wave
- **WHEN** a join is waved
- **THEN** an in-app notification SHALL be written and no push SHALL be delivered
- **AND** the decision SHALL be recorded where the delivery set is defined, so a later addition is
  deliberate
