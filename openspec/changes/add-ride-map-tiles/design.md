# Design decisions — ride map tiles

Decisions taken while writing the contract, with the reasoning that would otherwise be
re-derived. The provider, the architecture and the two zooms were decided by the product owner on
2026-08-09 and are recorded here as constraints rather than reopened.

## D1 — The tile's audience is the ride's audience, exactly

The instinct after `034` is to reach for `private.is_ride_crew`. That would be wrong here, and the
distinction is worth stating once so it is not re-litigated per surface:

| | `ride_messages` (`034`) | `ride-maps` (this change) |
|---|---|---|
| What the child holds | Content the crew authored, which the parent does not contain | A rendering of `meeting_point`, a column of the parent |
| Is it already shown to the parent's audience? | No — the chat exists nowhere else | **Yes** — `RideCard` and `RideMap` print the address as text today |
| Correct audience | Narrower: intersection of ride visibility and crew | **Equal**: whoever can read the ride |
| Correct policy shape | `EXISTS(rides)` **AND** the narrowing helper | Bare `EXISTS(rides)` |

The half of `034`'s lesson that transfers is about the *mechanism*, not the shape: the `EXISTS`
must run under the caller's own RLS, and a `security definer` helper must never be the condition
that decides visibility. That holds in both columns of the table.

**The test that tells them apart, for the next surface:** does the child contain information the
parent's audience cannot already obtain from the parent? If yes, it may need its own narrower
audience. If it is a rendering, a derivative or a projection of the parent's own columns, its
audience is the parent's and narrowing it only hides a picture of something the rider is reading.

## D2 — The Storage write uses the caller's forwarded JWT

The open question this proposal was asked to close. **Landed on: forwarded JWT, no service-role
key.**

The path checked in order, and the three facts that had to hold:

1. **Can the upload be a policy?** Yes. The five existing folders' INSERT policies are
   `bucket_id = 'media' AND foldername[1] = '<folder>' AND foldername[2] = auth.uid()::text` plus a
   filename regex, and `ride-maps` takes that shape unchanged. The organizer writing their own
   ride's tile needs no permission the app does not already grant for an avatar.
2. **Can the column write be a policy?** Yes — **conditionally**, and the condition was missed on
   the first pass. `rides` carries a **table-level** grant to `authenticated` (`relacl` =
   `arwdDxtm`, `attacl` empty on every column, measured 2026-08-09), so the new columns arrive
   writable. But the UPDATE policy has **two arms**, and quoting only the first is what hid the
   hole:

   ```sql
   -- Organizers update their own rides, within their own clubs
   USING      (auth.uid() = organizer_id)
   WITH CHECK ((auth.uid() = organizer_id)
               AND ((club_id IS NULL) OR private.is_club_member(club_id)))
   ```

   `WITH CHECK` re-evaluates club membership on every update, including one touching only the map
   columns, and **nothing clears `rides.club_id` when a rider leaves a club** — measured
   2026-08-09, `club_members` carries only `enforce_participation_gate` and `notify_club_joined`.
   An organizer who left the club their ride sits in can read the ride and upload the objects and
   still have the column write refused. §D8 is the ordering that keeps that from costing money and
   leaving litter.
3. **Will the bucket accept it?** Only as JPEG. `media` is private with
   `allowed_mime_types = ['image/jpeg']` and a 5 MB ceiling. A PNG upload fails at the bucket,
   above every policy, with nothing in the policy set to explain it — which is why the tile is
   requested as JPEG and why the spec records the rejection as bucket-level.

**Why this is worth the effort rather than reaching for the key that already exists in
`delete-account`.** A service-role client can do anything to any row. The property that matters is
not "we were careful", it is that a confused function *cannot* exceed its caller — no ride id in a
request body can make it act on a ride the caller cannot already edit. Decision #8 lists forwarding
the user's JWT as its second reading and this is the first thing in the repo that actually needs
it.

**What it costs, recorded because it is not free:**

