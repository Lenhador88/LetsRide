# Design — postcard location defaults to a Region

Every measurement here was taken against **DEV (`fpmrimzxadewsaiwpsel`) on 2026-08-27** and
carries the query that produced it. Re-derive rather than trust. Anything inferred is marked
**UNVERIFIED** in the sentence that states it, per `CLAUDE.md` §Working Principles.

---

## D1 — What is actually in the column today, and why the floor is not what it looks like

```sql
select
 (select count(*) from public.postcards) as postcards,                                    -- 10
 (select count(*) from public.postcards where taken_place_name is not null) as named,      -- 1
 (select count(*) from public.postcards where taken_country_code is not null) as country,  -- 0
 (select count(*) from public.postcards where taken_location_precision='region') as legacy;-- 1
```

**Zero countries against one name is not a rounding error, it is the deployed proxy.** `074`
stores whatever `search-places`' `toPlaceResult` hands over; PD-279 added `country_code` to
`shape.ts` and neither project has been redeployed, so the field is absent from every response and
`taken_country_code` is NULL on every row that has a name.

This is load-bearing for the whole change: **a `Country` mode built against today's deployed
function stores NULL and renders nothing.** It is a deploy dependency, not a build risk —
`proposal.md` §Blocking dependency and `tasks.md` group 0.

## D2 — Dropping `Hide` does not remove the hidden state

`postcards_taken_location_coupling` arm 1 is the all-NULL row, and `073`'s comment on it is the
sentence that survives this change unaltered:

> **(1) NOTHING.** Hide, or a photo with no fix and a rider who named nothing. The two are
> deliberately indistinguishable: a column that told a viewer "this rider chose to hide it" would
> itself be a disclosure.

Removing the *button* removes the first clause. **The second clause is still reachable and is the
common case** — `072`'s own header says a photo carrying no fix is the norm rather than the edge.
So:

- Arm 1 **stays**. Nothing may be added that distinguishes "chose nothing" from "had nothing";
  that distinction is itself a disclosure, and it would be a new one.
- The row a rider gets when they select `Country` on a fixless photo and name nothing is **arm 1**,
  not a `'country'` row. `resolveLocationCopy` is the mechanism that keeps the sentence honest for
  it (open question B).

**The property that is genuinely lost, stated once:** before this change, an all-NULL row could
have been a deliberate choice. After it, a rider who wants to publish no location at all has no
control that produces one — they must decline to name a place *and* the photo must carry no fix.
For a photo that **does** carry a fix, `Country` is the floor and there is no way down from it.
That is the owner's decision (`proposal.md` §The objection) and this file does not reopen it; it
is recorded here because the coupling constraint is where a future reader will ask why arm 1
still exists.

## D3 — A sixth arm, or a restructure

The constraint has five arms and four columns today. `Country` needs a sixth shape:

```
taken_location_precision = 'country'
  and taken_country_code is not null
  and taken_place_name  is null
  and taken_latitude    is null
  and taken_longitude   is null
```

**Recommendation: restructure rather than append.** Six `or`-ed arms of four to eight conjuncts
each is where `073`'s NULL-swallowing defect was born — `072` split one arm into four and the
`is not null` guard did not come with them, so `FALSE or FALSE or NULL` evaluated to NULL and a
CHECK accepts NULL. That failure mode scales with arm count.

Whatever shape is chosen, **three rules are not negotiable**:

1. **No bare `=` against `taken_location_precision`.** `is not distinct from`, per `073`'s
   correction 2. This is the single most likely regression in the file.
2. **Every arm carrying a coordinate keeps `064`'s range bounds.** Retyping a constraint is
   exactly where a bound gets lost.
3. **`'region'` keeps its arm.** One DEV row depends on it and there is no backfill.

### `postcards_coarse_location_is_rounded` and the new marker

The rounding CHECK names two markers:

```sql
(taken_location_precision is distinct from 'region'
   and taken_location_precision is distinct from 'place')
or (taken_latitude is null and taken_longitude is null)
or (… = round(…, 2) …)
```

**`'country'` is not in that list, so a `'country'` row carrying a coordinate would escape the
rounding rule entirely.** Under D3's recommended shape it cannot carry one — but the coupling and
the rounding CHECK are two constraints, and "the other one covers it" is precisely the reasoning
`073` had to correct. Add `'country'` to the rounding CHECK's exclusion *or* prove the coupling
forbids the coordinate; do not leave the marker unmentioned in both.

