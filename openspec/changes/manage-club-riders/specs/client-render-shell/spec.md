## ADDED Requirements

### Requirement: A screen whose entire content is destructive controls SHALL define every state, and its permission-denied state SHALL be a refusal rather than an empty list

Manage riders SHALL define all seven states, and two of them differ from every other screen in this
app because the screen has no read-only value at all.

| State | Behaviour |
|---|---|
| Empty | a club with one member is the **normal** state, not an edge case. The roster draws the owner alone with no controls on them, and the requests section is **absent** rather than empty — `085`'s rule, because "no requests" on every club detail an admin opens is noise |
| Loading | gate on the **data**, never on `isLoading`: `useQuery` starts its fetch in an effect, so the first render pass has no data and no fetch in flight. A skeleton roster, not a spinner over a blank screen |
| Error | the roster read failing SHALL show a retryable error, **not** an empty roster — an empty roster on a management screen reads as "this club has nobody in it", which is a statement the screen has not verified |
| Offline | every control SHALL be disabled, never queued. Removing a rider is a promise to the rest of the club and the three RPCs are not writes to be optimistic about — `ClubJoinRequestsSection`'s existing rule, extended |
| Permission denied | A **redirect to the club**, and never an empty or read-only screen — a *Manage riders* whose every control refuses is PD-125's unreachable screen arriving from the other side. Not `notFound()`: reaching this screen means `getClub` returned a club, so the reader can already see it and the "no such club, or not one you may see" conflation has nothing left to protect |
| Partial | the roster resolving while the requests read fails SHALL render the roster and omit the requests section, matching `085`'s existing behaviour — a failed additive read draws nothing rather than an error over a screen that already rendered |
| Stale | after any successful mutation the roster, the club detail and the requests list SHALL be invalidated together; see the `client-cache-invalidation` delta |

#### Scenario: Denied is not empty
- **WHEN** an ordinary member navigates directly to the route
- **THEN** the screen SHALL not render, and the rider SHALL NOT be shown a roster with inert
  controls or an empty list
- **AND** the RPCs SHALL refuse independently, so the client gate can be wrong without the boundary
  being wrong

#### Scenario: A one-member club renders correctly rather than emptily
- **WHEN** the club has only its owner
- **THEN** the roster SHALL draw that one row with no destructive control on it, and the requests
  section SHALL be absent

#### Scenario: The screen never renders `undefined` on first paint
- **WHEN** the first render pass runs, before the effect that starts the fetch
- **THEN** the screen SHALL render its skeleton, gated on the absence of data rather than on
  `isLoading`, which is `false` at that moment

### Requirement: A destructive control SHALL name what it actually does, including when what it does is reversible

Removal SHALL be confirmed, and the confirmation SHALL state the outcome honestly rather than
implying permanence it does not have.

On a **public** club the removed rider rejoins in one tap through the existing INSERT policy, and the
confirmation SHALL say so in one clause. On a **private** club they must request again and an admin
must answer, and the confirmation SHALL NOT carry the public clause.

The confirmation SHALL NOT claim the rider is told, because they are not, and SHALL NOT claim their
content is removed, because it is not: their postcards, threads and messages stay in the club and
stay visible to it.

#### Scenario: The public and private copy differ
- **WHEN** the confirmation is shown for a public club and for a private one
- **THEN** only the public one SHALL say the rider can join again at any time

#### Scenario: The confirmation does not overstate the blast radius
- **WHEN** the confirmation is read
- **THEN** it SHALL NOT say or imply that the rider's postcards, threads or messages are removed,
  and SHALL NOT say the rider will be notified

### Requirement: A notification row whose subject cannot be reached by its ordinary embed SHALL still render completely or not at all

The `club_join_request_declined` row's `club:clubs(...)` embed returns null by construction — the
reader is not a member — so the row SHALL resolve its club through
`public.discoverable_private_clubs` before rendering, and SHALL degrade to the drawn fallback
("A club") rather than to a blank name or an id if that resolution fails.

The row SHALL take its destination from the notification's own `club_id` **column**, which the
client already holds SELECT on, rather than from the embed.

#### Scenario: The name is resolved, not left empty
- **WHEN** a decline row is rendered
- **THEN** the club's name SHALL be drawn from the accessor
- **AND** if the accessor returns nothing the row SHALL still render, with the fallback string and
  a working destination

#### Scenario: The list does not crash on a type it does not know
- **WHEN** any future notification type reaches a bundle whose `switch` has no arm for it
- **THEN** the failure mode SHALL be recorded rather than assumed benign: `describe` returns
  `undefined` today and the destructuring throws, taking the whole list down — which is why `089`
  applies **after** the build serves, and which SHALL be re-checked before any later type is added