- **No backfill, ever, without reopening this.** Nothing is entitled to render a ride it does not
  organise. Existing rides get a tile when their organizer next edits them. Accepted.
- **The organizer can write the columns directly through PostgREST.** They can set a coordinate
  that disagrees with their own address, which is within their authority since they author the
  address. They cannot point a path at another rider's object — a CHECK pins both paths to
  `'ride-maps/' || organizer_id || '/%'`, and the SELECT policy independently requires the object's
  uid segment to match `organizer_id`, so the two controls fail independently.
- **The table-level grant stays.** Converting it to per-column the way `025` did for `profiles`
  would protect a rider from vandalising their own ride, at the price of a destructive migration
  and the permanent inversion that every future column on `rides` arrives with no UPDATE grant.
  Declined and stated in the migration, which is what `tag-postcards-to-rides`'s
  *"The default is stated for a table with no grant conversion"* scenario asks for.

**The "within their authority" argument has a hard edge, and the spend counter is on the other side
of it.** Everything above reasons that an organizer corrupting their own ride's coordinate or path
harms only their own ride, so a client-writable column is acceptable. That argument covers data the
organizer authored. It does **not** cover the spend control, which is not the organizer's data at
all — it is a limit on our vendor bill, and the organizer is precisely the party it is aimed at. A
control its adversary can reset is decoration. §D10 is where that lands.

**The fallback if a later constraint refuses the direct write** — a bucket-level restriction, or a
decision to lock the columns down: a narrow `security definer` RPC in `public` that takes the
paths and the coordinate and checks `auth.uid() = organizer_id` internally, matching
`accept_terms()` / `complete_onboarding()`. **Not** a service-role key. Recorded so that the
retreat is one step rather than all the way.

## D3 — Three gates: granularity, a `0.70` floor, and separation among the survivors

`meeting_point` is free text, so this is a guess, and the failure that matters is not a *missing*
map — it is a **confident wrong** one. "The usual spot, Leiderdorp" resolves to a city with high
confidence: the geocoder is entirely correct that it found Leiderdorp, and entirely useless as a
meeting point. A rider who trusts that tile rides to a town centre. Today's screens print the
rider's own words and are never wrong, so a wrong tile is a **regression** in a way an absent tile
is not.

Hence **three** parts, applied in this order, and the numeric floor is the weakest of them:

1. **Granularity gate** — street-level or better, read from the **result type**. A city, district
   or region match is rejected outright whatever its score, because a numeric score cannot express
   "confident about the wrong question".
2. **Numeric floor `0.70`** on the provider's confidence rank.
3. **Separation gate** — among the candidates that survive 1 and 2, if any two lie further apart
   than a stated threshold, resolve nothing. **Added 2026-08-11**; see *What was measured*.

**The order is a correctness rule, not an efficiency one, and it was wrong in the first draft of
this section.** Separation was placed first, on the reasoning that it is the cheapest test. But
testing separation across *raw* candidates measures distance between things the granularity gate is
about to discard: `[building, city]` is an ordinary response for a street address in a named city,
and separation-first rejects it even though exactly one usable candidate existed. Filter first,
then ask whether the survivors agree.

`0.70` is **chosen, not measured** — it is a starting value, deliberately conservative, and the
owner may move it once there is a corpus of real meeting points to score against. The gate should
not be dropped when the number is tuned.

**Do not add a CHECK on the match type.** It would hardcode a vendor's vocabulary into the schema,
and the vocabulary is the vendor's to change. The row stores the numeric confidence, the CHECK
enforces the coupling and the floor, and the gate lives in the function. The spec says so rather
than implying the database is holding a line it is not.

### What was measured, 2026-08-11 — and the two things this section had wrong

An earlier version of this paragraph said *"the field names are inferred, not measured"* and told
task 1.1 to verify them before the migration hardcoded a floor. **That verification has now
happened**, against a real response for `Stationsplein 1, Amsterdam` supplied by the product owner.
The floor survived; the field names did not.