## D4 — `postcards_taken_country_code_needs_a_place` comes off, and its reason has to be replaced

`074` added it for a specific rendering fact:

> `PostcardCard` draws the flag immediately before the town and never on its own, so a row carrying
> a country and no name would store a value nothing can ever render.

That fact stops being true in this change — a `Country` row is *exactly* a country with no name —
so the constraint goes. But its argument does not evaporate: **it was protecting against a value
nothing renders**, and dropping it without changing `PostcardCard` reintroduces that state rather
than removing it.

`PostcardCard.tsx` gates the whole row on the name:

```tsx
{postcard.taken_place_name && ( … flag … <span>{postcard.taken_place_name}</span> … )}
```

So the card change and the migration are **one change, not two**. A tasks list that applies the
migration and leaves the card is a list that ships a silently invisible mode.

## D5 — The search split, and the part that cannot be answered here

`buildAutocompleteUrl` sends `text`, `limit`, `format`, an optional `bias` and `apiKey` — **no
`type` at all**. `buildLocalityUrl` and `buildReverseUrl` both send `type=city`. So the ride
composer and the postcard composer share one undifferentiated result list today.

They want opposite things:

| Caller | Wants | Why |
|---|---|---|
| Ride meeting point | findable and **specific** — café, car park, address | the ride stores the pin exactly (`rides_location_coupling`'s picked arm: full precision, no confidence) |
| Postcard Region | coarse and **evocative** — range, valley, pass, river, town | the coordinate is rounded to 2dp before it is sent (`COARSE_DECIMAL_PLACES`), so specificity buys nothing and costs a disclosure |

**The open research task, and it is NOT answered here.** Whether natural features — mountain
ranges, rivers, valleys, passes — are reachable through a `type` or filter on Geoapify's geocoding
**autocomplete**, or whether they require the separate **Places** endpoint with categories, and
what the second option costs in credits, latency and a second ledger shape.

**`*.geoapify.com` is egress-blocked from this build container** — `WebFetch` returns
`EGRESS_BLOCKED` and so does `curl` through the agent proxy, which is exactly why every constant
in `shape.ts` is labelled *measured*, *documentation-derived* or *assumed*. **No answer is guessed
here.** This is a DEV/owner task: it needs either a session with egress or a probe run against the
deployed function from a machine that has it.

**The recommended default keeps the build moving:** ship the split as *structure*. A `criteria`
discriminator on the proxy request; the **ride** caller sends the value that reproduces today's
request byte-for-byte, so nothing an organizer can find today stops being findable; the
**postcard** caller sends a coarse value the research task fills in. The riskiest possible outcome
of an unmeasured guess — an over-narrow filter returning nothing, which reads to a rider as "no
matches" and cannot be fixed by typing differently, exactly `shape.ts` §D8's argument against a
`countrycode` filter — is avoided by not choosing the value yet.

**Note in passing, because it is the same class of problem:** `type=city` on the **reverse**
endpoint has never been observed being honoured either. `shape.ts`'s `buildReverseUrl` says so in
as many words — *"no session has watched this parameter be honoured"* — and warns that a `type`
the vendor ignores returns a perfectly well-shaped feature whose label is the nearest **address**.
That was tolerable when the middle mode was opt-in. With `Region` as the default it is the path
every postcard takes. Question F.

## D6 — "Load current location", and the two things it must not become

### It must read a DEVICE position and nothing else

`resolveRiderLocation()` is a **best-available chain**: `resolveFromDeviceSilently` then
`resolveFromProfile`, the second of which reads `profiles.location` — the rider's onboarding city
— and geocodes it. Under a label promising *current* position, that chain would silently write
the rider's **home town**.

**The function that already does the right thing exists.** `requestDeviceLocation()` in
`src/lib/location/rider-location.ts` bypasses the chain, asks the device directly, returns `null`
on denial, timeout or no geolocation, and is documented as *"the only place in this module that
may trigger the OS permission prompt, because it only ever runs from a tap"*. **No new resolver is
needed and none may be written**; a second device reader is a second place for the fallback to
creep back in.

### It cannot honestly feed `Precise`

`requestDeviceLocation()` rounds through `toRiderLocation` → `roundToLocationPrecision`, with
`LOCATION_PRECISION_DP = 2`. So every value it returns is already ~1 km blunt.

**Writing that under `'precise'` would store a blurred coordinate that the database calls exact.**
`postcards_coarse_location_is_rounded` would not catch it — the constraint excludes `'precise'` by
design, because the camera's own fix is meant to keep every digit. The row would be legal,
consistent and wrong, and the marker would mean two different things depending on which control
produced it. That is the exact failure `resolvePhotoLocation`'s one-function-many-shapes design
exists to make unrepresentable. Question E; recommended default is `Country` and `Region` only.

### Permission, and the sheet that already exists

`locationPrimingState({permission, position})` returns `hidden | ask | blocked`, and the `blocked`
answer exists because **on iOS a refusal is one-way from inside the app**. A tap is the rider
asking, so this is the moment `ask` was built for — but a device that has already refused must
route to the sheet's **denied** copy (what is lost, and where to switch it back on) rather than
calling into a prompt that will never appear.

Note `locationPrimingState` returns `hidden` when `position !== null`, because it was written for
an *ambient* row that must not nag. **This control is not that row** — it is an explicit action
the rider tapped — so it draws unconditionally and consults the permission state only to decide
*which sheet* a refusal opens. Do not reuse the `hidden` arm to decide whether to draw the button.

### It costs a lookup

Turning a coordinate into a name is a reverse call, metered under `069` like every other: **20 per
rider per hour, 60 per 24 hours, 2000 per day application-wide**, all three enforced in the
`place_search_attempts` INSERT policy and all three raising the same `23514`.

**A silent no-op is the wrong answer and it is today's behaviour.** `reverseGeocodePlace` degrades
every failure to `null` on purpose — that was correct when it filled a field the rider could fill
themselves and had not asked for. Here the rider tapped a button. A ceiling refusal must reach the
`069` ceiling state `PlaceSearchField` already draws (two distinct messages by `.scope`, "wait an
hour" versus "until tomorrow", and the application-wide one reading as *unavailable* with a retry
button, because it is not the rider's fault).

### No recency gate

The label says *current*. It makes no claim about where the photo was taken, so there is nothing
to gate on — a rider standing somewhere may name where they are standing. The **copy** carries the
whole contract here, which is why `resolveLocationCopy`'s existing states have to grow one for it.

## D7 — Why `Region` as a default forces the lookup earlier, and what that costs

The reverse lookup fires today on the rider tapping the middle mode. `reverseGeocodePlace`'s
header states the reason plainly: *"firing on upload would send a photo-derived coordinate while
the control still read `Hide`"*.

With `Region` selected on arrival there is no tap to hang it on, so it fires on upload. Two
consequences to spec rather than discover:

- **One lookup per photo, and no re-fire without a rider action.** `reverseGeocodePlace` already
  has this shape (the rider who taps while the upload is in flight gets no prefill, and asking
  again is a mode toggle). It must not become per-keystroke, per-render or per-remount.
- **The ceiling becomes reachable by ordinary use.** Twenty photos in an hour exhausts a rider's
  hourly allowance without them typing anything. The refusal must be visible — same argument as
  D6's last paragraph, arriving by a different route.

## D8 — What this change is forbidden from touching

- **UPDATE on `postcards`.** Measured 2026-08-27: `caption, club_id, image_path`, unmoved through
  `072`, `073` and `074`, each of which re-issued the other two lists. `044`/`046` is this repo's
  worked example of an absolute re-grant silently reverting a shipped decision, **on this exact
  table**. Any migration here that issues an UPDATE statement has walked into it.
- **`ride_id` on SELECT.** `062` took it out. It stays out.
- **`taken_place_id`.** `073` dropped it as a precision backdoor and its argument is unchanged: a
  provider id resolves through a details lookup to the picked feature's exact geometry, beside a
  coordinate deliberately blunted to 2dp.
- **Any grant to `anon`.** Decision #1, and `007` revoked the last of them. DEV holds 0 rows in
  `information_schema.column_privileges` for `anon` on `postcards`.
- **The policies.** `072`, `073` and `074` each touched none, for the reason `072`'s header gives:
  the place rides the postcard's own audience and needs no arm of its own. That is still true of a
  country.
