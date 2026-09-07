# anonymous-ride-preview

## ADDED Requirements

### Requirement: EXECUTE on exactly one function SHALL be the whole of the anonymous exception

`public.ride_invite_link_public_preview(t text)` SHALL be the **only** database object any client
may reach without a session. The exception SHALL be EXECUTE on that function and nothing else.

`anon` SHALL hold **no** grant on any table, no policy SHALL name `anon`, and no second function
SHALL be granted to `anon` by this change. Decision #1 is narrowed by exactly one named function
and is otherwise unchanged: `is_public = true` SHALL continue to mean "visible to any signed-in
rider" and SHALL NOT come to mean "visible to the internet" — the new function does not read
`is_public` at all.

EXECUTE SHALL be granted to **`anon` alone**, and SHALL be REVOKED from `public` and from
`authenticated`. A signed-in caller has the richer, gated `public.ride_invite_link_preview`; granting
the thin function to `authenticated` as well would create a second path to a ride's title that
**bypasses the block check and the participation gate** `private.ride_invite_link_reachable_by`
exists to apply.

#### Scenario: The grant is scoped to its grantee and asserted per role
- **WHEN** `has_function_privilege` is asked for `public.ride_invite_link_public_preview(text)`
- **THEN** it SHALL be `true` for `anon`, and `false` for `authenticated` and for `public`
- **AND** each SHALL be asserted **per grantee**, because `postgres` and `service_role` hold
  everything by Supabase default and an unscoped assertion passes for the wrong reason

#### Scenario: No table becomes readable by anon
- **WHEN** `has_table_privilege('anon', t, 'SELECT')` is evaluated for every table in `public`
- **THEN** every answer SHALL be `false`, unchanged by this change
- **AND** `anon` reading `public.rides`, `public.ride_invite_links`, `public.ride_members` or
  `public.profiles` directly SHALL return zero rows or be refused, exactly as before

#### Scenario: No policy is added, widened or renamed
- **WHEN** `pg_policies` is read after the migration applies
- **THEN** no policy SHALL name `anon`, and the `public.rides` SELECT qual SHALL be **byte-identical**
  to the string pinned before it
- **AND** `private.can_read_ride`'s `prosrc` md5 SHALL be unchanged

#### Scenario: The existing RPCs keep their grants
- **WHEN** `has_function_privilege('anon', …)` is asked for `public.ride_invite_link_preview(text)`,
  `public.claim_ride_invite_link(text)` and `public.revoke_ride_invite_link(uuid)`
- **THEN** every answer SHALL be `false`

### Requirement: The anonymous projection SHALL be a closed list, and SHALL NOT carry the meeting point

The function SHALL return a **fixed list of named columns for exactly one ride** and SHALL NOT
return `rides.*`, so that a column added to `public.rides` later is not disclosed by default.

The list SHALL be: the ride's id, `title`, `departure_at`, `rides.timezone`, and the organiser's
`username`. `timezone` is not a separate disclosure — a ride's times are wall-clock at its meeting
point, and without the zone the only fallback is the viewer's own, which is never the answer.

**It SHALL NOT return `meeting_point`, `latitude`, `longitude`, `geocode_confidence`,
`map_card_path` or `map_detail_path`**, under any circumstance and for any ride. This is the
requirement the change exists to bound: a stranger learns the town, never the doorstep.

**It SHALL NOT return `crew_count`**, any crew member's id or username, `ride_members` rows, the
ride's thread or any message, `description`, `route_description`, `start_place_id`, `club_id`,
`is_public`, the organiser's id, the organiser's avatar path, any second ride, or any column of
`profiles` beyond the organiser's username.

**A town MAY be returned when, and only when, a column holds one.** No town SHALL be derived from
`meeting_point` by truncation or parsing, from `latitude`/`longitude`, or from the organiser's
`profiles.location` — the first two are the exact meeting point in another form, and the third is
where the organiser lives rather than where the ride starts.

#### Scenario: The exact meeting point is unreachable
- **WHEN** a signed-out caller previews a live token for a ride whose `meeting_point` is a street
  address and whose coordinates are set
- **THEN** the response SHALL contain neither the `meeting_point` string nor either coordinate, in
  any field, in any encoding