**n = 1. Read the Verdict column as "what one response licenses", not as a specification** — the
fields are now measured, most of their *ranges and vocabularies* are not, and the difference is
exactly where the first draft of this section overclaimed.

| Path | Measured | What that actually licenses |
|---|---|---|
| `properties.result_type` | `building` | **The granularity field exists and is not inside `rank`.** Its *vocabulary* is unmeasured — see below |
| `properties.rank.match_type` | `full_match` | Describes how the **query** matched, not what came back. Do not gate on it |
| `properties.rank.confidence` | `1` | The field exists. **The scale is NOT confirmed** — see below |
| `properties.rank.confidence_street_level` | `1` | Exists. Same caveat as `confidence` |
| `properties.rank.importance` | `0.00008268` | Not a quality score. Do not gate on it |
| `properties.rank.popularity` | `8.995` | ~0–10, not 0–1. Do not gate on it |
| `properties.datasource.license` | `Open Database License` | **This feature's** source is ODbL. Not a claim about the corpus |
| `properties.datasource.attribution` | `© OpenStreetMap contributors` | The string **this feature** requires |

**What is still NOT measured, and saying otherwise would repeat a mistake this repo has already
made.**

- **The confidence scale.** One observation of the value `1` is the least informative possible
  evidence for an upper bound — it is equally consistent with 0–1, 0–10 and 0–100. The `0.70`
  floor remains **plausible rather than validated**. The internal tell that this was overclaimed:
  `popularity: 8.995` is hedged as "~0–10" from exactly one sample while `confidence` was written
  up as confirmed from exactly one sample.
- **The `result_type` vocabulary.** One value was seen, and it is the easy case. The gate must sort
  `street`, `amenity`, `postcode`, `suburb`, `locality`, `district` and whatever else the vendor
  emits onto two sides of a line, and **none of that was observed**. The *field* is measured; the
  *vocabulary* is not, and the gate cannot be written until it is.
- **The licence, across the corpus.** `datasource` is **per feature** and Geoapify merges several
  sources. Generalising one feature's ODbL to "the coordinates are ODbL" is precisely the error
  already recorded against `places`, where a 527,725-row census named Overture, Foursquare,
  Microsoft, PinMeTo and others and **zero** OpenStreetMap against an assumed ODbL credit. It also
  sits oddly beside this change's own note that per-API attribution is unread.
- **The corpus itself.** One address, one country, one vendor. The Weesp mechanism is a Dutch
  municipal merger; nothing here establishes what the analogous ambiguity looks like elsewhere.

**Correction 1 — the granularity gate was pointed at the wrong field.** This section said the gate
reads a match-type vocabulary. `match_type` returns `full_match` for a city as readily as for a
building, so a gate reading it admits precisely the city-level match this section exists to reject.
The gate reads `properties.result_type`.

**Correction 2, and it is why this section now has three parts rather than two.** The same query
returned **two** buildings, in Amsterdam and in Weesp, **12.2 km apart**, both at maximum
confidence. Weesp merged into the Amsterdam *municipality* in 2022, so the second is a correct
answer to the text that was typed.

Both gates above pass both candidates. A pipeline taking the first feature stores a coordinate
12.2 km from where the rider meant **with the highest possible confidence attached**, and it is
then indistinguishable from a good one — which is exactly the "confident wrong" failure this whole
section is built to prevent, arriving through a door the section did not know existed.

**The gate keys on distance, and the first draft got this wrong in a way worth recording**, because
the wrong version is the one a reader re-derives from the same evidence. It rejected on an *exact
tie at the top confidence* — which the measured case exhibits, so it looked right. But confidence
**saturates**: those two tied at the ceiling, not because they were equally good. Return the same
two towns as `1.00` and `0.97` and a tie test does not fire, while the rider still ends up 12.2 km
wrong. And the tie test fails in the other direction too — a vendor merging datasources returns one
building twice, tied exactly, 0 m apart, and a count-based rule refuses a perfectly unambiguous
address for ever. **Distance discriminates between those two situations and tie-ness does not**, and
the distance was already sitting in the measurement that prompted the rule.

