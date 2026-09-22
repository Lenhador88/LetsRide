# "Where you ride from" becomes the rider's own words, and the town question can read the phone

PD-476 and PD-477, built as one group because both land on the same two controls: the profile's
location section and the town question.

## Why

**PD-476.** A profile should carry a line the rider writes themselves (*"from the moon"*, *"the
wrong side of the Maas"*). The only column that looks like it is `profiles.location`, and that
column is the second source in `resolveRiderLocation`'s chain. `resolveFromProfile` geocodes it,
and the result drives *near you* on `/rides/explore`, `/clubs/explore` and `/clubs` and biases
every place typeahead. Loosening it to free text would let a rider overwrite their own placed town
with a string that geocodes to nothing, which quietly empties every distance list. That is the
defect PD-425 closed, in a new shape. So the attribute needs a column of its own.

**PD-477.** The wizard is three steps (`terms`, `username`, `town`) and none of them offers the
phone's location. The app's only invite is `LocationQuestionRow`, which PD-447 put on the two
Explore screens. A rider who never opens Explore is never asked, so the device source in
`resolveRiderLocation` stays unused for them.

**And a defect the proposal review found under PD-477: the town step has never been able to
search.** `search-places` writes a `place_search_attempts` row before it calls the vendor, and
`069` put `enforce_participation_gate` on that ledger. The gate requires the onboarding
completion stamp, and the rider on `/onboarding/town` cannot hold it, because that step is the
one that writes it. Measured on DEV as `authenticated`: a consented, un-onboarded rider gets
`23514`, and an onboarded one is allowed. So every rider since PD-445 has finished through the
country fallback with no town, and a device lookup at that step would be refused the same way.

## What changes

1. **`127` adds `profiles.rides_from`**, a nullable free-text column. `profiles_rides_from_length`
   bounds it at 100 characters (`018`'s bound for `location`) and requires at least one
   non-whitespace character. It gets column-scoped SELECT and UPDATE for `authenticated` and
   nothing for `anon`. There is no backfill and no default. `profiles.location` and the resolver
   chain are untouched.
2. **`128` moves `place_search_attempts` from the participation gate to a consent gate.** A new
   trigger function, `enforce_consent_gate()`, requires `terms_accepted_at` only. That was `069`'s
   stated reason for gating the ledger: *"a rider who has not accepted the terms must not be able
   to spend our vendor budget."* Every other gated table keeps `enforce_participation_gate`, and
   the shared function is not edited. The ledger row records THAT a rider searched, never what,
   so it is not content in decision #5's sense, and `069`'s per-rider and app-wide ceilings still
   bind.
3. **`EditProfileForm` gains a "Where you ride from" `<Input>`** beside `bike_model` and `bio`.
   `profileEditSchema` gains the member, `updateProfile` writes it, and `retaining(...)` retains
   it.
4. **The profile screens show `rides_from` when it is set, and the placed town otherwise.** That
   applies to the rider's own `/profile` and to another rider's `/profile/detail`, through one
   function, `profileLocationLine`, so no existing profile loses its line the day this ships.
5. **`LocationSetting`'s section is renamed "Distances measured from"**, so only one control on
   the profile is headed "Where you ride from". `TownQuestionSheet`'s accessible label becomes
   "Your town".
6. **"Use my current location" on the town question.** `TownFromDevice` wraps the typeahead in
   both places a town is asked for: the onboarding town step and `TownQuestionSheet`. A tap asks
   the OS for one fix, reverse-geocodes it through `search-places`, and puts the town into the
   field as a pick. The pick stays editable, and Continue/Save stays the rider's own action.
7. **The rule that only a tap may raise the location dialog becomes a two-caller allowlist,
   enforced by a test.** The callers are `LocationQuestionRow` and `TownFromDevice`.

## The open parameters, settled

- **PD-476: the column name is `rides_from`**, pairing with `home_country`. The profile form's
  field is headed "Where you ride from" and the setting is headed "Distances measured from".
  **Explore's row keeps asking "Where do you ride from?"** even though it writes the placed town.
  The owner's collision rule is about two controls on one screen, and on Explore the question is
  plain speech about where the distances come from.
- **PD-477: does the profile get the control too? Yes, through the same sheet, and not as a new
  button on `LocationSetting`.** The profile's *Change town* / *Set your town* opens
  `TownQuestionSheet`, and the control lives in that sheet, so one component serves every screen
  that asks for a town. `LocationSetting` keeps its own rule: opening it reads state and never
  prompts. **On Explore the control structurally never renders.** The row opens the sheet only in
  its `town`, `confirm` and `blocked` states, all of which read `denied` or `unavailable`, and the
  control hides itself for both. PD-447's ladder is untouched.
- **PD-477: the ceiling is 20 seconds from the tap, and it releases the control rather than
  cancelling the lookup** (`TOWN_FROM_DEVICE_CEILING_MS`). `requestDeviceLocation` arms no backstop
  while the OS dialog may be on screen, so a WebView shim that never calls back would otherwise
  spin on the wizard's only gate. The dialog is modal, though, and a rider may read it for longer.
  A fix that lands after the ceiling is still handed over, unless the rider has touched the field
  since.
- **Reverse geocoding answers a town, verified by content.** On DEV, a coordinate in central Hoorn
  and one on Dam Square each returned the city (`Hoorn`, `Amsterdam`) and no street, so the
  `type=city` parameter is honoured. That matters because a device-filled town becomes
  `profiles.location`, which `/profile/detail` shows to other riders.

## Who must NOT see or do this

- **`anon` reads and writes nothing** on `rides_from`, and cannot execute `enforce_consent_gate`
  (decision #1).
- **Another rider cannot write your `rides_from`.** `001`'s UPDATE policy (`auth.uid() = id`)
  binds every column, and `127.3` asserts it for this one.
- **A rider who blocks you, or whom you block, cannot read it.** The `profiles` SELECT policy is
  block-aware for the whole row, and `127.4` asserts it in both directions. Owner, admin, member
  and non-member of a shared club get no extra reach: a club role confers nothing on a profile
  (`113.8`).
- **A rider who has not accepted the terms still cannot spend a search credit** (`128.3`).
- **Nothing may read `rides_from` for a position.** That covers the resolver chain, the typeahead
  bias, any "near you" query and any future fallback that geocodes it when the placed town is
  missing. A string that happens to name a real town is still not a position. A test restricts
  the files that may mention the column to a fixed list.
- **Nothing pre-fills `rides_from`, ever.** Onboarding writes the placed town and nothing else.
- **No screen raises the location dialog without a tap.**
- **A refusal is not retried in-app.** After a tap that ends with no fix, the control stays only
  if the permission still reads `granted`. Otherwise it disappears silently: on a WebView whose
  Permissions API does not know geolocation, a denial reads as `prompt`, and iOS shows the dialog
  once per install.

## Negative cases, by outcome

| Rider state | What they see |
|---|---|
| Writes `rides_from`, later clears it | NULL is stored; the profile falls back to the placed town, never a blank line |
| No `rides_from` and no placed town | No location line at all, as today for NULL `location` |
| Writes only whitespace, or 101 characters | Zod trims whitespace to NULL and refuses 101 with a field message; `127`'s CHECK refuses a direct write of either (`23514`) |
| Taps *Use my current location*, denies | The control disappears, no message; the typeahead works as today |
| Grants, but no fix arrives (indoors, airplane mode) | Within 20 s: the control is back to idle with one muted line, *type your town instead* |
| Grants, but the reverse geocode fails or `search-places`' 2000/24h ceiling is spent | As above; a coordinate the app cannot name is not a town |
| Grants, and the fix names a town the rider is not in | The town appears as an editable pick; nothing is written until they press Continue/Save |
| Types, taps or picks in the field while the lookup is in flight | The late answer is dropped; it never lands on the rider's own answer |
| Reads the OS dialog past 20 s, then allows | The control has already been released; the town still lands if the field is untouched |
| Device has no geolocation, or the permission already reads `denied` | The control never renders |
| The control sits inside the onboarding step's `<form>` | It is `type="button"`, so a tap never submits the step |
| Prerender pass | Permission is read in an effect and the request runs in a click handler |
| The walk (headless, never taps the control) | The step completes by typing a town, as before |

## Sequencing

**`127` goes migration-first.** The new bundle READS the column through `OWN_PROFILE_COLUMNS` and
`VIEWED_PROFILE_COLUMNS` and WRITES it on every profile save. Served ahead of `127`, both profile
screens would land on their error boundary and every save would answer `PGRST204`. The migration
only adds a column, so it is safe against the bundle serving today, and it adds no second
PostgREST relationship. **`128` has no ordering constraint:** it only widens who may insert a
ledger row, and no bundle changes with it. Promotion order to PROD: `127` and `128`, then the
merge.

## Out of scope

- Repointing the resolver chain to a "town chosen at onboarding" source that is separate from
  `profiles.location`. This change takes the cheap end of the split the owner described.
- Offering the control on `LocationSetting` directly (see the open parameters).
- Any change to `LocationQuestionRow`'s state machine or its priming sheet.
- `search-places`' comment on `forbidden` (`shape.ts`). Its claim, *unreachable through the
  app*, is true again after `128`: the only rider refused is one without consent, and the guard
  holds that rider at the consent step, which never searches. The error message it quotes is now
  `128`'s. That one stale quote is left for the next functional change to that file, because any
  edit under `supabase/functions/` redeploys the function on merge.
