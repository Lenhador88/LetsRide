# anonymous-ride-preview Specification

## Purpose
The app's first and only anonymous read — what a signed-out visitor holding a ride invite token
sees, what they must never see, and why the exception to architectural decision #1 stops exactly
here.

**The projection is a strict subset of what `public.ride_invite_link_preview` already returns to
any holder of the same token**, which is the whole safety argument: a signed-out caller learns
strictly less than the same person learns by finishing onboarding and calling the authenticated
function with the identical string. A column added here that is not in those eight is a NEW
decision, and so is a second `anon`-executable function or any `anon` grant on a table or policy.

**Blocking and the participation gate are unavailable rather than skipped.** There is no
`auth.uid()` to test, so the anonymous reach is one conjunct — the link is live — and what makes
that safe is the projection carrying no fact about riders beyond the organiser's username.

Every requirement below is a statement about a role and a resource, so each maps onto an assertion
in `supabase/tests/`.

## Requirements

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

### Requirement: The anonymous projection SHALL be a closed list and a strict subset of the authenticated preview's

The function SHALL return a **fixed list of named columns for exactly one ride** and SHALL NOT
return `rides.*`, so that a column added to `public.rides` later is not disclosed by default.

The list SHALL be: the ride's id, `title`, `departure_at`, `rides.timezone`, `meeting_point`, and
the organiser's `username`. `timezone` is not a separate disclosure — a ride's times are wall-clock
at its meeting point, and without the zone the only fallback is the viewer's own, which is never the
answer.

**Every column SHALL also appear in `public.ride_invite_link_preview`'s projection, and that subset
relation IS the safety argument.** `091` returns eight columns — `ride_id`, `title`, `departure_at`,
`timezone`, `meeting_point`, `organizer_username`, `organizer_avatar_path`, `crew_count` — to **any
holder of the same token before they claim anything**, gated on liveness, the block check and both
participation stamps, never on membership of the ride. So the anonymous caller learns strictly less
than the same person learns by completing the onboarding wizard, and what stood in front of these
fields was friction rather than a boundary.

**A column NOT in those eight SHALL NOT be added to this function.** Such a column would be
disclosed to somebody no signed-in caller could ever have been, which is a new decision requiring
its own argument and its own negative cases — not an extension of this one.

**It SHALL NOT return `crew_count` or `organizer_avatar_path`**, although both are in `091`'s eight.
The count is a fact about riders rather than about the ride and would make the endpoint a popularity
oracle; the avatar cannot render anyway, since signing a Storage URL is `resolveAvatarUrls`' job and
`anon` holds no reach into `storage.objects`. Excluding both is what keeps the subset **strict**.

**It SHALL NOT return `latitude`, `longitude`, `geocode_confidence`, `map_card_path` or
`map_detail_path`** — not because they are more sensitive than `meeting_point`, but because `091`
does not return them either and a human reading an invite needs a place, not a machine-readable pin.

**It SHALL NOT return** any crew member's id or username, `ride_members` rows, the ride's thread or
any message, `description`, `route_description`, `start_place_id`, `club_id`, `is_public`, the
organiser's id, any second ride, or any column of `profiles` beyond the organiser's username.

#### Scenario: The meeting point is returned, and it is the ride's own
- **WHEN** a signed-out caller previews a live token for a ride whose `meeting_point` is a street
  address
- **THEN** the response SHALL carry that ride's stored `meeting_point`, unmodified and untruncated
- **AND** the assertion SHALL compare against the value read back from the `rides` row, never
  against a fixed string, so a projection that drops the column, returns NULL, mangles it or
  returns another ride's value fails red
- **AND** neither coordinate, `geocode_confidence`, nor either map path SHALL appear in any field

#### Scenario: The projection is inside the authenticated projection
- **WHEN** the return signatures of `public.ride_invite_link_public_preview` and
  `public.ride_invite_link_preview` are read from the catalogue