**One thing the separation gate does not do, stated so it is not assumed.** It bounds *ambiguity*,
never *wrongness*. A response containing only Weesp passes every gate here, and the tile ships. The
resulting asymmetry — no tile for an ambiguous address, a wrong tile for one that resolves cleanly
to the wrong building — is a KNOWN GAP in the spec rather than something this design solves.

This is the same shape as `PD-149` (*a nearby street can crowd out a famous landmark of the same
name*) and as **PD-114**'s note about *"a guess that can silently centre the tile on the wrong Shell
station"* — that sentence is PD-114's characterisation of this change's approach, not this issue's
own. **Both were read as low-confidence problems. Neither is.** Confidence answers how
sure the vendor is about one candidate and is structurally silent on how many candidates there are.

**Do not add a CHECK for any of this.** The ambiguity rule needs the whole response and the
granularity rule needs a vendor field; both live in the function, and §D3's existing rule against
hardcoding a vendor vocabulary into the schema covers them. What this does change is how much the
CHECK is claimed to be doing — see the requirement scenario *The granularity gate is a function-side
rule and is not overclaimed*, which now understates it: the CHECK bounds **coupling**, and after
this correction it bounds a smaller share of **correctness** than this section originally implied.

## D4 — Two zooms, two renders, and why not one crop

z13 for the 80×148 strip (941 × 1741 m at 52°N) and ~z15 for the 358×160 panel (1.05 × 0.47 km),
per the owner's measurement.

The tempting saving is to render once at the larger size and crop for the strip. It does not work:
zoom is not scale. At z15 an 80px-wide crop covers roughly 235 m and shows one street with no
recognisable context — it reads as texture. The strip's job is *"this ride starts over there"*,
which needs the town visible, and that is a different render.

**Render at 2× device pixel ratio.** A 80×148 CSS-pixel tile drawn 1:1 on a 3× phone is mush, and
this is a design system that measured its type tokens. 2× doubles the bytes and stays far inside
the 5 MB ceiling.

## D5 — The stale-tile rule is a `BEFORE UPDATE` trigger, scoped to `meeting_point`

Three properties, each of which rules out an alternative:

- **A trigger, not a convention in `lib/actions/`.** The client owns the mutation path; a
  convention is advisory. A tile of a previous address is a picture of the wrong place shown beside
  the right one.
- **`BEFORE`, not `AFTER`.** A `BEFORE` trigger overwrites values supplied by the same statement,
  so a client sending `meeting_point` and a path together cannot keep the path. An `AFTER` trigger
  issuing a second statement can be raced.
- **Scoped with `WHEN (old.meeting_point IS DISTINCT FROM new.meeting_point)`.** Measured
  2026-08-09, `propagate_club_privacy_to_rides` runs
  `update public.rides set is_public = false where club_id = new.id and is_public`. An unscoped
  trigger would clear every tile in a club the instant it turned private — a bulk data loss with a
  plausible-looking cause, discovered weeks later.

`IS DISTINCT FROM` is the whole comparison. Trying to decide whether two strings denote the same
place is the problem geocoding exists to solve, and an over-eager clear costs one render.

**The trigger's one hazard is that it forgets.** Clearing the path columns destroys the only record
of the superseded object names, so the delete has to happen *before* the UPDATE that fires it —
§D8.

## D6 — Attribution, and the case where it cannot fit

Mandatory on the plan in use, and the interesting half is the negative case. On the 358×160 panel
there is room. On the 80×148 strip there is 80px of width, and this design system's smallest type
token is `Poppins/10/Medium`.

The rule: **if the required credit cannot be rendered legibly within the strip, the strip does not
render a tile.** Omitting the tile is the correct failure; omitting the credit is a licence breach
shipped silently on every row of a list. It is explicitly not resolved by going below the design
system's smallest size, clipping, or abbreviating the vendor's name.

