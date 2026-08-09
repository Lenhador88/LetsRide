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
   still have the column write refused. §D9 is the ordering that keeps that from costing money and
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
organizer authored. It does **not** cover `map_render_count`, which is not the organizer's data at
all — it is a limit on our vendor bill, and the organizer is precisely the party it is aimed at. A
control its adversary can reset is decoration. So the two counter columns are **owned by a
`BEFORE UPDATE` trigger that derives them from their `OLD` values and discards whatever the client
sent**, which is `034`'s `created_at` ruling applied to a counter rather than a timestamp.

Chosen over the alternative of moving the counter to a table whose grants this change controls: the
function runs as `authenticated` under the forwarded JWT, so a table that `authenticated` cannot
write is a table the function cannot write either — the same bind as the confidence floor. It would
have forced a `security definer` RPC purely to hold an integer. The trigger keeps the counter beside
the row it bounds, uses a mechanism §D5 already relies on, and needs no new grant surface.

**Window representation.** `map_render_window_start timestamptz` plus a count — a **fixed** window
that resets on the first render after it elapses, not a rolling one. A true rolling window needs one
row per render, which is an audit table nobody asked for. The honest cost is 2× the ceiling across a
window boundary, and the spec states that rather than letting "rolling" imply the stronger
guarantee.

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

**The trigger's one hazard is that it forgets.** Clearing the path columns destroys the only record
of the superseded object names, so the delete has to happen *before* the UPDATE that fires it —
§D9.

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

## D9 — Orphaned objects: one mechanism, and why the own-folder arm flipped

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

## D10 — The own-folder arm, and the rule that does not condemn four live policies

The rule in `stored-media-visibility` was first written to forbid the own-folder arm outright.
Measured, **four of the five existing SELECT policies contain it** — `avatars`, `covers`,
`club-avatars`, `club-covers` are all `own-folder OR EXISTS(parent)`, and only `postcards` is the
bare `EXISTS`. An absolute rule would have archived into the standing set as a contract the live
schema violates in four places, inviting a later session either to strip the arms (a behaviour
change nobody decided) or to spend a review cycle filing four non-defects.

**Picked: narrow the rule rather than grandfather the exceptions.** The arm is permitted where the
folder's uid segment identifies **the same rider the owning row is about**, and forbidden where it
identifies a mere uploader whose content belongs to a wider audience.

That line is not a rationalisation of the status quo — it predicts it. `avatars` and `covers`:
folder uid *is* the profile subject, arm present. `club-avatars`/`club-covers`: folder uid is the
club owner, arm present. `postcards`: a postcard's audience is its **club**, not its author, so the
folder uid identifies an uploader rather than the subject — and `010` omitted the arm. `ride-maps`:
folder uid is `organizer_id`, the ride's own subject, so the arm is permitted, which is what D9
needs. Five folders, one rule, no exceptions list.

Grandfathering was the alternative and was rejected because an exceptions list is a thing that has
to be maintained, and the four entries on it would have been indistinguishable from four bugs.

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
