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
2. **Can the column write be a policy?** Yes, and it already is. `rides` carries a **table-level**
   grant to `authenticated` (`relacl` = `arwdDxtm`, `attacl` empty on every column, measured
   2026-08-09), so the four new columns arrive writable, and `rides` UPDATE is already scoped by
   `auth.uid() = organizer_id`.
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

**The fallback if a later constraint refuses the direct write** — a bucket-level restriction, or a
decision to lock the columns down: a narrow `security definer` RPC in `public` that takes the
paths and the coordinate and checks `auth.uid() = organizer_id` internally, matching
`accept_terms()` / `complete_onboarding()`. **Not** a service-role key. Recorded so that the
retreat is one step rather than all the way.

## D3 — The confidence floor is `0.70` **and** a granularity gate, and the gate is the real rule

`meeting_point` is free text, so this is a guess, and the failure that matters is not a *missing*
map — it is a **confident wrong** one. "The usual spot, Leiderdorp" resolves to a city with high
confidence: the geocoder is entirely correct that it found Leiderdorp, and entirely useless as a
meeting point. A rider who trusts that tile rides to a town centre. Today's screens print the
rider's own words and are never wrong, so a wrong tile is a **regression** in a way an absent tile
is not.

Hence two parts, and the second is doing most of the work:

- **Granularity gate** — street-level or better. A city, district or region match is rejected
  outright whatever its score, because a numeric score cannot express "confident about the wrong
  question".
- **Numeric floor `0.70`** applied after the gate, on the provider's confidence rank.

`0.70` is **chosen, not measured** — it is a starting value, deliberately conservative, and the
owner may move it once there is a corpus of real meeting points to score against. The gate should
not be dropped when the number is tuned.

**Do not add a CHECK on the match type.** It would hardcode a vendor's vocabulary into the schema,
and the vocabulary is the vendor's to change. The row stores the numeric confidence, the CHECK
enforces the coupling and the floor, and the gate lives in the function. The spec says so rather
than implying the database is holding a line it is not.

**The field names are inferred, not measured.** The container has no egress to the vendor's
documentation, so `rank.confidence` and the match-type vocabulary are written from prior knowledge.
Task 1.1 verifies them against a live response **before** `042` hardcodes a floor, and the
migration must not be written from this paragraph.

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

## D8 — Rejected alternatives

| Alternative | Why not |
|---|---|
| **`maps/…?output=embed` iframe** | Ruled out by name in `docs/FIGMA-FIDELITY-TODO.md` with three reasons: it is an interactive map where decision #3 specifies a static thumbnail, it swallows touch gestures inside a scrolling page, and Safari's tracking prevention blanks third-party frames — reproducing the exact blank-panel bug already fixed once on this screen |
| **Call the vendor from the client with a referrer-restricted key** | A key in the bundle is a key that has shipped; referrer restrictions do not exist for a native shell; every rider's IP reaches the vendor on every scroll of the list; and there is nothing to read offline |
| **Store the tile at the vendor's URL and hot-link it** | Same IP leak, same offline hole, and it makes every ride card depend on a third party's uptime and on terms that could change under us. The caching permission is the specific reason this provider was chosen |
| **A `postcards`-style client-side render** | There is nothing to render client-side without a mapping SDK, which decision #3 forbids |
| **One tile at one zoom** | D4 |
| **Geocode on read** | Multiplies vendor calls by views, which is the cost model the architecture exists to avoid, and makes a list screen's latency a vendor's latency |
| **A `latitude`/`longitude` pair with no confidence column** | The floor becomes unrecoverable — nothing in the row records why a coordinate was admitted, and a later change cannot tell a geocoded guess from a picked place |