A shared credit elsewhere on the screen was considered and rejected — the owner's instruction is
that it be designed into the strip, and a list is scrolled, so a footer credit is not on screen
with the tiles it covers.

**The exact string is a blocking question**, because it depends on the vendor's current terms and
possibly on the upstream data licence. Worth noting that this repo already carries **one
unresolved attribution question** — `places`, whose Overture census names eight sources and zero
OpenStreetMap, making the ODbL credit first assumed there wrong. These are two obligations from two
vendors and neither satisfies the other. Do not let the second inherit the first's uncertainty as
though it were the same problem.

## D7 — What the RLS suite can and cannot see here

Assertable on plain Postgres, and therefore required: every row of the per-role table in
`specs/ride-map-tiles/spec.md`, the path-pinning CHECK, the coupling CHECK, the stale-tile trigger,
and each of the three `storage.objects` policies.

**Not assertable, and named so their absence is not read as coverage:**

- **Signed-URL behaviour after the policy stops matching.** Storage checks the policy when the URL
  is minted, not when it is fetched. Needs the hosted project and two real sessions.
- **The bucket's MIME allowlist.** It runs above every policy; no policy assertion can observe it.
- **The Edge Function's JWT verification.** Deno, excluded from `tsconfig.json`, with nothing type
  checking it — the least-guarded code in the repo, and a second pair of eyes on that file is worth
  more than a test that cannot run.

## D8 — Orphaned objects: one mechanism, and why the own-folder arm flipped

Two failures end identically — an object in Storage that no row names:

- **the address edit**, because the §D5 trigger NULLs the path columns in the same statement that
  changes `meeting_point`, destroying the only record of the old names; and
- **the refused column write** of §D2, when the compensating delete also fails.

**Picked: ordering as the primary rule, the own-folder read arm as the recovery path.** The caller
deletes the superseded objects *before* issuing the UPDATE — the same ordering the ride-deletion
path already uses, objects first and then the row that names them.

The objection to that on its own is fair: it makes cleanup best-effort by a client this change
elsewhere refuses to trust. That is exactly why it is paired rather than left alone. The
`ride-maps` SELECT policy carries `foldername[2] = auth.uid()::text` **OR** the `EXISTS`, so an
orphan stays listable and deletable by the one accountable party.

**This reverses the first draft, and the reversal is the interesting part.** That draft omitted the
own-folder arm and argued it was the safer direction, because otherwise a deleted ride's tile stays
readable by its organizer. The reasoning was backwards on the axis that matters: **without the arm
the organizer cannot delete the object either.** A Storage listing is filtered by the same SELECT
policy, so an object no row names is invisible in a listing, and its name is unrecoverable — the
DELETE policy permits the organizer to remove it but only by naming it. Omitting the arm does not
make the tile go away; it makes it permanent, invisible and uncounted. Each such object is a
rendered image of where an identified rider previously intended to be. The arm converts a retention
problem into a cleanup affordance, and grants nobody a byte they could not already see: the folder
is keyed to the organizer, and every object in it renders a meeting point that same rider authored.

**Rejected: a sweep table.** The trigger could write superseded paths into a durable queue instead
of discarding them. It works, and it costs a table, a retention statement of its own, a drain path
with no privileged actor to run it, and a second place where location data accumulates. The
own-folder arm achieves the same recoverability with one disjunct.

**Rejected: accepting permanent orphans.** It would have required rewriting the deletion obligation
to say so, extending the retention statement to an unbounded invisible set, and admitting that
ordinary use — correcting a typo in an address — silently accretes undeletable location data. That
is not a trade worth taking to save one `OR`.

## D9 — The own-folder arm, and the rule that does not condemn four live policies

The rule in `stored-media-visibility` was first written to forbid the own-folder arm outright.
Measured, **four of the five existing SELECT policies contain it** — `avatars`, `covers`,
`club-avatars`, `club-covers` are all `own-folder OR EXISTS(parent)`, and only `postcards` is the
bare `EXISTS`. An absolute rule would have archived into the standing set as a contract the live
schema violates in four places, inviting a later session either to strip the arms (a behaviour
change nobody decided) or to spend a review cycle filing four non-defects.