- **AND** the assertion SHALL compare against the ride's **actual** stored `meeting_point` value,
  not against a fixed string, so a projection that added the column later fails red

#### Scenario: The column list is pinned rather than described
- **WHEN** the function's return signature is read from the catalogue
- **THEN** it SHALL match the closed list exactly, and a column added to it SHALL fail the assertion
- **AND** the assertion SHALL read the catalogue rather than a returned row, because a row from a
  ride with NULLs cannot distinguish "column absent" from "column empty"

#### Scenario: No roster and no count
- **WHEN** a signed-out caller previews a token for a ride with crew
- **THEN** no rider id, no username other than the organiser's, and **no count of any kind** SHALL
  be returned

#### Scenario: A token reaches exactly one ride
- **WHEN** a signed-out caller previews with a live token
- **THEN** exactly the link's own ride SHALL be reachable, and no other ride, club or rider SHALL
  become readable by any route

### Requirement: Every failure SHALL be one outcome, and the endpoint SHALL NOT become a token oracle

The function SHALL return **zero rows** and SHALL **raise nothing** for every case in which it does
not return a ride.

**A revoked link, an expired link, a link whose ride was deleted, a link whose ride has already
departed, a malformed token, and a token that never existed SHALL be indistinguishable from one
another** — same zero rows, same absence of error, same latency class. A prober SHALL learn nothing
that distinguishes "never existed" from "revoked".

The function SHALL resolve through `private.live_ride_invite_link(t)` and **nothing else**, so that
liveness keeps exactly one definition across the authenticated and anonymous paths. The anonymous
body SHALL NOT restate any liveness predicate: no `revoked_at` test, no `expires_at` test and no
`departure_at` comparison SHALL appear in it. A second definition would drift, and the copy that
drifts is always the one with no policy underneath it.

The token SHALL be compared **as text**, so a string that is not 32 hex characters matches no row
rather than raising a parse error that would confirm the token's format.

#### Scenario: Six dead states, one answer
- **WHEN** each of revoked, expired, ride-deleted, ride-departed, malformed and never-existed is
  exercised against the anonymous function
- **THEN** every call SHALL return zero rows and SHALL raise nothing
- **AND** the assertion SHALL cover all six, because a subset passes green with an oracle present in
  the state it omits

#### Scenario: Liveness is not restated in the anonymous body
- **WHEN** `prosrc` for `public.ride_invite_link_public_preview` is searched for `revoked_at`,
  `expires_at` and `departure_at`
- **THEN** none SHALL appear, and `private.live_ride_invite_link` SHALL be its only call

#### Scenario: The two previews agree about every dead token
- **WHEN** the same dead token is passed to the anonymous function and to
  `public.ride_invite_link_preview`
- **THEN** both SHALL return zero rows, for every one of the six states

#### Scenario: A departed ride is dead without a special case
- **WHEN** a signed-out caller previews a token whose ride departed an hour ago
- **THEN** zero rows SHALL be returned through the ordinary dead-token path, and no branch, message
  or state SHALL exist that is specific to a past ride

### Requirement: The function SHALL be VOLATILE, so PostgREST refuses to serve it over GET

`public.ride_invite_link_public_preview` SHALL be declared **VOLATILE** and SHALL NOT be `stable`,
even though its body performs no write and takes no lock.

**PostgREST serves a `stable` function over GET.** That would put a live capability token in the
query string of `/rest/v1/rpc/ride_invite_link_public_preview`, and therefore into the project's own
request log, into any intermediary's access log, and into the browser's history — for the one caller
in the app who is by definition unauthenticated and whose token is the entire credential. Volatile is
POST-only.

This is the same reasoning `091` recorded for the authenticated preview, reached by a different
route: there the label would have been *untrue* because its entry point may take `for share`; here it
is a **deliberate mislabel in the safe direction**, and it SHALL be recorded as such so a later
session does not "correct" it to `stable` for a query plan.

#### Scenario: The volatility is pinned in the catalogue
- **WHEN** `provolatile` is read for the function
- **THEN** it SHALL be `v`
- **AND** the reason SHALL be recorded in the function's `comment`, because the label looks wrong to
  anyone reading only the body