- **THEN** every column name of the first SHALL appear in the second
- **AND** the assertion SHALL be verified both ways — green as specified, and red when a column not
  in the authenticated eight is added to the anonymous function

#### Scenario: The column list is pinned rather than described
- **WHEN** the function's return signature is read from the catalogue
- **THEN** it SHALL match the closed list exactly, and a column added to it SHALL fail the assertion
- **AND** the assertion SHALL read the catalogue rather than a returned row, because a row from a
  ride with NULLs cannot distinguish "column absent" from "column empty"

#### Scenario: No roster, no count and no avatar
- **WHEN** a signed-out caller previews a token for a ride with crew
- **THEN** no rider id, no username other than the organiser's, no avatar path, and **no count of
  any kind** SHALL be returned
- **AND** this SHALL be asserted against a ride that genuinely has crew, since a ride with none
  cannot tell an absent count from a zero

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

### Requirement: The function SHALL be VOLATILE, and the label SHALL NOT be relied on to force POST

`public.ride_invite_link_public_preview` SHALL be declared **VOLATILE** and SHALL NOT be `stable`,
even though its body performs no write and takes no lock.

**The reason `091` recorded for the same label is false on this deployment, and this requirement
records the measurement rather than repeating it.** `091`'s comment, `docs/reference/schema.md` and
this change's own `design.md` D3 all state that PostgREST serves a `stable` function over GET while a
volatile one is POST-only, so the label is what keeps a live capability token out of a query string.
Probed against DEV on 2026-09-08 with the publishable key alone:

```
GET /rest/v1/rpc/ride_invite_link_public_preview?t=<live token>   ->  200, the full six-column row
GET /rest/v1/rpc/ride_invite_link_preview?t=<live token>          ->  401 / 42501 permission denied
```

The second is the control: it is a **privilege** error raised at execution, not a `405`, so the
method is not what stops it. **A volatile function is served over GET here.**

**What actually keeps the token out of the URL is the client.** `supabase-js`'s `.rpc()` issues a
POST and `src/lib/data/` is its only caller. Nothing in the database enforces it, and a later
session that believes the label does will be wrong in the dangerous direction — it would read
"volatile is POST-only" and conclude the URL is safe to hand out.

The label nonetheless SHALL stay, for two reasons that survive: it is the safe default for the app's
only unauthenticated surface, and it matches `091`'s three RPCs, one of which
(`claim_ride_invite_link`) genuinely requires it because `for share` is refused outright in a
non-volatile function.

#### Scenario: The volatility is pinned in the catalogue
- **WHEN** `provolatile` is read for the function
- **THEN** it SHALL be `v`
- **AND** the function's `comment` SHALL state that the label does **not** force POST on this
  deployment, so a later session does not read it as a guarantee

#### Scenario: A token in a query string is refused by nothing in the database
- **WHEN** the endpoint is called by GET with the token in the query string
- **THEN** it SHALL answer `200` — this is stated as an asserted fact rather than a defect to fix,
  because the entropy of the token is what bounds the endpoint (see *Guessability*), and the app
  itself SHALL only ever reach it through `supabase-js`'s POST

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

**The anonymous reach SHALL be one conjunct: the link is live.** `private.live_ride_invite_link` is
the whole of it. There is no `auth.uid()` on this path, so **the symmetric block check and both
participation stamps the authenticated preview applies do not exist here and SHALL NOT be
simulated.** `private.is_blocked` SHALL NOT be called with a NULL caller, because a security-critical
predicate evaluated against an argument it was not written for is worse than an absent check that is
written down.

**The consequence SHALL be stated plainly rather than left to be discovered: a rider the organiser
has blocked, holding a token, can sign out and read all five fields — including the ride's meeting
point.** That is the accepted residual of this change and it SHALL be recorded as a decision, not
treated as a defect.