**Picked: narrow the rule rather than grandfather the exceptions.** The test is:
**does the owning row's own SELECT policy admit the folder's uid unconditionally?** Where it does,
the own-folder arm grants that rider nothing they could not already reach, so it is safe. Where it
does not, the arm hands them content the parent policy deliberately withheld, and it is forbidden.

Measured 2026-08-09, that test predicts every folder in the bucket:

| Folder | Folder uid | Owning row's SELECT policy | Arm safe? | Arm present? |
|---|---|---|---|---|
| `avatars`, `covers` | profile id | self, unconditionally | ✔ | ✔ |
| `club-avatars`, `club-covers` | club owner | `is_public OR owner_id = auth.uid() OR is_club_member(id)` | ✔ | ✔ |
| `postcards` | author | `author_id = auth.uid() OR (…club audience…)` | ✔ | ✘ — by choice |
| `ride-maps` | organizer | `organizer_id = auth.uid() OR (…club/public audience…)` | ✔ | ✔ — §D8 needs it |

**An earlier draft used a different test — "does the folder's uid identify the rider the row is
about" — and it does not survive measurement.** It explained `postcards` as a folder whose uid
identifies a mere uploader, since a postcard's audience is its club rather than its author. But
`postcards` SELECT is `((author_id = auth.uid()) OR (…))` and `rides` SELECT is
`((organizer_id = auth.uid()) OR (…))` — the same shape, an unconditional owner arm plus a group
audience. A postcard is "about" its author exactly as much as a ride is "about" its organizer, and
by that phrasing §D1 argues a ride's audience is its club and every signed-in rider rather than its
organizer. Applied consistently the old test either permitted the arm on `postcards`, making "one
rule, no exceptions" false, or forbade it on `ride-maps`, contradicting §D8. It was a
rationalisation of the status quo wearing the words of a prediction.

