# ride-invite-links

> **The base text is the standing capability at `openspec/specs/ride-invite-links/spec.md`.**
> PD-359 archived `share-a-ride-invite-link` on 2026-09-08 (#439), which is what promoted it there;
> the ordering that story existed to protect is satisfied and this delta attaches cleanly.

## MODIFIED Requirements

### Requirement: A live token SHALL buy exactly three RPC calls and no policy reach

Holding a token SHALL permit calling **three** functions and no others:

| Function | Granted to | What it answers |
|---|---|---|
| `public.ride_invite_link_preview(t)` | `authenticated` only | The eight-column preview, gated on liveness **and** the caller. |
| `public.claim_ride_invite_link(t)` | `authenticated` only | Joins the caller to the link's ride. |
| `public.ride_invite_link_public_preview(t)` | **`anon` only** | Six columns — five data fields plus the ride id — gated on liveness alone, because there is no caller. |

It SHALL NOT grant, widen or bypass any row-level policy. **This change SHALL add no audience arm to
`public.rides`, and SHALL NOT modify `private.can_read_ride`** — the same pin `091` set for itself,
re-proved rather than assumed to have survived.

`public.ride_invite_link_preview` SHALL be **unmodified**: the same eight named columns — ride id,
title, `departure_at`, `timezone`, `meeting_point`, the organiser's username, the organiser's avatar
path, and a crew **count** — the same grant, and the same single entry point through
`private.ride_invite_link_reachable_by`. **It SHALL NOT be granted to `anon`**, because two of that
helper's three conjuncts are statements about a caller who does not exist anonymously, and evaluating
`is_blocked(NULL, organizer)` is not a loosened check but a security-critical predicate applied to an
argument it was never written for.

`public.ride_invite_link_public_preview` SHALL be a **separate, thinner function**, returning ride id,
title, `departure_at`, `timezone`, `meeting_point` and the organiser's username, and resolving
through `private.live_ride_invite_link(t)` alone. **Every column it returns SHALL also be returned
by `public.ride_invite_link_preview`** — the anonymous projection is a strict subset of the
authenticated one, which is what makes its disclosure argument checkable in one comparison. It SHALL
NOT return coordinates, a map path, a crew count, an avatar path, a club, or `is_public`. **Both
preview functions SHALL be fixed column lists in SQL and neither SHALL return `rides.*`.**

`public.claim_ride_invite_link` SHALL remain `authenticated` only. **Nothing anonymous SHALL write
anything**: the preview is the whole of the anonymous surface, and joining a ride stays a signed-in
act gated on the block check and both participation stamps.

#### Scenario: The preview discloses no roster
- **WHEN** a token holder previews a ride with crew
- **THEN** the authenticated preview SHALL return a count and no rider id or username of any crew
  member, and the anonymous preview SHALL return **no count either**

#### Scenario: A token reaches exactly one ride
- **WHEN** a token holder previews or claims, by either preview
- **THEN** exactly the link's own `ride_id` SHALL be reachable, and no other ride SHALL become
  readable by any route

#### Scenario: The ride policy is untouched
- **WHEN** `pg_policy` is read for `public.rides` SELECT after this change applies
- **THEN** its qual SHALL be byte-identical to the string the suite pinned before it, and
  `private.can_read_ride`'s `prosrc` SHALL be unchanged

#### Scenario: The anonymous grant reaches one function and no other
- **WHEN** `has_function_privilege('anon', …, 'EXECUTE')` is asked for all four ride-invite-link
  functions
- **THEN** it SHALL be `true` for `ride_invite_link_public_preview` alone, and `false` for
  `ride_invite_link_preview`, `claim_ride_invite_link` and `revoke_ride_invite_link`

#### Scenario: The thin preview is not a second door for a signed-in rider
- **WHEN** `has_function_privilege('authenticated', 'public.ride_invite_link_public_preview(text)',
  'EXECUTE')` is evaluated
- **THEN** it SHALL be `false`, so a blocked or un-onboarded signed-in rider cannot route around
  `private.ride_invite_link_reachable_by` by calling the thin function instead

#### Scenario: A token does not open the chat before a claim
- **WHEN** a token holder who has not claimed reads `ride_messages` for that ride, signed in or out
- **THEN** zero rows SHALL be returned, because `private.is_ride_crew` is untouched by this change

### Requirement: Every dead token SHALL be indistinguishable from every other, and from a guess

`public.ride_invite_link_preview` **and `public.ride_invite_link_public_preview`** SHALL return **zero
rows** for every non-live case, and SHALL NOT raise. `public.claim_ride_invite_link` SHALL have **one
raise site**, with one message and one SQLSTATE, reached by every non-live case.

**Both previews SHALL resolve liveness through `private.live_ride_invite_link` and nowhere else**, so
that the anonymous path cannot come to disagree with the authenticated one about which tokens are
dead. Neither preview body SHALL contain a `revoked_at`, `expires_at` or `departure_at` test.

The anonymous preview SHALL be reachable without a session, so its dead states are the ones a prober
can exercise cheaply. Revoked, expired, ride deleted, ride departed, malformed and **never existed**
SHALL be one outcome there, with nothing distinguishing them — **including nothing that distinguishes
"never existed" from "revoked"**.

#### Scenario: An expired token
- **WHEN** a token whose `expires_at` has passed is previewed or claimed
- **THEN** the preview SHALL return zero rows and the claim SHALL raise the single error
- **AND** no `ride_invites` row and no `ride_members` row SHALL be written

#### Scenario: A revoked token
- **WHEN** a token whose `revoked_at` is not NULL is previewed or claimed
- **THEN** the outcome SHALL be identical to the expired case, by inspection of both the message
  and the SQLSTATE

#### Scenario: A token for a deleted ride
- **WHEN** the ride is deleted and its token is then presented
- **THEN** the link row SHALL already be gone by cascade, and the outcome SHALL be identical to a
  token that never existed

#### Scenario: A token for a ride that has already departed
- **WHEN** `now()` is past the ride's `departure_at` and the token is presented
- **THEN** the outcome SHALL be identical to the expired case, **including** where `expires_at` is
  still in the future because the ride was moved earlier

#### Scenario: A malformed or guessed token
- **WHEN** a string that is not 32 hexadecimal characters, or is well-formed but matches no row,
  is presented
- **THEN** the outcome SHALL be identical to every case above
- **AND** the claim SHALL NOT raise a different error for a malformed string than for an unmatched
  one, since a distinct parse error confirms the token format to a prober

#### Scenario: A blocked rider, block in either direction
- **WHEN** a rider who has blocked the organizer, or whom the organizer has blocked, presents a
  live token
- **THEN** the preview SHALL return zero rows and the claim SHALL raise the single error
- **AND** the block SHALL be checked in `private.ride_invite_link_reachable_by`, since a
  `security definer` function has no policy beneath it to carry decision #2
- **AND** no `ride_invites` row SHALL be written before the check, so no residue remains that a
  later unblock could activate
- **AND** this SHALL remain a statement about the **authenticated** preview and the claim; the
  anonymous preview has no caller to test, which the `anonymous-ride-preview` capability states in
  full

#### Scenario: Blocking is checked in both directions by one call
- **WHEN** the block check is written
- **THEN** it SHALL use `private.is_blocked`, which is symmetric, and SHALL NOT test a directional
  `blocks` row

#### Scenario: A rider without both consent stamps
- **WHEN** a rider whose `terms_accepted_at` or `onboarding_completed_at` is NULL presents a live
  token to the **preview**
- **THEN** zero rows SHALL be returned, indistinguishably from every case above

#### Scenario: The anonymous preview is not a token oracle
- **WHEN** a signed-out caller passes, in turn, a revoked token, an expired token, a token whose ride
  was deleted, a token whose ride has departed, a malformed string, and a random 32-hex string that
  never existed
- **THEN** all six SHALL return zero rows with no error, and the responses SHALL be indistinguishable

#### Scenario: Both previews agree about a dead token
- **WHEN** the same dead token is given to both preview functions
- **THEN** both SHALL return zero rows, for every dead state

### Requirement: The landing route SHALL be public, SHALL show only what the sharer disclosed, and SHALL define every state

`/rides/join` SHALL remain in **both** `PUBLIC_PATHS` and `needsOnboardingState()`'s set in
`src/lib/auth/guard.ts`, for the reasons the base requirement gives — the first is the deliberate
opening, the second is what stops a newly signed-up rider being parked on the preview with no route
into the wizard. **Neither set changes and no routing behaviour changes.**

The token SHALL remain a **query parameter, not a path segment**, because the route tree is shared
between the web and native builds and a `[token]` segment would require `generateStaticParams` under
`CAPACITOR_BUILD=1`.

**With no session the route SHALL render the ride's title, its start time in the ride's own zone, its
meeting point, and the organiser's username, plus a `Sign up to RSVP` control.** It SHALL call
`public.ride_invite_link_public_preview` and **no other RPC**.

**It SHALL NOT render the ride's coordinates, its map, its crew, a crew count, its club, or whether
it is club-private** — from any source, including a cache left by a previous session. The rule the
base requirement stated as *"SHALL NOT render the ride's title, date, meeting point, organizer or
crew count"* is **narrowed to its last two**, and narrowed deliberately: this is the app's only
anonymous read and its boundary is the projection, not the screen.

**The meeting point is rendered because it is already disclosed to this audience.**
`public.ride_invite_link_preview` returns it to any holder of the same token before they claim
anything, gated on the participation stamps rather than on ride membership — so what stood between a
link recipient and the meeting point was the onboarding wizard, which is friction and not a
boundary.

**The `guard.ts` comment beside `RIDE_JOIN_PATH` SHALL be corrected in the same change.** It reads
*"It is public so it can HOLD a credential, never so it can SHOW anything"*, which becomes false the
day this ships; a comment asserting the opposite of the code is worse than no comment.

The route SHALL define all eight states — the base requirement's seven, plus the signed-out preview
this change adds:

| State | What it renders |
|---|---|
| No session, live token | Title, start time, meeting point, organiser, `Sign up to RSVP`. Nothing else. |
| No session, dead or absent token | The generic invite copy and the sign-in / create-account controls. |
| Loading | A skeleton of the preview card. Gated on the **data**, never on `isLoading`. |
| Live token, signed in | The existing eight-column preview and one `Join this ride` control. Unchanged. |
| Dead token (any of the six) | One message: the invite link is no longer valid. Plus a route to `/rides`. Identical signed in and out. |
| Error (the RPC failed) | Distinguishable from a dead token, with a retry. A failed read is not a decided answer. |
| Offline | The cached preview if one exists, with the control **disabled** and stated as such — a claim is a write and SHALL NOT be queued. |
| Already claimed | The preview with the control replaced by a route to the ride. Signed in only. |

`undefined` SHALL mean "not yet" and `null` SHALL mean "decided"; only the second renders the dead
message.

#### Scenario: A visitor with no session sees the ride, and nothing about its riders
- **WHEN** a signed-out visitor opens a live link
- **THEN** the title, the start time in the ride's own zone, the ride's stored `meeting_point` and
  the organiser's username SHALL render
- **AND** the meeting point SHALL be asserted against the ride's **actual stored value** rather than
  a literal, so a projection that drops or mangles it fails red
- **AND** the ride's coordinates, its map, its crew, any count, and its club SHALL NOT be rendered
  from any source, including a cache
- **AND** only `public.ride_invite_link_public_preview` SHALL be called

#### Scenario: A dead token and a failed read are told apart
- **WHEN** the preview RPC errors, as opposed to returning zero rows
- **THEN** the screen SHALL offer a retry and SHALL NOT tell the rider the link is invalid

#### Scenario: The guard, with no session
- **WHEN** an anonymous visitor reaches `/rides/join`
- **THEN** `resolveDestination` SHALL return `null` — they stay, because the route is public and the
  page must mount to stash the token

#### Scenario: The guard, session with onboarding incomplete
- **WHEN** a rider with a session and no completion stamp reaches the landing route
- **THEN** `resolveDestination` SHALL return their resume step, per decision #5
- **AND** this SHALL remain asserted in `src/lib/auth/__tests__/guard.test.ts`, because it holds only
  while `/rides/join` is in `needsOnboardingState()`'s set

#### Scenario: The guard, session with onboarding complete
- **WHEN** an onboarded rider reaches the landing route
- **THEN** `resolveDestination` SHALL return `null` and the authenticated preview SHALL render

#### Scenario: The stash is consumed after the wizard, not abandoned at /postcards
- **WHEN** a rider completes onboarding with a token stashed
- **THEN** the screen they land on SHALL consume the stash and return them to `/rides/join`

#### Scenario: The walk exercises the signed-out route
- **WHEN** `npm run walk` runs with fixtures
- **THEN** it SHALL open `/rides/join` with a live token **signed out**, assert the title renders, and
  assert the ride's stored `meeting_point` string is **present** in the document
- **AND** it SHALL assert the crew count and the club name are **absent**, so the phase fails red if
  the projection widens past the five columns rather than only if it narrows