**What makes it acceptable SHALL be stated rather than implied.** The returned fields are facts
about a **ride**; the only rider-identifying value among them is the **organiser's username**, which
the sharer disclosed by pasting that organiser's link into a group; and the reach belongs to the
**URL**, not to the rider — every other holder of the same link reaches exactly the same five
fields. A block cannot withdraw a URL from somebody who already has it, and this specification SHALL
NOT imply that it can.

**The block SHALL continue to hold everywhere it is enforceable, which is everywhere actionable.** A
blocked rider SHALL still be refused the claim, the crew, the thread, the photos, every message and
every list, because `public.claim_ride_invite_link` remains `authenticated`-only and remains gated on
`private.ride_invite_link_reachable_by`'s `is_blocked` conjunct. They SHALL reach no other ride of
that organiser and no part of their profile. Decision #2 is narrowed for **this projection alone**
and for no other surface.

**No mitigation SHALL be invented for the residual.** In particular the function SHALL NOT refuse a
preview because the ride's organiser or the link's creator holds any block: that would leak the
existence of a block to every unrelated stranger holding the link, make a public surface vary with a
private fact, and still not stop the blocked rider, who reaches the same five fields from any other
copy of the URL.

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
- **THEN** all five fields SHALL be returned, **including the ride's `meeting_point`**, because no
  identity is available to filter on
- **AND** the assertion SHALL be written to pass for exactly that reason, so a later session reading
  a green suite finds the accepted residual recorded rather than an accident

#### Scenario: Blocked rider, signed in
- **WHEN** the same rider signs in and calls `public.ride_invite_link_preview`, then
  `public.claim_ride_invite_link`
- **THEN** the preview SHALL return zero rows and the claim SHALL reach its single raise site,
  unchanged by this change
- **AND** they SHALL join nothing, reach no crew, no thread and no message, so the block still holds
  everything actionable

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

### Requirement: The signed-out landing state SHALL render the preview and one call to action, and SHALL define every state on the anonymous path

`/rides/join` SHALL remain in `PUBLIC_PATHS` and in `needsOnboardingState()`'s set, and
`resolveDestination` SHALL continue to answer `null` for an anonymous visitor there. **No routing
behaviour changes.**

With no session the route SHALL render the five preview fields and a **`Sign up to RSVP`** control,
replacing the generic sentence that names neither the ride nor its organiser. The token SHALL
continue to be stashed and consumed through the existing round trip, unchanged.

**The read SHALL be a different function, a different type and a different cache key from the
authenticated preview's.** A shared key would serve a signed-in rider the thin projection or cache a
stranger's row into a signed-in session; a shared or widened **type** would let a component reach for
`crew_count` or `organizer_avatar_path` and find `undefined` where a reviewer would expect a compile
error.

**This table is the seven states reachable on the ANONYMOUS path**, where every signed-in case
collapses into one row. The route's full eight-state set, which splits that row and adds
`Already claimed`, is the `ride-invite-links` delta's — the two SHALL agree wherever they overlap,
and neither is a subset of the other by accident:

| State | What it renders |
|---|---|
| No session, live token | The five fields and `Sign up to RSVP`. No crew, no count, no avatar, no map. |
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

#### Scenario: The stranger sees what the sharer disclosed
- **WHEN** a signed-out visitor opens a live link
- **THEN** the title, the start time in the ride's own zone, the ride's `meeting_point` and the
  organiser's username SHALL render, with a `Sign up to RSVP` control
- **AND** the rendered `meeting_point` SHALL be compared against the ride's stored value rather than
  a literal, so a screen that drops or truncates it fails red
- **AND** no crew member, no crew count, no avatar, no map tile and no club SHALL appear anywhere in
  the rendered document, from any source including a cache

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

### Requirement: The grant SHALL follow the bearer token and SHALL NOT follow `is_public`