The replacement test is decidable from the parent policy alone, which is what makes it usable on a
folder that does not exist yet — and `stored-media-visibility` names three of those (the ride cover
photo, club media, and the Journal's ride-scoped postcards). The last is exactly the case where
"which rider is this row about" has no answer and "does the parent policy admit the uploader
unconditionally" still does.

**`postcards` omits a safe arm, and that is a choice rather than a violation.** The rule permits it
and does not require it; nothing in this change adds it, because nothing in this change needs an
orphan sweep for that folder.

Grandfathering was the alternative and was rejected because an exceptions list has to be
maintained, and its four entries would have been indistinguishable from four bugs.

## D10 — The spend control is an append-only ledger, not a counter column

Two requirements, pulling opposite ways, and the obvious design satisfies exactly one:

1. **The organizer must not be able to lower the count.** `rides` carries a table-level UPDATE
   grant this change keeps (§D2), so a counter column on `rides` is client-writable.
2. **The organizer's own function call must be able to raise it.** The function runs as
   `authenticated` under the forwarded JWT — anything `authenticated` cannot write, it cannot write.

**A trigger owning a counter column was the first answer and it is wrong**, which is worth writing
down because it looked right and survived a round of review. It satisfies (1) by discarding
client-supplied values, and in doing so satisfies (2) by leaving **no writer at all**. The only
remaining writer is an `UPDATE` on `rides` — and every *failing* render issues no `UPDATE`: an
empty geocode, a sub-floor confidence, a rejected granularity, a vendor outage and a quota
rejection all leave the columns NULL and save the ride normally. The count would rise only on
success, while the money is spent at the geocode. The ceiling would have bound the organizers whose
addresses resolve cleanly and missed the one editing "the usual spot" ten times *because the map
will not appear* — §D3's own worked example of a rejected match, and precisely the rider who
retries.

**Picked: `ride_map_render_attempts`, append-only.** `authenticated` holds **INSERT and SELECT
only** — no UPDATE grant, no UPDATE policy, no DELETE grant, no DELETE policy. The ceiling is a
`WITH CHECK` on the INSERT policy counting the caller's rows in a rolling window.

**This does not contradict the earlier rejection of "move the counter to another table"; it
refines it.** That rejection was of a table `authenticated` *cannot* write, which the function
cannot write either. The ledger is a table `authenticated` *can* write — but only **append** to.
The trick is the direction of the adversary's interest: the organizer wants the count **down**, and
down is the direction with no grant behind it. Up is self-harm and needs no defence.

**Two soft edges, both stated here because the shape is new to this repo and neither announces
itself.** This is the first policy here whose predicate is an aggregate over its own table.

- **It overshoots under concurrency, permissively.** Under READ COMMITTED two concurrent inserts
  each evaluate the `count(*)` before either commits, both see `ceiling − 1`, and the window ends
  one row over. The overshoot is bounded by the number of genuinely concurrent callers — one extra
  geocode for a double-tapped button — and is accepted at that size. The tension is worth naming
  rather than hiding: the ceiling lives in the policy *because* the function is stateless and may
  be called concurrently, so concurrency is both the reason for this design and its one soft edge.
  **The RLS suite runs serially and cannot demonstrate it either way**, so a green suite is not
  evidence here.
- **The count is only as wide as the ledger's SELECT policy.** The aggregate runs under the caller's
  own RLS, so it counts only rows SELECT admits. Today they coincide and the count is right.
  Narrowing SELECT later, for any unrelated reason, silently under-counts and *widens* the ceiling
  with nothing failing. The dependency is recorded because it is invisible at the point where
  someone would change it.

Three consequences worth keeping:

- **Insert before the vendor call.** A refused insert costs nothing; a successful one has recorded
  the attempt before its outcome exists. That ordering is the entire reason it counts attempts.
- **`attempted_at` by `BEFORE INSERT` trigger, not DEFAULT** — `034` again. A client that can
  backdate rows out of the window has no ceiling.
- **The refusal lands on a different table from the ride.** This is what preserves *"a refused
  render never fails the ride write"*. A `BEFORE UPDATE` trigger on `rides` that raises at the
  ceiling aborts the whole statement — so an organizer at their ceiling could not edit their own
  ride's address at all for the rest of the window, a far worse failure than a missing map, and one
  the guarantee explicitly names.
- **The window becomes genuinely rolling**, so the 2×-across-a-boundary concession the counter
  design had to document simply disappears. One row per attempt is what a rolling window is.

## D11 — Rejected alternatives

| Alternative | Why not |
|---|---|
| **`maps/…?output=embed` iframe** | Ruled out by name in `docs/FIGMA-FIDELITY-TODO.md` with three reasons: it is an interactive map where decision #3 specifies a static thumbnail, it swallows touch gestures inside a scrolling page, and Safari's tracking prevention blanks third-party frames — reproducing the exact blank-panel bug already fixed once on this screen |
| **Call the vendor from the client with a referrer-restricted key** | A key in the bundle is a key that has shipped; referrer restrictions do not exist for a native shell; every rider's IP reaches the vendor on every scroll of the list; and there is nothing to read offline |
| **Store the tile at the vendor's URL and hot-link it** | Same IP leak, same offline hole, and it makes every ride card depend on a third party's uptime and on terms that could change under us. The caching permission is the specific reason this provider was chosen |
| **A `postcards`-style client-side render** | There is nothing to render client-side without a mapping SDK, which decision #3 forbids |
| **One tile at one zoom** | D4 |
| **Geocode on read** | Multiplies vendor calls by views, which is the cost model the architecture exists to avoid, and makes a list screen's latency a vendor's latency |
| **A `latitude`/`longitude` pair with no confidence column** | The floor becomes unrecoverable — nothing in the row records why a coordinate was admitted, and a later change cannot tell a geocoded guess from a picked place |