#### Scenario: A token never reaches a query string
- **WHEN** the client calls the function
- **THEN** the request SHALL be a POST with the token in its body

### Requirement: The function SHALL be `security definer` with an empty search path, and SHALL write nothing

It SHALL be `security definer` — there is no policy that could admit `anon` to `public.rides`, and
adding one is forbidden — and SHALL carry `set search_path = ''`, with every reference
schema-qualified.

**It SHALL perform no INSERT, UPDATE or DELETE of any kind.** No ledger row, no attempt counter, no
view record, no analytics write. An anonymous caller SHALL leave no trace in any table, which is
also the whole of this change's retention answer: **no personal data about the viewer is collected,
so none needs a window.**

It SHALL NOT be used to decide who may see anything other than the one ride its token names. A
`security definer` function deciding visibility more broadly is forbidden in this schema and stays
forbidden.

#### Scenario: The security posture is read from the catalogue
- **WHEN** `prosecdef` and `proconfig` are read for the function
- **THEN** they SHALL be `true` and `{"search_path="}` respectively
- **AND** this SHALL be asserted as a **catalogue read**, never inferred from a call that worked —
  the RLS suite runs as the table owner, for whom no barrier exists

#### Scenario: An anonymous call writes nothing
- **WHEN** a signed-out caller previews any token, live or dead, any number of times
- **THEN** no row SHALL be written to any table in `public`
- **AND** no ledger, counter or attempt table SHALL exist for this path

### Requirement: Blocking SHALL be unavailable rather than approximated, and the projection SHALL be what makes that safe

There is no `auth.uid()` on this path, so **the symmetric block check the authenticated preview
performs does not exist here and SHALL NOT be simulated.** `private.is_blocked` SHALL NOT be called
with a NULL caller, because a security-critical predicate evaluated against an argument it was not
written for is worse than an absent check that is written down.

**What makes the absence acceptable SHALL be the projection, and it SHALL be stated rather than
implied**: the returned fields are facts about a **ride**, and the only rider-identifying value among
them is the **organiser's username** — the fact the sharer disclosed by pasting that organiser's link
into a group.

**The block SHALL continue to hold everywhere it is enforceable.** A blocked rider SHALL still be
refused the claim, the crew, the thread, the meeting point and every list, because
`public.claim_ride_invite_link` remains `authenticated`-only and remains gated on
`private.ride_invite_link_reachable_by`'s `is_blocked` conjunct. Decision #2 is narrowed for this
projection alone and for no other surface.

**The participation gate SHALL be in the same position and SHALL get the same answer.** It SHALL
remain in `private.ride_invite_link_reachable_by`, governing the authenticated read and the claim; it
SHALL NOT be added to the anonymous function, where there is no caller to stamp. The threat it was
written for — an account created by calling GoTrue's `/auth/v1/signup` directly and never accepting
the terms — is not widened, because that actor reaches the thin projection anyway by not signing in.

**This is the argument for keeping the projection closed**: every field added to this function is a
field disclosed to a blocked rider and to an un-onboarded account. Widening it is a new decision
about both, not a convenience.

#### Scenario: Blocked rider, signed out, holding a token
- **WHEN** a rider the organiser has blocked signs out and previews a token they hold
- **THEN** the four fields SHALL be returned, because no identity is available to filter on
- **AND** this SHALL be recorded as the accepted residual rather than treated as a defect

#### Scenario: Blocked rider, signed in
- **WHEN** the same rider signs in and calls `public.ride_invite_link_preview`, then
  `public.claim_ride_invite_link`
- **THEN** the preview SHALL return zero rows and the claim SHALL reach its single raise site,
  unchanged by this change

#### Scenario: The anonymous body carries no caller predicate
- **WHEN** `prosrc` for `public.ride_invite_link_public_preview` is searched for `is_blocked`,
  `auth.uid`, `terms_accepted_at` and `onboarding_completed_at`
- **THEN** none SHALL appear — there is no caller for any of them to be about

#### Scenario: The authenticated path is untouched
- **WHEN** `prosrc` for `private.ride_invite_link_reachable_by` and
  `public.ride_invite_link_preview` is compared to its value before the migration