**A public ride opened WITHOUT a token SHALL show a signed-out visitor nothing.** The function takes
a token, matches on it, and **SHALL NOT read `is_public`, `club_id` or any visibility class**. There
SHALL be no ride-id parameter, no listing, no search and no enumeration endpoint reachable by `anon`,
so a signed-out visitor holding no token has no call to make.

`is_public = true` SHALL therefore continue to mean **"visible to any signed-in rider"** and SHALL
NOT come to mean "visible to the internet". The exception this change introduces is a **credential**,
not a visibility class, and the distinction SHALL be asserted rather than left to follow from the
function signature — a signed-out visitor is never *granted* anything in the general case, so the
one place they are must have its boundary written down.

#### Scenario: A public ride without a token is invisible
- **WHEN** a signed-out visitor knows the id of a ride with `is_public = true` and no live invite
  link, and attempts to reach it by any route available to `anon`
- **THEN** nothing SHALL be returned: `public.rides` gives zero rows, and no function accepts a ride
  id
- **AND** the same SHALL hold for a club-private ride, so the two are indistinguishable here too

#### Scenario: The function never consults the visibility class
- **WHEN** `prosrc` for `public.ride_invite_link_public_preview` is searched for `is_public` and
  `club_id`
- **THEN** neither SHALL appear

#### Scenario: A dead token is exactly a missing token
- **WHEN** a signed-out visitor opens the route with an empty token, a malformed one, or one that
  matches nothing
- **THEN** they SHALL see the generic invite copy and the sign-in / create-account controls, and no
  ride SHALL be named

### Requirement: The signed-out preview page SHALL declare `noindex, nofollow`

The route SHALL emit a robots directive of **`noindex, nofollow`** when it can be rendered without a
session, and this SHALL be a stated requirement with its own assertion rather than a property
inherited from something else.

**The reason it must be stated:** until this change every route but `/auth/*` and `/legal/*` required
a session, so a crawler fetching anything received a shell with no data in it. **That was an accident
of the authenticated wall**, and this change removes the wall from exactly one screen. A property
that held for another reason stops holding silently.

**The exposure SHALL be described accurately rather than assumed.** The token is 32 random hex
characters, there is no link to `/rides/join?token=…` anywhere in the app or on the marketing site,
so a crawler cannot walk to a preview and guessing is not an attack. **Note that the endpoint being
POST-only is NOT part of that argument** — it is not POST-only, per the VOLATILE requirement above;
the entropy of the token is what carries it.
The case the directive answers is a **link somebody published** — a public forum, an indexed shared
document, a chat export — where one URL would otherwise become a permanently searchable page naming
a ride, its time and its meeting point long after the link itself expired. The directive SHALL NOT
be presented as a substitute for the token's entropy; they answer different attacks.

#### Scenario: The directive is present on the signed-out render
- **WHEN** the signed-out landing route is rendered
- **THEN** the document SHALL carry `noindex, nofollow`
- **AND** this SHALL be asserted where the document actually exists — the walk's signed-out phase —
  rather than inferred from a metadata export

#### Scenario: The directive does not depend on the token being live
- **WHEN** the route is opened with a dead token, no token, or a live one
- **THEN** the directive SHALL be present in every case, so it cannot be lost in the state that
  renders the ride

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
- **A non-member with no token** — reaches **nothing**, and this holds whether the ride is public or
  club-private. Without a token there is no call to make: the function takes a token and matches on
  it, and there is no listing, search or enumeration endpoint.
- **A blocked rider (either direction)** — signed out and holding a token, reaches all five fields
  **including the meeting point**; the block is unavailable, not skipped, and this is the accepted
  residual. Signed in, refused exactly as before. **Cannot claim, in either state**, and reaches no
  crew, thread, message, list or other ride of that organiser.
- **An un-onboarded account** — reaches the five fields by signing out, which is no more than any
  token holder reaches and strictly less than they reach by finishing the wizard. The participation
  gate on the authenticated preview and on the claim is unchanged.
- **A signed-out visitor with a live token** — the five fields, and nothing else in the database.
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