- **THEN** both SHALL be unchanged, and the anonymous function SHALL call neither

### Requirement: A club-private ride SHALL be previewed, and club membership SHALL be unobservable

A valid token SHALL preview its ride **regardless of `is_public`, `club_id` or the club's
visibility**. The organiser minted a link to that ride and shared it; the token is the decision, and
`091` already settled the identical question for the authenticated preview.

**Refusing a club-private ride would build an oracle.** If a club-private ride returned zero rows
where a public one returned a preview, the endpoint would tell any token holder which class of ride
their token names — a new signal, available anonymously, that does not exist today and that
contradicts the requirement that every failure be one outcome.

**Club membership SHALL be unobservable rather than filtered.** The projection carries no `club_id`,
no `is_public` and no club name, so there is no field to infer from and nothing for a future column
addition to leak by default.

#### Scenario: Two rides, one answer shape
- **WHEN** a signed-out caller previews a live token for a private club's ride and a live token for a
  clubless public ride
- **THEN** both SHALL return one row with the identical column list, and nothing in either response
  SHALL indicate which is which

#### Scenario: The club's name never appears
- **WHEN** a signed-out caller previews a token for a ride belonging to a private club
- **THEN** the club's name, id and visibility SHALL be absent from the response

#### Scenario: Reading the ride directly is still refused
- **WHEN** the same signed-out caller selects the ride from `public.rides` by the id the preview
  returned
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides` and the preview
  granted no policy reach

### Requirement: The token's entropy SHALL be the answer to guessing, and no per-caller ledger SHALL be built

The 128 bits behind `ride_invite_links.token` SHALL be treated as sufficient that guessing is not an
attack, on the anonymous path exactly as `091` treats it on the claim path. The function returns zero
rows and raises nothing, so it SHALL NOT be usable to enumerate valid tokens.

**No metering table, attempt ledger or lockout SHALL be built for this path**, and the reason SHALL
be recorded as structural rather than as a judgement: `069`'s `place_search_attempts` is keyed on
`user_id references public.profiles(id)` and both its ceilings are per rider, so **an anonymous
caller is not a subject a ledger can be keyed on**. The only candidate keys are an IP address or a
device fingerprint, neither of which this schema stores; storing either would add a personal-data
table with its own retention window and its own visibility decision.

`069`'s **spend** argument SHALL NOT be transferred either: it metered a paid vendor credit, and this
function calls no vendor and costs one index probe.

**Volumetric protection of an unauthenticated endpoint SHALL be Supabase's platform-level rate
limiting**, which sits in front of PostgREST and is not this schema's to implement. If a ceiling
beyond that is wanted, it SHALL be decided as its own change with its own retention answer, and SHALL
NOT be improvised into this one.

#### Scenario: A guessed token is indistinguishable from a revoked one
- **WHEN** a random 32-hex string matching no row is passed, and then a revoked token
- **THEN** both SHALL return zero rows with no error, and nothing SHALL distinguish them

#### Scenario: Repetition changes nothing
- **WHEN** the same caller previews any number of tokens in succession
- **THEN** no call SHALL be refused for a reason relating to how many came before it, and no row
  SHALL be written recording that they happened

### Requirement: The signed-out landing state SHALL render the preview and one call to action, and SHALL define every state

`/rides/join` SHALL remain in `PUBLIC_PATHS` and in `needsOnboardingState()`'s set, and
`resolveDestination` SHALL continue to answer `null` for an anonymous visitor there. **No routing
behaviour changes.**

With no session the route SHALL render the four preview fields and a **`Sign up to RSVP`** control,
replacing the generic sentence that names neither the ride nor its organiser. The token SHALL
continue to be stashed and consumed through the existing round trip, unchanged.

**The read SHALL be a different function, a different type and a different cache key from the
authenticated preview's.** A shared key would serve a signed-in rider the thin projection or cache a
stranger's row into a signed-in session; a shared or widened **type** would let a component reach for
`meeting_point` and find `undefined` where a reviewer would expect a compile error.

The route SHALL define every state:

| State | What it renders |
|---|---|
| No session, live token | The four fields and `Sign up to RSVP`. No meeting point, no crew, no map. |
| No session, no token at all | The existing generic invite copy and the sign-in / create-account controls. Unchanged. |
| Loading | A skeleton of the preview card, gated on the **data** and never on `isLoading`. |
| Dead token (any of the six) | One message: the invite link is no longer valid, plus a route onward. Identical to the signed-in wording. |
| Error (the call failed) | Distinguishable from a dead token, with a retry. A failed read is not a decided answer. |
| Offline | The cached preview if one exists, with the call to action **disabled** and stated as such. Nothing is queued — there is nothing to write. |
| Signed in | The existing authenticated preview, unchanged by this change. |

`undefined` SHALL mean "not yet" and `null` SHALL mean "decided"; only the second renders the dead
message. **Permission denied and empty SHALL NOT be conflated**: on this path there is no permission
denied — every refusal is zero rows and therefore the dead-token state, which is why the error state
must be reachable and distinct.

#### Scenario: The stranger sees the ride and not its doorstep
- **WHEN** a signed-out visitor opens a live link
- **THEN** the title, start time in the ride's own zone, and the organiser's username SHALL render
- **AND** the ride's `meeting_point` string SHALL NOT appear anywhere in the rendered document

#### Scenario: A dead token and a failed read are told apart
- **WHEN** the call errors, as opposed to returning zero rows
- **THEN** the screen SHALL offer a retry and SHALL NOT tell the visitor the link is invalid

#### Scenario: The time is the ride's, never the viewer's
- **WHEN** a visitor in another zone opens a link for a ride whose `rides.timezone` is set
- **THEN** the time SHALL render as wall-clock at the meeting point
- **AND** when `rides.timezone` is NULL the documented fallback SHALL be used, never the viewer's own
  zone

#### Scenario: The guard is unchanged
- **WHEN** an anonymous visitor reaches `/rides/join`
- **THEN** `resolveDestination` SHALL return `null`, and a rider mid-wizard SHALL still be sent to
  their resume step, exactly as before

#### Scenario: The two reads do not share a cache key
- **WHEN** `src/lib/query/keys.ts` is read
- **THEN** the anonymous preview SHALL have its own key, distinct from the authenticated preview's

### Requirement: Every role's reach into the anonymous preview SHALL be stated

Each role that can reach `public.ride_invite_link_public_preview` at all SHALL have its access
stated, including the roles that reach nothing, so that every line maps onto an assertion. An
unstated negative silently becomes whatever the migration author assumed.

Stated per role:

- **The ride's organiser** — reaches everything they already reach. This change gives them nothing
  new and takes nothing away. Their username is what an anonymous holder sees.
- **A crew member of the ride** — unchanged. Signed in, they use the authenticated preview and the
  ride itself.
- **A club admin or club member** — unchanged. The anonymous function reads no club and grants no
  club reach.
- **A non-member with no token** — reaches **nothing**. Without a token there is no call to make: the
  function takes a token and matches on it, and there is no listing, search or enumeration endpoint.
- **A blocked rider (either direction)** — signed out and holding a token, reaches the four fields;
  the block is unavailable, not skipped. Signed in, refused exactly as before. Cannot claim, in
  either state.
- **An un-onboarded account** — reaches the four fields by signing out, which is no more than any
  token holder reaches. The participation gate on the authenticated preview and on the claim is
  unchanged.
- **A signed-out visitor with a live token** — the four fields, and nothing else in the database.
- **A signed-out visitor without a token, or with a dead one** — nothing. Zero rows, no error, and
  the generic screen.

#### Scenario: A stranger with no token reaches nothing
- **WHEN** a signed-out visitor opens `/rides/join` with no token, or calls the function with an
  empty string
- **THEN** zero rows SHALL be returned and no ride SHALL be named

#### Scenario: The negative cases are asserted as `anon`, not as the owner
- **WHEN** the RLS suite exercises any of the roles above against this function
- **THEN** each assertion SHALL run under `set role anon` or `set role authenticated` as the case
  requires, and SHALL `reset role` afterwards
- **AND** an assertion left running as the table owner SHALL be treated as no assertion at all, since
  the owner faces neither a policy nor a grant
